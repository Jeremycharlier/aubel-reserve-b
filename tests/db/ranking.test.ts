import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlayers, local, loginMaitre, minutesFromNow, sql, vote, type TestPlayer } from "./helpers";

type Row = {
  rank: number;
  player_id: string;
  gross_points: number;
  penalty_points: number;
  net_points: number;
  matches_counted: number;
  late_count: number;
};

describe("Classement général", () => {
  let maitre: SupabaseClient;
  let A: TestPlayer, B: TestPlayer, C: TestPlayer, D: TestPlayer, E: TestPlayer;
  let season: string;
  let m1: string;

  const id = (p: TestPlayer) => p.playerId;

  async function standings() {
    const { data, error } = await maitre.rpc("admin_season_standings", { p_season_id: season });
    expect(error).toBeNull();
    const rows = (data as Row[]).filter((r) => [A, B, C, D, E].some((p) => p.playerId === r.player_id));
    const by = (p: TestPlayer) => rows.find((r) => r.player_id === p.playerId)!;
    return { rows, by };
  }

  async function match(counts = true) {
    const { data, error } = await maitre.rpc("admin_save_match", {
      p_id: null,
      p_season_id: season,
      p_opponent: `Classement ${Math.random().toString(36).slice(2, 6)}`,
      p_kickoff_local: local(minutesFromNow(-90)),
      p_location: null,
      p_opens_local: null,
      p_closes_local: null,
      p_deadline_local: local(minutesFromNow(60)),
      p_counts_for_ranking: counts,
    });
    expect(error).toBeNull();
    await maitre.rpc("admin_set_match_players", { p_match_id: data, p_player_ids: [A, B, C, D, E].map(id) });
    await maitre.rpc("admin_set_vote_state", { p_match_id: data, p_state: "ouvert" });
    return data as string;
  }

  beforeAll(async () => {
    maitre = await loginMaitre();
    [A, B, C, D, E] = await createPlayers(5, "rank");
    const { data } = await maitre.rpc("admin_save_season", {
      p_id: null,
      p_name: "Saison classement test",
      p_starts_on: null,
      p_ends_on: null,
      p_make_current: false,
    });
    season = data as string;
    await maitre.rpc("admin_save_settings", {
      p_late_enabled: true,
      p_late_points: 2,
      p_nonvote_enabled: false,
      p_nonvote_points: 2,
    });
  });

  it("calcule points bruts, malus, points nets (plancher à zéro) et retards", async () => {
    m1 = await match();
    await vote(A.client, m1, [id(B), id(C), id(D)]);
    await vote(B.client, m1, [id(A), id(C), id(D)]);
    await vote(C.client, m1, [id(A), id(B), id(E)]);
    await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m1]);
    await vote(D.client, m1, [id(C), id(A), id(B)]); // en retard → malus 2

    const { rows, by } = await standings();
    expect(by(A)).toMatchObject({ gross_points: 8, penalty_points: 0, net_points: 8, matches_counted: 1 });
    expect(by(C)).toMatchObject({ gross_points: 7, net_points: 7 });
    expect(by(B)).toMatchObject({ gross_points: 6, net_points: 6 });
    expect(by(D)).toMatchObject({ gross_points: 2, penalty_points: 2, net_points: 0, late_count: 1 });
    expect(by(E)).toMatchObject({ gross_points: 1, net_points: 1 });
    expect(rows.map((r) => r.player_id)).toEqual([A, C, B, E, D].map(id));
  });

  it("le score net ne descend jamais sous zéro ; départage par points bruts", async () => {
    const { error } = await maitre.rpc("admin_set_penalty", {
      p_match_id: m1,
      p_player_id: id(E),
      p_kind: "non_vote",
      p_points: 5,
      p_status: "active",
      p_reason: "Test de plancher",
    });
    expect(error).toBeNull();
    const { by } = await standings();
    expect(by(E)).toMatchObject({ gross_points: 1, penalty_points: 5, net_points: 0 });
    // D et E à 0 net : D devant grâce à ses points bruts (2 > 1)
    expect(by(D).rank).toBeLessThan(by(E).rank);
  });

  it("égalité parfaite conservée ; match exclu du classement ignoré", async () => {
    const m2 = await match();
    await vote(A.client, m2, [id(B), id(E), id(D)]); // B+3 E+2 D+1
    await vote(C.client, m2, [id(E), id(D), id(A)]); // E+3 D+2 A+1
    const m3 = await match(false);
    await vote(A.client, m3, [id(C), id(D), id(E)]); // ignoré

    const { by } = await standings();
    expect(by(A)).toMatchObject({ gross_points: 9, net_points: 9, matches_counted: 2 });
    expect(by(B)).toMatchObject({ gross_points: 9, net_points: 9 });
    expect(by(A).rank).toBe(by(B).rank);
    expect(by(C).rank).toBe(by(A).rank + 2); // rang suivant sauté après l'égalité
    expect(by(D)).toMatchObject({ gross_points: 5, net_points: 3 });
    expect(by(E)).toMatchObject({ gross_points: 6, net_points: 1 });
  });

  it("un bulletin annulé par le maître n'est plus compté (pas de double comptage)", async () => {
    const [ballot] = await sql<{ id: string }>(
      "select id from ballots where match_id = $1 and voter_player_id = $2",
      [m1, id(C)],
    );
    const { error } = await maitre.rpc("admin_set_ballot_status", {
      p_ballot_id: ballot.id,
      p_status: "annule",
      p_reason: "Bulletin contesté",
    });
    expect(error).toBeNull();
    const { by } = await standings();
    expect(by(A).gross_points).toBe(6);
    expect(by(B).gross_points).toBe(7);
    expect(by(C).gross_points).toBe(7);
    expect(by(B).rank).toBe(by(C).rank); // égalité nets 7 / bruts 7
    // Le joueur ne peut plus modifier un bulletin annulé
    await sql("update matches set manual_state = 'ouvert', manual_at = now() where id = $1", [m1]);
    expect((await vote(C.client, m1, [id(A), id(B), id(E)])).error?.message).toBe("BALLOT_CANCELLED");
  });

  it("correction d'un bulletin : statut de retard corrigé, malus annulé, journal avant/après", async () => {
    const { error } = await maitre.rpc("admin_correct_ballot", {
      p_match_id: m1,
      p_voter_player_id: id(D),
      p_selections: [id(C), id(A), id(B)],
      p_is_late: false,
      p_reason: "Retard dû à une panne réseau signalée",
    });
    expect(error).toBeNull();
    const { by } = await standings();
    expect(by(D)).toMatchObject({ penalty_points: 0, net_points: 5, late_count: 0 });
    const [log] = await sql<{ before_data: { is_late: boolean }; after_data: { is_late: boolean; motif: string } }>(
      "select before_data, after_data from audit_log where action = 'bulletin.correction' order by id desc limit 1",
    );
    expect(log.before_data.is_late).toBe(true);
    expect(log.after_data).toMatchObject({ is_late: false, motif: "Retard dû à une panne réseau signalée" });
    const [pen] = await sql<{ status: string }>(
      "select status from penalties where match_id = $1 and player_id = $2",
      [m1, id(D)],
    );
    expect(pen.status).toBe("annulee");
  });

  it("le journal d'audit est immuable", async () => {
    await expect(sql("delete from audit_log")).rejects.toThrow("AUDIT_IMMUTABLE");
  });
});
