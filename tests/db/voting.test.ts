import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpenMatch, createPlayers, loginMaitre, sql, vote, type TestPlayer } from "./helpers";

async function selections(ballotOwner: string, matchId: string) {
  return sql<{ rank: number; selected_player_id: string; points: number }>(
    `select s.rank, s.selected_player_id, s.points from ballot_selections s
       join ballots b on b.id = s.ballot_id
      where b.match_id = $1 and b.voter_player_id = $2 order by s.rank`,
    [matchId, ballotOwner],
  );
}

async function setSettings(maitre: SupabaseClient, late: boolean, points = 2, nonvote = false) {
  const { error } = await maitre.rpc("admin_save_settings", {
    p_late_enabled: late,
    p_late_points: points,
    p_nonvote_enabled: nonvote,
    p_nonvote_points: 2,
  });
  expect(error).toBeNull();
}

describe("Vote", () => {
  let maitre: SupabaseClient;
  let p: TestPlayer[];
  let ids: string[];

  beforeAll(async () => {
    maitre = await loginMaitre();
    p = await createPlayers(6, "vote");
    ids = p.map((x) => x.playerId);
    await setSettings(maitre, true, 2);
  });

  it("barème 3, 2, 1 selon l'ordre de sélection", async () => {
    const m = await createOpenMatch(maitre, ids);
    const { data, error } = await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    expect(error).toBeNull();
    expect(data).toMatchObject({ version: 1, is_late: false });
    expect(await selections(ids[0], m)).toEqual([
      { rank: 1, selected_player_id: ids[1], points: 3 },
      { rank: 2, selected_player_id: ids[2], points: 2 },
      { rank: 3, selected_player_id: ids[3], points: 1 },
    ]);
  });

  it("interdit de voter pour soi-même", async () => {
    const m = await createOpenMatch(maitre, ids);
    const { error } = await vote(p[0].client, m, [ids[0], ids[1], ids[2]]);
    expect(error?.message).toBe("SELF_VOTE");
  });

  it("interdit de choisir deux fois le même joueur, ou moins/plus de trois", async () => {
    const m = await createOpenMatch(maitre, ids);
    expect((await vote(p[0].client, m, [ids[1], ids[1], ids[2]])).error?.message).toBe("DUPLICATE_SELECTION");
    expect((await vote(p[0].client, m, [ids[1], ids[2]])).error?.message).toBe("NEED_THREE");
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3], ids[4]])).error?.message).toBe("NEED_THREE");
    const rows = await sql("select 1 from ballots where match_id = $1", [m]);
    expect(rows).toHaveLength(0);
  });

  it("seuls les joueurs de la feuille de match votent et sont sélectionnables", async () => {
    const m = await createOpenMatch(maitre, ids.slice(0, 4));
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[5]])).error?.message).toBe("INVALID_SELECTION");
    expect((await vote(p[5].client, m, [ids[1], ids[2], ids[3]])).error?.message).toBe("NOT_IN_SQUAD");
  });

  it("modification tant que le vote est ouvert : seule la dernière version compte", async () => {
    const m = await createOpenMatch(maitre, ids);
    await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    const { data } = await vote(p[0].client, m, [ids[4], ids[3], ids[1]]);
    expect(data).toMatchObject({ version: 2 });
    expect(await selections(ids[0], m)).toEqual([
      { rank: 1, selected_player_id: ids[4], points: 3 },
      { rank: 2, selected_player_id: ids[3], points: 2 },
      { rank: 3, selected_player_id: ids[1], points: 1 },
    ]);
    const [{ total }] = await sql<{ total: number }>(
      `select sum(s.points)::int as total from ballot_selections s join ballots b on b.id = s.ballot_id
        where b.match_id = $1`,
      [m],
    );
    expect(total).toBe(6); // pas de double comptage
    const versions = await sql("select v.version from ballot_versions v join ballots b on b.id = v.ballot_id where b.match_id = $1", [m]);
    expect(versions).toHaveLength(2);
  });

  it("refus de vote et de modification après fermeture", async () => {
    const m = await createOpenMatch(maitre, ids);
    await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ferme" });
    expect((await vote(p[0].client, m, [ids[3], ids[2], ids[1]])).error?.message).toBe("VOTE_CLOSED");
    expect((await vote(p[1].client, m, [ids[0], ids[2], ids[3]])).error?.message).toBe("VOTE_CLOSED");
    expect((await selections(ids[0], m))[0].selected_player_id).toBe(ids[1]);
  });

  it("vote non ouvert (à venir) refusé", async () => {
    const m = await createOpenMatch(maitre, ids, { open: false });
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error?.message).toBe("VOTE_CLOSED");
  });

  it("heure limite : à temps avant, tardif après (horloge serveur)", async () => {
    const m = await createOpenMatch(maitre, ids, { deadlineMinutes: 30 });
    const onTime = await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    expect(onTime.data).toMatchObject({ is_late: false });
    // L'heure limite passe (vote toujours ouvert)
    await sql("update matches set vote_deadline = now() - interval '5 minutes' where id = $1", [m]);
    const late = await vote(p[1].client, m, [ids[0], ids[2], ids[3]]);
    expect(late.data).toMatchObject({ is_late: true });
    const pens = await sql<{ player_id: string; points: number; kind: string }>(
      "select player_id, points, kind from penalties where match_id = $1",
      [m],
    );
    // Le malus vise le votant tardif uniquement, pas les joueurs qu'il a choisis
    expect(pens).toEqual([{ player_id: ids[1], points: 2, kind: "retard" }]);
  });

  it("bulletin à temps modifié après l'heure limite : reste à temps, sans malus", async () => {
    const m = await createOpenMatch(maitre, ids, { deadlineMinutes: 30 });
    await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
    const mod = await vote(p[0].client, m, [ids[2], ids[1], ids[3]]);
    expect(mod.error).toBeNull();
    expect(mod.data).toMatchObject({ is_late: false, version: 2 });
    expect(await sql("select 1 from penalties where match_id = $1", [m])).toHaveLength(0);
  });

  it("malus appliqué une seule fois malgré plusieurs modifications tardives", async () => {
    const m = await createOpenMatch(maitre, ids);
    await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
    for (let i = 0; i < 3; i++) {
      const r = await vote(p[2].client, m, i % 2 ? [ids[0], ids[1], ids[3]] : [ids[1], ids[0], ids[3]]);
      expect(r.error).toBeNull();
    }
    const pens = await sql<{ points: number }>("select points from penalties where match_id = $1 and player_id = $2", [m, ids[2]]);
    expect(pens).toEqual([{ points: 2 }]);
  });

  it("malus désactivé : vote tardif marqué en retard mais sans pénalité", async () => {
    await setSettings(maitre, false, 2);
    const m = await createOpenMatch(maitre, ids);
    await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
    const r = await vote(p[3].client, m, [ids[0], ids[1], ids[2]]);
    expect(r.data).toMatchObject({ is_late: true });
    expect(await sql("select 1 from penalties where match_id = $1", [m])).toHaveLength(0);
    await setSettings(maitre, true, 2);
  });

  it("accès simultanés : 15 soumissions parallèles du même joueur → un seul bulletin cohérent", async () => {
    const m = await createOpenMatch(maitre, ids);
    await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
    const combos = [
      [ids[1], ids[2], ids[3]],
      [ids[3], ids[2], ids[1]],
      [ids[4], ids[5], ids[1]],
    ];
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => vote(p[0].client, m, combos[i % 3])),
    );
    expect(results.every((r) => r.error === null)).toBe(true);
    const ballots = await sql<{ version: number }>("select version from ballots where match_id = $1", [m]);
    expect(ballots).toEqual([{ version: 15 }]);
    expect(await selections(ids[0], m)).toHaveLength(3);
    const pens = await sql("select 1 from penalties where match_id = $1", [m]);
    expect(pens).toHaveLength(1);
  });

  it("accès simultanés : toute l'équipe vote en même temps", async () => {
    const m = await createOpenMatch(maitre, ids);
    const results = await Promise.all(
      p.map((pl, i) => vote(pl.client, m, ids.filter((_, j) => j !== i).slice(0, 3))),
    );
    expect(results.every((r) => r.error === null)).toBe(true);
    const [{ n, pts }] = await sql<{ n: number; pts: number }>(
      `select count(distinct b.id)::int n, sum(s.points)::int pts from ballots b
        join ballot_selections s on s.ballot_id = b.id where b.match_id = $1`,
      [m],
    );
    expect(n).toBe(6);
    expect(pts).toBe(36);
  });

  it("les contraintes de la base bloquent un bulletin incomplet même en écriture directe", async () => {
    const m = await createOpenMatch(maitre, ids);
    await expect(
      sql(
        `with b as (insert into ballots (match_id, voter_player_id, first_submitted_at, last_modified_at, is_late)
                    values ($1, $2, now(), now(), false) returning id)
         insert into ballot_selections (ballot_id, rank, selected_player_id) select id, 1, $3 from b`,
        [m, ids[0], ids[1]],
      ),
    ).rejects.toThrow("BALLOT_NEEDS_THREE");
    await expect(
      sql(
        `with b as (insert into ballots (match_id, voter_player_id, first_submitted_at, last_modified_at, is_late)
                    values ($1, $2, now(), now(), false) returning id)
         insert into ballot_selections (ballot_id, rank, selected_player_id) select id, 1, $2 from b`,
        [m, ids[0]],
      ),
    ).rejects.toThrow("SELF_VOTE");
  });
});
