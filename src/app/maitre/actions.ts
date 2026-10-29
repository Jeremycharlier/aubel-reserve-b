"use server";

// Actions du maître. Chaque action revérifie le rôle côté serveur
// (requireMaitre) ; la base revérifie ensuite elle-même (require_maitre)
// et journalise toute modification.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountError, createAccount, resetPassword, setAccountActive } from "@/lib/accounts";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { requireMaitre } from "@/lib/auth";
import { loginEmailDomain } from "@/lib/env";
import { translateError } from "@/lib/errors";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { parseLocalInput } from "@/lib/time";
import { rememberSiteUrl } from "@/lib/origin";
import { sendPendingNotifications } from "@/lib/push";

const uuid = z.uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optUuid = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v && uuid.safeParse(v).success ? v : null;
};
const ROLES = ["joueur", "delegue", "supporter"] as const;
const roleOf = (v: string) => (ROLES as readonly string[]).includes(v) ? (v as (typeof ROLES)[number]) : "joueur";
const dateOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const intOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

function accountMessage(e: unknown, fallback: string): string {
  if (!(e instanceof AccountError)) return fallback;
  const translated = translateError(e.message);
  return translated === translateError("") ? e.message : translated;
}

function done(paths: string[]) {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- Matchs
export async function saveMatchAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "id");
  const seasonId = optUuid(fd, "season_id");
  if (!seasonId) return failure("Choisissez une saison.");
  let times: Record<string, string | null>;
  try {
    times = {
      kickoff: parseLocalInput(fd.get("kickoff")),
      opens: parseLocalInput(fd.get("opens")),
      closes: parseLocalInput(fd.get("closes")),
      deadline: parseLocalInput(fd.get("deadline")),
    };
  } catch {
    return failure("Date ou heure invalide.");
  }
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_save_match", {
    p_id: id,
    p_season_id: seasonId,
    p_opponent: str(fd, "opponent"),
    p_kickoff_local: times.kickoff,
    p_location: str(fd, "location") || null,
    p_opens_local: times.opens,
    p_closes_local: times.closes,
    p_deadline_local: times.deadline,
    p_counts_for_ranking: fd.get("counts") === "on",
  });
  if (error) return failure(translateError(error));
  done(["/maitre/matchs", `/maitre/matchs/${data}`]);
  if (!id) redirect(`/maitre/matchs/${data}`);
  return success("Match enregistré.");
}

export async function setVoteStateAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "match_id");
  const state = str(fd, "state");
  if (!id || !["ouvert", "ferme", "a_venir", "auto"].includes(state)) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_set_vote_state", {
    p_match_id: id,
    p_state: state === "auto" ? null : state,
  });
  if (error) return failure(translateError(error));
  done([`/maitre/matchs/${id}`, "/maitre/matchs", "/maitre"]);
  if (data === "ouvert") {
    // Notifications d'ouverture immédiates (sans attendre le planificateur)
    try {
      const admin = createServiceClient();
      await sendPendingNotifications(admin, await rememberSiteUrl(admin));
    } catch {
      // L'envoi sera retenté par le planificateur.
    }
  }
  const label = { ouvert: "ouvert", ferme: "fermé", a_venir: "à venir" }[data as string] ?? String(data);
  return success(state === "auto" ? `Mode automatique rétabli : vote ${label}.` : `Vote ${label}.`);
}

export async function setArchivedAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const archived = fd.get("archived") === "true";
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_archived", { p_match_id: id, p_archived: archived });
  if (error) return failure(translateError(error));
  done([`/maitre/matchs/${id}`, "/maitre/matchs"]);
  return success(archived ? "Match archivé : masqué du calendrier des joueurs." : "Match désarchivé.");
}

export async function deleteMatchAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_delete_match", {
    p_match_id: id,
    p_confirm: str(fd, "confirm").toUpperCase() || null,
  });
  if (error) return failure(translateError(error));
  done(["/maitre/matchs"]);
  redirect("/maitre/matchs");
}

export async function saveSheetAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "match_id");
  const ids = fd.getAll("player").map(String).filter((v) => uuid.safeParse(v).success);
  if (!id) return failure("Requête invalide.");
  const roles = ids.map((pid) => roleOf(str(fd, `role_${pid}`)));
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_set_match_sheet", { p_match_id: id, p_player_ids: ids, p_roles: roles });
  if (error) return failure(translateError(error));
  done([`/maitre/matchs/${id}`, `/match/${id}`]);
  return success(`Feuille de match enregistrée : ${data} présent${Number(data) > 1 ? "s" : ""}.`);
}

const statInt = (fd: FormData, k: string, max: number) => {
  const n = Number(str(fd, k) || "0");
  return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN;
};

export async function saveStatsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const sf = str(fd, "score_for");
  const sa = str(fd, "score_against");
  const scoreFor = sf === "" ? null : Number(sf);
  const scoreAgainst = sa === "" ? null : Number(sa);
  if ([scoreFor, scoreAgainst].some((v) => v !== null && !(Number.isInteger(v) && v >= 0 && v <= 99))) {
    return failure("Score invalide.");
  }
  const rows = fd
    .getAll("player")
    .map(String)
    .filter((v) => uuid.safeParse(v).success)
    .map((pid) => ({
      player_id: pid,
      goals: statInt(fd, `goals_${pid}`, 20),
      assists: statInt(fd, `assists_${pid}`, 20),
      yellow: statInt(fd, `yellow_${pid}`, 2),
      red: statInt(fd, `red_${pid}`, 1),
    }));
  if (rows.some((r) => [r.goals, r.assists, r.yellow, r.red].some(Number.isNaN))) {
    return failure("Valeurs invalides : 2 cartons jaunes et 1 rouge maximum par joueur.");
  }
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_match_stats", {
    p_match_id: id,
    p_score_for: scoreFor,
    p_score_against: scoreAgainst,
    p_rows: rows,
  });
  if (error) return failure(translateError(error));
  done([`/maitre/matchs/${id}`, `/match/${id}`, "/joueurs"]);
  return success("Score et statistiques enregistrés. Ils sont visibles par tous les joueurs.");
}

export async function saveNotificationSettingsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const hours = intOrNull(fd, "reminder_hours");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_notification_settings", {
    p_notify_on_open: fd.get("notify_on_open") === "on",
    p_reminder_hours: hours ?? 0,
  });
  if (error) return failure(translateError(error));
  await rememberSiteUrl(createServiceClient());
  done(["/maitre/reglages"]);
  return success("Réglages des notifications enregistrés.");
}

// ---------------------------------------------------------------- Règles et saisons
export async function saveSettingsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const late = intOrNull(fd, "late_points");
  const nonvote = intOrNull(fd, "nonvote_points");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_settings", {
    p_late_enabled: fd.get("late_enabled") === "on",
    p_late_points: late,
    p_nonvote_enabled: fd.get("nonvote_enabled") === "on",
    p_nonvote_points: nonvote,
  });
  if (error) return failure(translateError(error));
  done(["/maitre/reglages"]);
  return success("Règles enregistrées. Elles s'appliquent aux prochains bulletins et clôtures.");
}

export async function saveSeasonAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const name = str(fd, "name");
  if (!name) return failure("Donnez un nom à la saison (ex. 2026-2027).");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_season", {
    p_id: optUuid(fd, "id"),
    p_name: name,
    p_starts_on: str(fd, "starts_on") || null,
    p_ends_on: str(fd, "ends_on") || null,
    p_make_current: fd.get("is_current") === "on",
  });
  if (error) return failure(translateError(error));
  done(["/maitre/reglages", "/maitre", "/maitre/matchs", "/maitre/classement"]);
  return success("Saison enregistrée.");
}

// ---------------------------------------------------------------- Équipe et comptes
export async function savePlayerAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const shirt = intOrNull(fd, "shirt_number");
  if (Number.isNaN(shirt) || (shirt !== null && (shirt < 1 || shirt > 99))) return failure("Numéro de maillot entre 1 et 99.");
  const name = str(fd, "full_name");
  if (!name) return failure("Indiquez le nom du joueur.");
  const nickname = str(fd, "nickname");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_player_full", {
    p_id: optUuid(fd, "id"),
    p_full_name: name,
    p_nickname: nickname || null,
    p_use_nickname: fd.get("use_nickname") === "on" && nickname !== "",
    p_birth_date: dateOrNull(fd, "birth_date"),
    p_shirt_number: shirt,
    p_default_role: roleOf(str(fd, "default_role")),
    p_active: fd.has("active_field") ? fd.get("active") === "on" : true,
  });
  if (error) return failure(translateError(error));
  done(["/maitre/equipe"]);
  return success("Joueur enregistré.");
}

export type Credentials = { username: string; tempPassword: string; displayName: string };

export async function createAccountAction(_p: ActionResult<Credentials>, fd: FormData): Promise<ActionResult<Credentials>> {
  const viewer = await requireMaitre();
  const playerId = optUuid(fd, "player_id");
  const newName = str(fd, "new_player_name");
  const shirt = intOrNull(fd, "shirt_number");
  if (Number.isNaN(shirt)) return failure("Numéro de maillot invalide.");
  try {
    const acc = await createAccount(createServiceClient(), viewer.userId, loginEmailDomain(), {
      username: str(fd, "username"),
      playerId,
      newPlayerName: playerId ? null : newName,
      shirtNumber: shirt,
    });
    // Compléments de fiche (surnom, naissance, statut) si renseignés
    const nickname = str(fd, "nickname");
    const role = roleOf(str(fd, "default_role"));
    const birth = dateOrNull(fd, "birth_date");
    if (!playerId && (nickname || birth || role !== "joueur")) {
      const supabase = await createUserClient();
      await supabase.rpc("admin_save_player_full", {
        p_id: acc.playerId,
        p_full_name: newName,
        p_nickname: nickname || null,
        p_use_nickname: fd.get("use_nickname") === "on" && nickname !== "",
        p_birth_date: birth,
        p_shirt_number: shirt,
        p_default_role: role,
        p_active: true,
      });
    }
    done(["/maitre/equipe"]);
    return success("Compte créé. Transmettez ces accès au joueur en main propre.", {
      username: acc.username,
      tempPassword: acc.tempPassword,
      displayName: newName || "le joueur",
    });
  } catch (e) {
    return failure(accountMessage(e, "Création impossible."));
  }
}

export async function resetPasswordAction(_p: ActionResult<Credentials>, fd: FormData): Promise<ActionResult<Credentials>> {
  const viewer = await requireMaitre();
  const userId = optUuid(fd, "user_id");
  if (!userId) return failure("Requête invalide.");
  try {
    const temp = await resetPassword(createServiceClient(), viewer.userId, userId);
    done(["/maitre/equipe"]);
    return success("Nouveau mot de passe temporaire généré. Le joueur devra le changer à sa prochaine connexion.", {
      username: str(fd, "username"),
      tempPassword: temp,
      displayName: str(fd, "display_name"),
    });
  } catch (e) {
    return failure(accountMessage(e, "Réinitialisation impossible."));
  }
}

export async function setAccountActiveAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const viewer = await requireMaitre();
  const userId = optUuid(fd, "user_id");
  if (!userId) return failure("Requête invalide.");
  const active = fd.get("active") === "true";
  try {
    await setAccountActive(createServiceClient(), viewer.userId, userId, active);
  } catch (e) {
    return failure(accountMessage(e, "Opération impossible."));
  }
  done(["/maitre/equipe"]);
  return success(active ? "Compte réactivé." : "Compte désactivé. Son historique est conservé.");
}

// ---------------------------------------------------------------- Corrections
export async function correctBallotAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const matchId = optUuid(fd, "match_id");
  const voter = optUuid(fd, "voter_player_id");
  const picks = [optUuid(fd, "pick1"), optUuid(fd, "pick2"), optUuid(fd, "pick3")];
  if (!matchId || !voter || picks.some((p) => !p)) return failure("Choisissez le votant et ses trois joueurs.");
  const lateRaw = str(fd, "is_late");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_correct_ballot", {
    p_match_id: matchId,
    p_voter_player_id: voter,
    p_selections: picks,
    p_is_late: lateRaw === "" ? null : lateRaw === "true",
    p_reason: str(fd, "reason"),
  });
  if (error) return failure(translateError(error));
  done([`/maitre/resultats/${matchId}`, "/maitre/classement"]);
  return success("Correction enregistrée et journalisée.");
}

export async function setBallotStatusAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "ballot_id");
  const matchId = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const status = str(fd, "status");
  const { error } = await supabase.rpc("admin_set_ballot_status", {
    p_ballot_id: id,
    p_status: status,
    p_reason: str(fd, "reason"),
  });
  if (error) return failure(translateError(error));
  done([`/maitre/resultats/${matchId}`, "/maitre/classement"]);
  return success(status === "annule" ? "Bulletin annulé : il n'est plus compté." : "Bulletin rétabli.");
}

export async function setPenaltyAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const matchId = optUuid(fd, "match_id");
  const playerId = optUuid(fd, "player_id");
  if (!matchId || !playerId) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_penalty", {
    p_match_id: matchId,
    p_player_id: playerId,
    p_kind: str(fd, "kind") === "non_vote" ? "non_vote" : "retard",
    p_points: intOrNull(fd, "points"),
    p_status: str(fd, "status") === "annulee" ? "annulee" : "active",
    p_reason: str(fd, "reason"),
  });
  if (error) return failure(translateError(error));
  done([`/maitre/resultats/${matchId}`, "/maitre/classement", "/maitre/malus"]);
  return success("Malus mis à jour et journalisé.");
}
