import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  createOpenMatch,
  createPlayers,
  currentSeasonId,
  local,
  loginMaitre,
  minutesFromNow,
  sql,
  vote,
  type TestPlayer,
} from "./helpers";

async function state(id: string) {
  const [row] = await sql<{ vote_state: string; effective: string }>(
    `select m.vote_state, public.match_effective_state(m, now())::text as effective from matches m where id = $1`,
    [id],
  );
  return row;
}

describe("Ouverture/fermeture automatiques et manuelles", () => {
  let maitre: SupabaseClient;
  let p: TestPlayer[];
  let ids: string[];
  let season: string;

  beforeAll(async () => {
    maitre = await loginMaitre();
    p = await createPlayers(4, "sched");
    ids = p.map((x) => x.playerId);
    season = await currentSeasonId(maitre);
  });

  async function scheduledMatch(opensIn: number | null, closesIn: number | null, deadlineIn = 60) {
    const { data, error } = await maitre.rpc("admin_save_match", {
      p_id: null,
      p_season_id: season,
      p_opponent: "Programmé",
      p_kickoff_local: local(minutesFromNow(-60)),
      p_location: null,
      p_opens_local: opensIn === null ? null : local(minutesFromNow(opensIn)),
      p_closes_local: closesIn === null ? null : local(minutesFromNow(closesIn)),
      p_deadline_local: local(minutesFromNow(deadlineIn)),
      p_counts_for_ranking: true,
    });
    expect(error).toBeNull();
    await maitre.rpc("admin_set_match_players", { p_match_id: data, p_player_ids: ids });
    return data as string;
  }

  const runScheduler = async () => {
    const { error } = await adminClient().rpc("process_vote_schedule");
    expect(error).toBeNull();
  };

  it("ouverture automatique : le vote s'ouvre à l'heure prévue, même sans passage du planificateur", async () => {
    const m = await scheduledMatch(10, 120);
    expect(await state(m)).toEqual({ vote_state: "a_venir", effective: "a_venir" });
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error?.message).toBe("VOTE_CLOSED");
    await sql("update matches set vote_opens_at = now() - interval '1 second' where id = $1", [m]);
    // Le serveur recalcule l'état à la réception : vote accepté immédiatement
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error).toBeNull();
    await runScheduler();
    expect(await state(m)).toEqual({ vote_state: "ouvert", effective: "ouvert" });
  });

  it("fermeture automatique à l'heure prévue", async () => {
    const m = await scheduledMatch(-30, 30);
    await runScheduler();
    expect((await state(m)).vote_state).toBe("ouvert");
    await sql("update matches set vote_closes_at = now() - interval '1 second' where id = $1", [m]);
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error?.message).toBe("VOTE_CLOSED");
    await runScheduler();
    expect(await state(m)).toEqual({ vote_state: "ferme", effective: "ferme" });
  });

  it("mode mixte : ouverture manuelle puis fermeture automatique", async () => {
    const m = await scheduledMatch(null, 60);
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ouvert" });
    expect((await state(m)).effective).toBe("ouvert");
    // La fermeture programmée survient après l'ouverture manuelle
    await sql(
      "update matches set manual_at = now() - interval '10 minutes', vote_closes_at = now() - interval '1 second' where id = $1",
      [m],
    );
    expect((await state(m)).effective).toBe("ferme");
  });

  it("mode mixte : fermeture manuelle anticipée avant la fermeture programmée", async () => {
    const m = await scheduledMatch(-10, 60);
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ferme" });
    expect((await state(m)).effective).toBe("ferme");
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error?.message).toBe("VOTE_CLOSED");
  });

  it("réouverture manuelle après une fermeture automatique", async () => {
    const m = await scheduledMatch(-60, -5);
    await runScheduler();
    expect((await state(m)).vote_state).toBe("ferme");
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ouvert" });
    expect((await state(m)).vote_state).toBe("ouvert");
    expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error).toBeNull();
  });

  it("retour au mode automatique (annulation de l'action manuelle)", async () => {
    const m = await scheduledMatch(30, 90);
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ouvert" });
    expect((await state(m)).effective).toBe("ouvert");
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: null });
    expect((await state(m)).effective).toBe("a_venir");
  });

  it("malus de non-vote appliqué à la clôture (si activé), retiré si le joueur vote après réouverture", async () => {
    await maitre.rpc("admin_save_settings", {
      p_late_enabled: true,
      p_late_points: 2,
      p_nonvote_enabled: true,
      p_nonvote_points: 3,
    });
    const m = await createOpenMatch(maitre, ids);
    await vote(p[0].client, m, [ids[1], ids[2], ids[3]]);
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ferme" });
    const pens = await sql<{ player_id: string; kind: string; points: number }>(
      "select player_id, kind, points from penalties where match_id = $1 order by player_id",
      [m],
    );
    expect(pens.map((x) => x.player_id).sort()).toEqual([ids[1], ids[2], ids[3]].sort());
    expect(pens.every((x) => x.kind === "non_vote" && x.points === 3)).toBe(true);

    // Un passage du planificateur n'en ajoute pas d'autres
    await adminClient().rpc("process_vote_schedule");
    expect(await sql("select 1 from penalties where match_id = $1", [m])).toHaveLength(3);

    // Réouverture : le joueur 2 vote (à temps) → son malus de non-vote disparaît
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ouvert" });
    await vote(p[1].client, m, [ids[0], ids[2], ids[3]]);
    const after = await sql<{ player_id: string }>("select player_id from penalties where match_id = $1", [m]);
    expect(after.map((x) => x.player_id).sort()).toEqual([ids[2], ids[3]].sort());

    await maitre.rpc("admin_save_settings", {
      p_late_enabled: true,
      p_late_points: 2,
      p_nonvote_enabled: false,
      p_nonvote_points: 2,
    });
  });

  it("pas de malus de non-vote pour un vote jamais ouvert", async () => {
    await maitre.rpc("admin_save_settings", {
      p_late_enabled: true,
      p_late_points: 2,
      p_nonvote_enabled: true,
      p_nonvote_points: 2,
    });
    const m = await createOpenMatch(maitre, ids, { open: false });
    await maitre.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ferme" });
    expect(await sql("select 1 from penalties where match_id = $1", [m])).toHaveLength(0);
    await maitre.rpc("admin_save_settings", {
      p_late_enabled: true,
      p_late_points: 2,
      p_nonvote_enabled: false,
      p_nonvote_points: 2,
    });
  });

  it("heures saisies en heure de Bruxelles, y compris autour du changement d'heure", async () => {
    const { data } = await maitre.rpc("admin_save_match", {
      p_id: null,
      p_season_id: season,
      p_opponent: "Changement d'heure",
      p_kickoff_local: "2027-03-28T15:00:00", // dimanche, heure d'été (UTC+2)
      p_location: null,
      p_opens_local: "2027-03-27T18:00:00", // samedi, heure d'hiver (UTC+1)
      p_closes_local: null,
      p_deadline_local: "2027-03-28T18:00:00",
      p_counts_for_ranking: true,
    });
    const [row] = await sql<{ k: string; o: string; d: string }>(
      `select to_char(kickoff_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') k,
              to_char(vote_opens_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') o,
              to_char(vote_deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') d
         from matches where id = $1`,
      [data],
    );
    expect(row).toEqual({ k: "2027-03-28 13:00", o: "2027-03-27 17:00", d: "2027-03-28 16:00" });
  });

  it("suppression d'un match : possible sans votes, refusée avec votes", async () => {
    const empty = await createOpenMatch(maitre, ids, { open: false });
    expect((await maitre.rpc("admin_delete_match", { p_match_id: empty })).error).toBeNull();
    const used = await createOpenMatch(maitre, ids);
    await vote(p[0].client, used, [ids[1], ids[2], ids[3]]);
    expect((await maitre.rpc("admin_delete_match", { p_match_id: used })).error?.message).toBe("CONFIRM_REQUIRED");
  });
});
