import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  anonClient,
  createOpenMatch,
  createPlayers,
  currentSeasonId,
  loginMaitre,
  sql,
  vote,
  type TestPlayer,
} from "./helpers";

describe("Améliorations : surnom, statuts, stats, suppression, import, notifications", () => {
  let maitre: SupabaseClient;
  let p: TestPlayer[];
  let ids: string[];

  beforeAll(async () => {
    maitre = await loginMaitre();
    p = await createPlayers(6, "feat");
    ids = p.map((x) => x.playerId);
  });

  const names = async (id: string) =>
    (await sql<{ display_name: string; full_name: string; nickname: string | null }>(
      "select display_name, full_name, nickname from players where id = $1",
      [id],
    ))[0];

  describe("Surnom et date de naissance", () => {
    it("le joueur choisit son surnom : il remplace son nom partout", async () => {
      const before = await names(ids[0]);
      const { error } = await p[0].client.rpc("update_my_profile", {
        p_nickname: "Le Mur",
        p_use_nickname: true,
        p_birth_date: "1995-04-12",
      });
      expect(error).toBeNull();
      expect(await names(ids[0])).toEqual({ display_name: "Le Mur", full_name: before.full_name, nickname: "Le Mur" });
      // Visible par les coéquipiers (nom affiché et date de naissance)
      const { data } = await p[1].client.from("players").select("display_name, birth_date").eq("id", ids[0]).single();
      expect(data).toEqual({ display_name: "Le Mur", birth_date: "1995-04-12" });
    });

    it("revenir au vrai nom ; le maître peut aussi décider", async () => {
      await p[0].client.rpc("update_my_profile", { p_nickname: "Le Mur", p_use_nickname: false, p_birth_date: null });
      expect((await names(ids[0])).display_name).not.toBe("Le Mur");
      const full = (await names(ids[0])).full_name;
      const { error } = await maitre.rpc("admin_save_player_full", {
        p_id: ids[0], p_full_name: full, p_nickname: "Le Mur", p_use_nickname: true,
        p_birth_date: "1995-04-12", p_shirt_number: 5, p_default_role: "joueur", p_active: true,
      });
      expect(error).toBeNull();
      expect((await names(ids[0])).display_name).toBe("Le Mur");
    });

    it("un surnom ne peut pas reprendre le nom affiché d'un autre joueur", async () => {
      const other = (await names(ids[2])).display_name;
      const { error } = await p[1].client.rpc("update_my_profile", { p_nickname: other, p_use_nickname: true, p_birth_date: null });
      expect(error?.message).toContain("duplicate key");
    });

    it("un joueur ne peut pas modifier la fiche d'un autre", async () => {
      const { error } = await p[1].client.rpc("admin_save_player_full", {
        p_id: ids[0], p_full_name: "Pirate", p_nickname: null, p_use_nickname: false,
        p_birth_date: null, p_shirt_number: null, p_default_role: "joueur", p_active: true,
      });
      expect(error?.message).toBe("FORBIDDEN");
      const upd = await p[1].client.from("players").update({ nickname: "x" }).eq("id", ids[0]);
      expect(upd.error?.code).toBe("42501");
    });
  });

  describe("Joueur, délégué, supporter", () => {
    let m: string;
    beforeAll(async () => {
      m = await createOpenMatch(maitre, []);
      const { error } = await maitre.rpc("admin_set_match_sheet", {
        p_match_id: m,
        p_player_ids: ids,
        p_roles: ["joueur", "joueur", "delegue", "supporter", "joueur", "joueur"],
      });
      expect(error).toBeNull();
    });

    it("un supporter vote mais ne peut pas être choisi", async () => {
      expect((await vote(p[3].client, m, [ids[0], ids[1], ids[2]])).error).toBeNull();
      const r = await vote(p[0].client, m, [ids[1], ids[3], ids[2]]);
      expect(r.error?.message).toBe("SUPPORTER_SELECTED");
    });

    it("un délégué vote et peut recevoir des voix", async () => {
      expect((await vote(p[2].client, m, [ids[0], ids[1], ids[4]])).error).toBeNull();
      expect((await vote(p[1].client, m, [ids[2], ids[0], ids[4]])).error).toBeNull();
    });

    it("la correction du maître refuse aussi un supporter", async () => {
      const { error } = await maitre.rpc("admin_correct_ballot", {
        p_match_id: m, p_voter_player_id: ids[4], p_selections: [ids[3], ids[0], ids[1]],
        p_is_late: false, p_reason: "test",
      });
      expect(error?.message).toBe("SUPPORTER_SELECTED");
    });

    it("un joueur ayant reçu des voix ne peut pas devenir supporter", async () => {
      const { error } = await maitre.rpc("admin_set_match_sheet", {
        p_match_id: m,
        p_player_ids: ids,
        p_roles: ["supporter", "joueur", "delegue", "supporter", "joueur", "joueur"],
      });
      expect(error?.message).toBe("SUPPORTER_HAS_VOTES");
    });

    it("le statut par défaut s'applique à la feuille de match", async () => {
      await sql("update players set default_role = 'supporter' where id = $1", [ids[5]]);
      const m2 = await createOpenMatch(maitre, ids);
      const [row] = await sql<{ role: string }>("select role from match_players where match_id = $1 and player_id = $2", [m2, ids[5]]);
      expect(row.role).toBe("supporter");
      await sql("update players set default_role = 'joueur' where id = $1", [ids[5]]);
    });

    it("tous les joueurs voient la liste des présents et leur statut", async () => {
      const { data } = await p[4].client.from("match_players").select("player_id, role").eq("match_id", m);
      expect(data).toHaveLength(6);
      expect(data!.find((r) => r.player_id === ids[2])?.role).toBe("delegue");
    });
  });

  describe("Statistiques de match", () => {
    let m: string;
    beforeAll(async () => {
      m = await createOpenMatch(maitre, ids);
    });

    it("le maître saisit score, buts, passes et cartons ; tout le monde les lit", async () => {
      const { error } = await maitre.rpc("admin_save_match_stats", {
        p_match_id: m, p_score_for: 3, p_score_against: 1,
        p_rows: [
          { player_id: ids[0], goals: 2, assists: 0, yellow: 1, red: 0 },
          { player_id: ids[1], goals: 1, assists: 2, yellow: 0, red: 0 },
          { player_id: ids[2], goals: 0, assists: 0, yellow: 0, red: 0 },
        ],
      });
      expect(error).toBeNull();
      const { data } = await p[5].client.from("match_stats").select("player_id, goals, assists, yellow_cards, red_cards").eq("match_id", m);
      expect(data).toHaveLength(2); // les lignes vides ne sont pas stockées
      const { data: mt } = await p[5].client.from("v_matches").select("score_for, score_against").eq("id", m).single();
      expect(mt).toEqual({ score_for: 3, score_against: 1 });
    });

    it("contrôles : pas plus de 2 jaunes / 1 rouge, joueur absent refusé, joueurs sans droit d'écriture", async () => {
      const bad = await maitre.rpc("admin_save_match_stats", {
        p_match_id: m, p_score_for: 0, p_score_against: 0,
        p_rows: [{ player_id: ids[0], goals: 0, assists: 0, yellow: 3, red: 0 }],
      });
      expect(bad.error?.message).toBe("STATS_INVALID");
      const [outsider] = await createPlayers(1, "absent");
      const absent = await maitre.rpc("admin_save_match_stats", {
        p_match_id: m, p_score_for: 0, p_score_against: 0,
        p_rows: [{ player_id: outsider.playerId, goals: 1 }],
      });
      expect(absent.error?.message).toBe("STATS_NOT_IN_SQUAD");
      // Les données précédentes sont intactes
      expect(await sql("select 1 from match_stats where match_id = $1", [m])).toHaveLength(2);
      const w = await p[0].client.rpc("admin_save_match_stats", { p_match_id: m, p_score_for: 9, p_score_against: 0, p_rows: [] });
      expect(w.error?.message).toBe("FORBIDDEN");
      const ins = await p[0].client.from("match_stats").insert({ match_id: m, player_id: ids[0], goals: 5 });
      expect(ins.error?.code).toBe("42501");
    });
  });

  describe("Suppression d'un match avec votes", () => {
    it("exige la confirmation, efface tout, garde une copie au journal et met à jour le classement", async () => {
      await sql("update app_settings set late_penalty_enabled = true");
      const m = await createOpenMatch(maitre, ids);
      await vote(p[0].client, m, [ids[1], ids[2], ids[4]]);
      await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
      await vote(p[1].client, m, [ids[0], ids[2], ids[4]]);
      await maitre.rpc("admin_save_match_stats", { p_match_id: m, p_score_for: 1, p_score_against: 0, p_rows: [{ player_id: ids[0], goals: 1 }] });
      const season = await currentSeasonId(maitre);
      const before = (await maitre.rpc("admin_season_standings", { p_season_id: season })).data as { player_id: string; gross_points: number }[];
      const grossBefore = before.find((r) => r.player_id === ids[1])!.gross_points;

      expect((await maitre.rpc("admin_delete_match", { p_match_id: m, p_confirm: "oui" })).error?.message).toBe("CONFIRM_REQUIRED");
      expect((await p[0].client.rpc("admin_delete_match", { p_match_id: m, p_confirm: "SUPPRIMER" })).error?.message).toBe("FORBIDDEN");
      expect((await maitre.rpc("admin_delete_match", { p_match_id: m, p_confirm: "SUPPRIMER" })).error).toBeNull();

      for (const t of ["matches where id", "ballots where match_id", "penalties where match_id", "match_stats where match_id", "match_players where match_id"]) {
        expect(await sql(`select 1 from ${t} = $1`, [m]), t).toHaveLength(0);
      }
      const [log] = await sql<{ before_data: { bulletins: unknown[]; malus: unknown[]; statistiques: unknown[] } }>(
        "select before_data from audit_log where action = 'match.suppression' and entity_id = $1",
        [m],
      );
      expect(log.before_data.bulletins).toHaveLength(2);
      expect(log.before_data.malus).toHaveLength(1);
      expect(log.before_data.statistiques).toHaveLength(1);
      const after = (await maitre.rpc("admin_season_standings", { p_season_id: season })).data as { player_id: string; gross_points: number }[];
      expect(after.find((r) => r.player_id === ids[1])!.gross_points).toBe(grossBefore - 3);
    });
  });

  describe("Import de calendrier", () => {
    it("importe en une transaction, ignore les doublons, réservé au maître", async () => {
      const season = await currentSeasonId(maitre);
      const rows = [
        { opponent: "Import FC", kickoff: "2027-02-07T15:00:00", location: "Aubel", opens: "2027-02-07T17:00:00", deadline: "2027-02-09T15:00:00", closes: "2027-02-10T15:00:00", counts: true },
        { opponent: "Import United", kickoff: "2027-03-28T15:00:00", location: null, opens: null, deadline: "2027-03-30T15:00:00", closes: null, counts: false },
      ];
      expect((await p[0].client.rpc("admin_import_matches", { p_season_id: season, p_rows: rows })).error?.message).toBe("FORBIDDEN");
      const { data, error } = await maitre.rpc("admin_import_matches", { p_season_id: season, p_rows: rows });
      expect(error).toBeNull();
      expect(data).toEqual({ created: 2, skipped: 0 });
      const again = await maitre.rpc("admin_import_matches", { p_season_id: season, p_rows: rows });
      expect(again.data).toEqual({ created: 0, skipped: 2 });
      const [m] = await sql<{ k: string }>(
        "select to_char(kickoff_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') k from matches where opponent = 'Import United'",
      );
      expect(m.k).toBe("2027-03-28 13:00"); // heure d'été belge
      // Une ligne invalide annule tout l'import
      const broken = await maitre.rpc("admin_import_matches", {
        p_season_id: season,
        p_rows: [{ ...rows[0], opponent: "Valide" }, { ...rows[0], opponent: "", kickoff: "2027-04-01T15:00:00" }],
      });
      expect(broken.error?.message).toBe("MATCH_FIELDS_REQUIRED");
      expect(await sql("select 1 from matches where opponent = 'Valide'")).toHaveLength(0);
    });
  });

  describe("Notifications", () => {
    it("abonnements : chacun gère et voit seulement les siens ; secrets inaccessibles", async () => {
      const sub = { p_endpoint: "https://push.example.test/abc", p_p256dh: "k", p_auth: "a", p_user_agent: "test" };
      expect((await p[0].client.rpc("save_push_subscription", sub)).error).toBeNull();
      expect((await anonClient().rpc("save_push_subscription", sub)).error?.code).toBe("42501");
      expect((await p[1].client.from("push_subscriptions").select("*")).data).toEqual([]);
      expect((await p[0].client.from("push_subscriptions").select("endpoint")).data).toEqual([{ endpoint: sub.p_endpoint }]);
      expect((await p[0].client.from("app_secrets").select("*")).error?.code).toBe("42501");
      expect((await p[0].client.rpc("svc_get_secret", { p_key: "cron_token" })).error?.code).toBe("42501");
      expect((await adminClient().rpc("svc_get_secret", { p_key: "cron_token" })).data).toMatch(/^[0-9a-f]{64}$/);
    });

    it("à l'ouverture puis avant l'heure limite, uniquement pour ceux qui n'ont pas voté, une seule fois", async () => {
      const admin = adminClient();
      await sql("update app_settings set notify_on_open = true, reminder_hours = 3");
      for (const x of [p[1], p[2]]) {
        await x.client.rpc("save_push_subscription", {
          p_endpoint: `https://push.example.test/${x.username}`, p_p256dh: "k", p_auth: "a", p_user_agent: "t",
        });
      }
      const m = await createOpenMatch(maitre, ids, { deadlineMinutes: 24 * 60 });
      await vote(p[2].client, m, [ids[0], ids[1], ids[4]]);
      const pending = async () =>
        ((await admin.rpc("svc_pending_notifications")).data as { user_id: string; match_id: string; kind: string }[])
          .filter((r) => r.match_id === m);
      let rows = await pending();
      // p0 et p1 sont abonnés et n'ont pas voté ; p2 a voté ; les autres n'ont pas d'abonnement
      expect(rows.map((r) => r.user_id).sort()).toEqual([p[0].userId, p[1].userId].sort());
      expect(rows.every((r) => r.kind === "ouverture")).toBe(true);
      await admin.rpc("svc_mark_notified", {
        p_user_ids: rows.map((r) => r.user_id), p_match_ids: rows.map((r) => r.match_id), p_kinds: rows.map((r) => r.kind),
      });
      expect(await pending()).toEqual([]);
      // Dans la fenêtre de rappel
      await sql("update matches set vote_deadline = now() + interval '2 hours' where id = $1", [m]);
      rows = await pending();
      expect(rows.map((r) => r.kind)).toEqual(["rappel", "rappel"]);
      // Après l'heure limite : plus de rappel
      await sql("update matches set vote_deadline = now() - interval '1 minute' where id = $1", [m]);
      expect(await pending()).toEqual([]);
      // Les joueurs ne peuvent pas déclencher l'envoi
      expect((await p[0].client.rpc("svc_pending_notifications")).error?.code).toBe("42501");
    });
  });
});
