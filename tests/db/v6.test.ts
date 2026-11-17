import { describe, it, expect, beforeAll, inject } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  createOpenMatch,
  createPlayers,
  currentSeasonId,
  DOMAIN,
  local,
  loginMaitre,
  minutesFromNow,
  sql,
  vote,
  type TestPlayer,
} from "./helpers";
import { AccountError, setAccountRole } from "../../src/lib/accounts";

// Améliorations du 17/11/2026 : entraîneur, domicile, disponibilités,
// convocations, faits de match en direct, notifications programmées.
describe("Améliorations de novembre", () => {
  let maitre: SupabaseClient;
  let coach: TestPlayer;
  let p: TestPlayer[];
  let ids: string[];
  let season: string;

  beforeAll(async () => {
    maitre = await loginMaitre();
    [coach] = await createPlayers(1, "coach", "entraineur");
    p = await createPlayers(5, "v6");
    ids = p.map((x) => x.playerId);
    season = await currentSeasonId(maitre);
  });

  const newMatch = async (client: SupabaseClient, kickoffMinutes: number, opponent = `V6 ${Math.random().toString(36).slice(2, 6)}`) => {
    const { data, error } = await client.rpc("admin_save_match", {
      p_id: null, p_season_id: season, p_opponent: opponent, p_kickoff_local: local(minutesFromNow(kickoffMinutes)),
      p_location: null, p_opens_local: null, p_closes_local: null,
      p_deadline_local: local(minutesFromNow(kickoffMinutes + 2880)), p_counts_for_ranking: true,
    });
    expect(error).toBeNull();
    return data as string;
  };

  describe("Rôle entraîneur", () => {
    it("gère les matchs : création, feuille, vote, domicile, import", async () => {
      const m = await newMatch(coach.client, 3 * 1440);
      expect((await coach.client.rpc("admin_set_match_sheet", { p_match_id: m, p_player_ids: ids.slice(0, 4), p_roles: ["joueur", "joueur", "joueur", "joueur"] })).error).toBeNull();
      expect((await coach.client.rpc("admin_set_vote_state", { p_match_id: m, p_state: "ouvert" })).error).toBeNull();
      expect((await coach.client.rpc("admin_set_match_home", { p_match_id: m, p_is_home: false })).error).toBeNull();
      const { data } = await coach.client.from("v_matches").select("is_home, effective_state, club_name").eq("id", m).single();
      expect(data).toEqual({ is_home: false, effective_state: "ouvert", club_name: "Aubel" });
      const imp = await coach.client.rpc("admin_import_matches", {
        p_season_id: season,
        p_rows: [{ opponent: "Import Coach", kickoff: "2027-04-04T15:00:00", location: "Barchon", opens: null, deadline: "2027-04-06T15:00:00", closes: null, counts: true, home: false }],
      });
      expect(imp.data).toEqual({ created: 1, skipped: 0 });
      expect((await sql<{ is_home: boolean }>("select is_home from matches where opponent = 'Import Coach'"))[0].is_home).toBe(false);
    });

    it("ne voit ni bulletins, ni malus, ni classement, ni réglages, ni comptes", async () => {
      const m = await createOpenMatch(maitre, ids.slice(0, 4));
      expect((await vote(p[0].client, m, [ids[1], ids[2], ids[3]])).error).toBeNull();
      expect((await coach.client.from("ballots").select("id").eq("match_id", m)).data).toEqual([]);
      expect((await coach.client.from("ballot_selections").select("*")).data).toEqual([]);
      expect((await coach.client.from("penalties").select("*")).data).toEqual([]);
      expect((await coach.client.from("audit_log").select("*")).data).toEqual([]);
      expect((await coach.client.rpc("admin_season_standings", { p_season_id: season })).error?.message).toBe("FORBIDDEN");
      expect((await coach.client.rpc("admin_match_summary", { p_match_id: m })).error?.message).toBe("FORBIDDEN");
      expect((await coach.client.rpc("admin_save_settings", { p_late_enabled: false, p_late_points: 1, p_nonvote_enabled: false, p_nonvote_points: 1 })).error?.message).toBe("FORBIDDEN");
      expect((await coach.client.rpc("admin_save_season", { p_id: null, p_name: "Pirate", p_starts_on: null, p_ends_on: null, p_make_current: false })).error?.message).toBe("FORBIDDEN");
      expect((await coach.client.rpc("admin_correct_ballot", { p_match_id: m, p_voter_player_id: ids[1], p_selections: [ids[0], ids[2], ids[3]], p_is_late: false, p_reason: "x" })).error?.message).toBe("FORBIDDEN");
      expect((await coach.client.rpc("admin_schedule_notification", { p_title: "x", p_body: "y", p_audience: "tous", p_match_id: null, p_send_local: null, p_url: "/" })).error?.message).toBe("FORBIDDEN");
      // Il sait seulement qu'il y a des votes (pour la suppression)
      expect((await coach.client.rpc("match_has_votes", { p_match_id: m })).data).toBe(true);
      expect((await p[0].client.rpc("match_has_votes", { p_match_id: m })).error?.message).toBe("FORBIDDEN");
    });

    it("vote et figure au classement comme un joueur", async () => {
      const m = await createOpenMatch(maitre, [coach.playerId, ...ids.slice(0, 3)]);
      expect((await vote(coach.client, m, [ids[0], ids[1], ids[2]])).error).toBeNull();
      expect((await vote(p[0].client, m, [coach.playerId, ids[1], ids[2]])).error).toBeNull();
      const rows = (await maitre.rpc("admin_season_standings", { p_season_id: season })).data as { player_id: string; gross_points: number }[];
      expect(rows.find((r) => r.player_id === coach.playerId)?.gross_points).toBeGreaterThanOrEqual(3);
    });

    it("ne peut supprimer un match avec votes ; peut supprimer un match sans votes", async () => {
      const voted = await createOpenMatch(maitre, ids.slice(0, 4));
      await vote(p[0].client, voted, [ids[1], ids[2], ids[3]]);
      expect((await coach.client.rpc("admin_delete_match", { p_match_id: voted, p_confirm: "SUPPRIMER" })).error?.message).toBe("ADMIN_ONLY");
      const empty = await newMatch(coach.client, 5 * 1440);
      expect((await coach.client.rpc("admin_delete_match", { p_match_id: empty, p_confirm: null })).error).toBeNull();
    });

    it("rôle attribué ou retiré par l'administrateur seulement", async () => {
      const admin = adminClient();
      const maitreId = inject("maitre").userId;
      await setAccountRole(admin, maitreId, p[4].userId, "entraineur");
      expect((await p[4].client.rpc("is_staff")).data).toBe(true);
      await setAccountRole(admin, maitreId, p[4].userId, "joueur");
      expect((await p[4].client.rpc("is_staff")).data).toBe(false);
      await expect(setAccountRole(admin, coach.userId, p[4].userId, "entraineur")).rejects.toBeInstanceOf(AccountError);
      await expect(setAccountRole(admin, maitreId, maitreId, "joueur")).rejects.toThrow("CANNOT_CHANGE_SELF");
      expect((await p[4].client.rpc("svc_set_account_role", { p_actor: p[4].userId, p_user_id: p[4].userId, p_role: "entraineur" })).error?.code).toBe("42501");
      void DOMAIN;
    });
  });

  describe("Disponibilités et convocations", () => {
    it("ouverture le lundi 9 h (heure belge) de la semaine du match", async () => {
      const at = async (kickoff: string) =>
        (await sql<{ o: string }>(
          "select to_char(public.availability_opens_at($1::timestamptz) at time zone 'Europe/Brussels', 'Dy YYYY-MM-DD HH24:MI') o",
          [kickoff],
        ))[0].o;
      expect(await at("2026-11-22T14:00:00Z")).toBe("Mon 2026-11-16 09:00"); // dimanche
      expect(await at("2026-11-21T14:00:00Z")).toBe("Mon 2026-11-16 09:00"); // samedi
      expect(await at("2026-11-23T19:00:00Z")).toBe("Mon 2026-11-16 09:00"); // lundi soir : lundi précédent
      expect(await at("2027-03-28T13:00:00Z")).toBe("Mon 2027-03-22 09:00"); // changement d'heure
    });

    it("le joueur répond pendant la fenêtre ; refus avant l'ouverture et après validation", async () => {
      const far = await newMatch(maitre, 20 * 1440);
      expect((await p[0].client.rpc("set_my_availability", { p_match_id: far, p_status: "present", p_comment: null })).error?.message).toBe("AVAILABILITY_NOT_OPEN");

      const m = await newMatch(maitre, 2 * 1440);
      await sql("update matches set kickoff_at = now() + interval '2 days' where id = $1", [m]);
      // Force l'ouverture : on place le match dans une semaine déjà ouverte
      const [{ state }] = await sql<{ state: string }>("select public.availability_state(m, now()) state from matches m where id = $1", [m]);
      if (state !== "ouverte") await sql("update matches set kickoff_at = now() + interval '1 hour' where id = $1", [m]);
      expect((await p[0].client.rpc("set_my_availability", { p_match_id: m, p_status: "present", p_comment: "dès 14 h" })).error).toBeNull();
      expect((await p[1].client.rpc("set_my_availability", { p_match_id: m, p_status: "absent", p_comment: null })).error).toBeNull();
      expect((await p[1].client.rpc("set_my_availability", { p_match_id: m, p_status: "incertain", p_comment: null })).error).toBeNull();
      // Visible par l'équipe
      const { data } = await p[2].client.from("match_availability").select("player_id, status, comment").eq("match_id", m);
      expect(data).toHaveLength(2);
      expect(data!.find((r) => r.player_id === ids[0])?.comment).toBe("dès 14 h");
      // L'entraîneur note une réponse reçue autrement
      expect((await coach.client.rpc("admin_set_availability", { p_match_id: m, p_player_id: ids[2], p_status: "present" })).error).toBeNull();
      expect((await p[0].client.rpc("admin_set_availability", { p_match_id: m, p_player_id: ids[2], p_status: "absent" })).error?.message).toBe("FORBIDDEN");

      // Validation : feuille vide refusée, puis convocation
      expect((await coach.client.rpc("admin_validate_sheet", { p_match_id: m, p_validated: true })).error?.message).toBe("SHEET_EMPTY");
      await coach.client.rpc("admin_set_match_sheet", { p_match_id: m, p_player_ids: [ids[0], ids[2]], p_roles: ["joueur", "joueur"] });
      expect((await coach.client.rpc("admin_validate_sheet", { p_match_id: m, p_validated: true })).error).toBeNull();
      expect((await p[0].client.rpc("set_my_availability", { p_match_id: m, p_status: "absent", p_comment: null })).error?.message).toBe("SHEET_VALIDATED");
      // Rouverte : les réponses sont de nouveau modifiables
      expect((await coach.client.rpc("admin_validate_sheet", { p_match_id: m, p_validated: false })).error).toBeNull();
      expect((await p[0].client.rpc("set_my_availability", { p_match_id: m, p_status: "incertain", p_comment: null })).error).toBeNull();
    });

    it("notifications : inscriptions ouvertes puis convocation, une seule fois", async () => {
      const admin = adminClient();
      await sql("update app_settings set notify_availability = true, notify_convocation = true");
      for (const x of [p[0], p[3]]) {
        await x.client.rpc("save_push_subscription", { p_endpoint: `https://push.example.test/v6/${x.username}`, p_p256dh: "k", p_auth: "a", p_user_agent: "t" });
      }
      const m = await newMatch(maitre, 60);
      const pending = async () =>
        ((await admin.rpc("svc_pending_notifications")).data as { user_id: string; match_id: string; kind: string }[]).filter(
          (r) => r.match_id === m && [p[0].userId, p[3].userId].includes(r.user_id),
        );
      let rows = await pending();
      expect(rows.filter((r) => r.kind === "dispo").map((r) => r.user_id).sort()).toEqual([p[0].userId, p[3].userId].sort());
      await p[3].client.rpc("set_my_availability", { p_match_id: m, p_status: "present", p_comment: null });
      rows = await pending();
      expect(rows.map((r) => r.user_id)).toEqual([p[0].userId]); // p3 a répondu
      await admin.rpc("svc_mark_notified", { p_user_ids: rows.map((r) => r.user_id), p_match_ids: rows.map((r) => r.match_id), p_kinds: rows.map((r) => r.kind) });
      expect(await pending()).toEqual([]);
      await maitre.rpc("admin_set_match_sheet", { p_match_id: m, p_player_ids: [ids[3]], p_roles: ["joueur"] });
      await maitre.rpc("admin_validate_sheet", { p_match_id: m, p_validated: true });
      rows = await pending();
      expect(rows.map((r) => [r.user_id, r.kind])).toEqual([[p[3].userId, "convocation"]]);
    });
  });

  describe("Faits de match en direct", () => {
    let m: string;
    beforeAll(async () => {
      m = await createOpenMatch(maitre, ids.slice(0, 4));
      await maitre.rpc("admin_set_match_sheet", {
        p_match_id: m, p_player_ids: ids.slice(0, 4), p_roles: ["joueur", "joueur", "delegue", "joueur"],
      });
    });

    it("chrono : coup d'envoi, mi-temps, 2e mi-temps, fin ; minute calculée par le serveur", async () => {
      expect((await coach.client.rpc("live_control", { p_match_id: m, p_action: "halftime" })).error?.message).toBe("LIVE_INVALID");
      expect((await coach.client.rpc("live_control", { p_match_id: m, p_action: "start" })).data).toBe("premiere");
      // 0-0 dès le coup d'envoi
      expect((await sql<{ score_for: number; score_against: number }>("select score_for, score_against from matches where id = $1", [m]))[0]).toEqual({ score_for: 0, score_against: 0 });
      await sql("update matches set live_started_at = now() - interval '23 minutes 10 seconds' where id = $1", [m]);
      expect((await coach.client.rpc("add_match_event", { p_match_id: m, p_kind: "but", p_player_id: ids[0], p_assist_player_id: ids[1], p_minute: null })).error).toBeNull();
      const [g] = await sql<{ minute: number; period: number }>("select minute, period from match_events where match_id = $1", [m]);
      expect(g).toEqual({ minute: 24, period: 1 });
      await coach.client.rpc("live_control", { p_match_id: m, p_action: "halftime" });
      await coach.client.rpc("live_control", { p_match_id: m, p_action: "second_half" });
      await sql("update matches set second_half_started_at = now() - interval '5 minutes' where id = $1", [m]);
      await coach.client.rpc("add_match_event", { p_match_id: m, p_kind: "but_adverse", p_player_id: null, p_assist_player_id: null, p_minute: null });
      const [a] = await sql<{ minute: number; period: number }>("select minute, period from match_events where match_id = $1 and kind = 'but_adverse'", [m]);
      expect(a).toEqual({ minute: 51, period: 2 });
      expect((await coach.client.rpc("live_control", { p_match_id: m, p_action: "end" })).data).toBe("termine");
      expect((await coach.client.rpc("live_control", { p_match_id: m, p_action: "reset" })).error?.message).toBe("LIVE_HAS_EVENTS");
    });

    it("statistiques et score suivent les faits (ajout, correction, suppression)", async () => {
      const stats = async () =>
        sql<{ player_id: string; goals: number; assists: number }>("select player_id, goals, assists from match_stats where match_id = $1 order by goals desc", [m]);
      expect(await stats()).toEqual([
        { player_id: ids[0], goals: 1, assists: 0 },
        { player_id: ids[1], goals: 0, assists: 1 },
      ]);
      const [ev] = await sql<{ id: string }>("select id from match_events where match_id = $1 and kind = 'but'", [m]);
      expect((await coach.client.rpc("update_match_event_minute", { p_event_id: ev.id, p_minute: 30 })).error).toBeNull();
      expect((await coach.client.rpc("delete_match_event", { p_event_id: ev.id })).error).toBeNull();
      expect(await stats()).toEqual([]);
      expect((await sql<{ score_for: number; score_against: number }>("select score_for, score_against from matches where id = $1", [m]))[0]).toEqual({ score_for: 0, score_against: 1 });
    });

    it("le délégué du match peut encoder ; un joueur non, même par l'API", async () => {
      expect((await p[2].client.rpc("can_record_facts", { p_match_id: m })).data).toBe(true);
      expect((await p[2].client.rpc("add_match_event", { p_match_id: m, p_kind: "jaune", p_player_id: ids[3], p_assist_player_id: null, p_minute: 70 })).error).toBeNull();
      expect((await p[0].client.rpc("can_record_facts", { p_match_id: m })).data).toBe(false);
      expect((await p[0].client.rpc("add_match_event", { p_match_id: m, p_kind: "but", p_player_id: ids[0], p_assist_player_id: null, p_minute: 80 })).error?.message).toBe("FORBIDDEN");
      expect((await p[0].client.rpc("live_control", { p_match_id: m, p_action: "resume" })).error?.message).toBe("FORBIDDEN");
      expect((await p[0].client.from("match_events").insert({ match_id: m, kind: "but", player_id: ids[0] })).error?.code).toBe("42501");
      // Tous les joueurs lisent les faits
      expect(((await p[4].client.from("match_events").select("id").eq("match_id", m)).data ?? []).length).toBe(2);
    });

    it("contrôles : but adverse sans joueur, passeur différent du buteur, joueur de la feuille", async () => {
      const add = (kind: string, player: string | null, assist: string | null) =>
        coach.client.rpc("add_match_event", { p_match_id: m, p_kind: kind, p_player_id: player, p_assist_player_id: assist, p_minute: 10 });
      expect((await add("but_adverse", ids[0], null)).error?.message).toBe("EVENT_INVALID");
      expect((await add("but", ids[0], ids[0])).error?.message).toBe("EVENT_INVALID");
      expect((await add("jaune", null, null)).error?.message).toBe("EVENT_PLAYER_REQUIRED");
      expect((await add("but", ids[4], null)).error?.message).toBe("STATS_NOT_IN_SQUAD");
      expect((await add("penalty", ids[0], null)).error?.message).toBe("EVENT_INVALID");
    });
  });

  describe("Notifications programmées", () => {
    it("l'administrateur programme ; envoi réservé une seule fois aux bons destinataires ; annulation", async () => {
      const admin = adminClient();
      const now = await maitre.rpc("admin_schedule_notification", { p_title: "Test", p_body: "Bonjour l'équipe", p_audience: "tous", p_match_id: null, p_send_local: null, p_url: "/" });
      expect(now.error).toBeNull();
      const later = await maitre.rpc("admin_schedule_notification", {
        p_title: "Plus tard", p_body: "Demain", p_audience: "moi", p_match_id: null, p_send_local: local(minutesFromNow(120)), p_url: "/",
      });
      const claimed = (await admin.rpc("svc_claim_scheduled_notifications")).data as { id: string }[];
      expect(claimed.map((c) => c.id)).toEqual([now.data]);
      expect((await admin.rpc("svc_claim_scheduled_notifications")).data).toEqual([]); // pas de double envoi
      const recipients = (await admin.rpc("svc_scheduled_recipients", { p_id: now.data })).data as unknown[];
      expect(recipients.length).toBeGreaterThanOrEqual(7);
      expect((await maitre.rpc("admin_cancel_notification", { p_id: later.data })).error).toBeNull();
      await sql("update scheduled_notifications set send_at = now() - interval '1 minute' where id = $1", [later.data]);
      expect((await admin.rpc("svc_claim_scheduled_notifications")).data).toEqual([]); // annulée
      // Lien externe interdit
      expect((await maitre.rpc("admin_schedule_notification", { p_title: "x", p_body: "y", p_audience: "moi", p_match_id: null, p_send_local: null, p_url: "//evil.example" })).error).not.toBeNull();
      // Diagnostic accessible au serveur uniquement
      const diag = (await admin.rpc("svc_notification_diagnostics")).data as Record<string, unknown>;
      expect(diag).toMatchObject({ cron_token: true, pg_cron: false });
      expect((await p[0].client.rpc("svc_notification_diagnostics")).error?.code).toBe("42501");
    });
  });
});
