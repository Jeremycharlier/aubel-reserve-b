import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, createOpenMatch, createPlayers, currentSeasonId, loginMaitre, vote, type TestPlayer } from "./helpers";

// Vérifie que la confidentialité est garantie par la BASE (RLS + privilèges),
// en appelant directement l'API REST comme le ferait un joueur malveillant.
describe("Droits et confidentialité", () => {
  let maitre: SupabaseClient;
  let a: TestPlayer, b: TestPlayer, c: TestPlayer, d: TestPlayer;
  let matchId: string;

  beforeAll(async () => {
    maitre = await loginMaitre();
    [a, b, c, d] = await createPlayers(4, "perm");
    matchId = await createOpenMatch(maitre, [a, b, c, d].map((p) => p.playerId));
    expect((await vote(a.client, matchId, [b.playerId, c.playerId, d.playerId])).error).toBeNull();
    expect((await vote(b.client, matchId, [a.playerId, c.playerId, d.playerId])).error).toBeNull();
  });

  it("un joueur ne voit que son propre bulletin", async () => {
    const { data, error } = await a.client.from("ballots").select("id, voter_player_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].voter_player_id).toBe(a.playerId);
  });

  it("un joueur ne voit que ses propres sélections (jamais qui a voté pour lui)", async () => {
    const { data } = await a.client.from("ballot_selections").select("ballot_id, selected_player_id, points");
    expect(data).toHaveLength(3);
    // Les voix reçues par A (venant de B) restent invisibles pour A
    expect(data!.some((s) => s.selected_player_id === a.playerId)).toBe(false);
    // Même en filtrant explicitement sur l'identifiant d'un autre bulletin
    const { data: other } = await c.client.from("ballot_selections").select("*").eq("selected_player_id", c.playerId);
    expect(other).toEqual([]);
  });

  it("un joueur n'a pas accès aux malus, versions, journal ni au classement", async () => {
    for (const table of ["penalties", "ballot_versions", "audit_log"]) {
      const { data, error } = await a.client.from(table).select("*");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { error: loginErr } = await a.client.from("login_attempts").select("*");
    expect(loginErr?.code).toBe("42501");
    const season = await currentSeasonId(maitre);
    const { error: rankErr } = await a.client.rpc("admin_season_standings", { p_season_id: season });
    expect(rankErr?.message).toBe("FORBIDDEN");
    const { error: sumErr } = await a.client.rpc("admin_match_summary", { p_match_id: matchId });
    expect(sumErr?.message).toBe("FORBIDDEN");
  });

  it("un joueur ne voit que son propre profil", async () => {
    const { data } = await a.client.from("profiles").select("user_id, role");
    expect(data).toEqual([{ user_id: a.userId, role: "joueur" }]);
  });

  it("aucune écriture directe : ni bulletin, ni points, ni rôle", async () => {
    const insBallot = await a.client.from("ballots").insert({
      match_id: matchId,
      voter_player_id: c.playerId,
      first_submitted_at: new Date().toISOString(),
      last_modified_at: new Date().toISOString(),
      is_late: false,
    });
    expect(insBallot.error?.code).toBe("42501");

    const upRole = await a.client.from("profiles").update({ role: "maitre" }).eq("user_id", a.userId);
    expect(upRole.error?.code).toBe("42501");

    const upSel = await a.client.from("ballot_selections").update({ rank: 1 }).eq("selected_player_id", a.playerId);
    expect(upSel.error?.code).toBe("42501");

    const delPen = await a.client.from("penalties").delete().eq("player_id", a.playerId);
    expect(delPen.error?.code).toBe("42501");

    const upSettings = await a.client.from("app_settings").update({ late_penalty_enabled: false }).eq("id", 1);
    expect(upSettings.error?.code).toBe("42501");
  });

  it("toutes les fonctions d'administration refusent un joueur", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["admin_save_settings", { p_late_enabled: false, p_late_points: 1, p_nonvote_enabled: false, p_nonvote_points: 1 }],
      ["admin_set_vote_state", { p_match_id: matchId, p_state: "ferme" }],
      ["admin_set_match_players", { p_match_id: matchId, p_player_ids: [] }],
      ["admin_delete_match", { p_match_id: matchId }],
      ["admin_correct_ballot", { p_match_id: matchId, p_voter_player_id: c.playerId, p_selections: [a.playerId, b.playerId, d.playerId], p_is_late: false, p_reason: "x" }],
      ["admin_save_player", { p_id: a.playerId, p_display_name: "Pirate", p_shirt_number: null, p_active: true }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await a.client.rpc(fn, args);
      expect(error?.message, fn).toBe("FORBIDDEN");
    }
    for (const fn of ["process_vote_schedule", "svc_password_changed", "apply_closure", "audit", "refresh_match_state"]) {
      const { error } = await a.client.rpc(fn, fn === "svc_password_changed" ? { p_user_id: a.userId } : {});
      expect(error, fn).not.toBeNull();
    }
  });

  it("un visiteur non connecté n'a accès à rien", async () => {
    const anon = anonClient();
    for (const table of ["players", "matches", "ballots", "ballot_selections", "profiles", "v_matches"]) {
      const { error } = await anon.from(table).select("*");
      expect(error?.code, table).toBe("42501");
    }
    const { error } = await anon.rpc("submit_ballot", { p_match_id: matchId, p_selections: [] });
    expect(error?.code).toBe("42501");
  });

  it("le maître voit tous les bulletins avec l'identité du votant", async () => {
    const { data } = await maitre
      .from("ballots")
      .select("voter_player_id, ballot_selections(selected_player_id, rank, points)")
      .eq("match_id", matchId);
    expect(data).toHaveLength(2);
    const voters = data!.map((x) => x.voter_player_id).sort();
    expect(voters).toEqual([a.playerId, b.playerId].sort());
    expect(data!.every((x) => (x.ballot_selections as unknown[]).length === 3)).toBe(true);
  });

  it("un compte désactivé perd immédiatement l'accès aux données", async () => {
    // Profil inactif : my_player_id() devient nul, donc plus aucun bulletin visible ni vote possible
    const { error: e1 } = await maitre.rpc("is_maitre");
    expect(e1).toBeNull();
    const pg = await import("./helpers");
    await pg.sql("update profiles set active = false where user_id = $1", [d.userId]);
    const { data } = await d.client.from("ballots").select("id");
    expect(data).toEqual([]);
    const { error } = await vote(d.client, matchId, [a.playerId, b.playerId, c.playerId]);
    expect(error?.message).toBe("NO_PLAYER");
    await pg.sql("update profiles set active = true where user_id = $1", [d.userId]);
  });
});
