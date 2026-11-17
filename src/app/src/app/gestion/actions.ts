"use server";

// Actions de l’administrateur. Chaque action revérifie le rôle côté serveur
// (requireMaitre) ; la base revérifie ensuite elle-même (require_maitre)
// et journalise toute modification.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountError, createAccount, resetPassword, setAccountActive, setAccountRole } from "@/lib/accounts";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { requireMaitre, requireStaff } from "@/lib/auth";
import { loginEmailDomain } from "@/lib/env";
import { translateError } from "@/lib/errors";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { parseLocalInput } from "@/lib/time";
import { rememberSiteUrl } from "@/lib/origin";
import { sendPendingNotifications, sendScheduledNotifications } from "@/lib/push";

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
  await requireStaff();
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
  const { error: homeError } = await supabase.rpc("admin_set_match_home", {
    p_match_id: data,
    p_is_home: fd.get("is_home") !== "away",
  });
  if (homeError) return failure(translateError(homeError));
  done(["/gestion/matchs", `/gestion/matchs/${data}`]);
  if (!id) redirect(`/gestion/matchs/${data}`);
  return success("Match enregistré.");
}

export async function setVoteStateAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = optUuid(fd, "match_id");
  const state = str(fd, "state");
  if (!id || !["ouvert", "ferme", "a_venir", "auto"].includes(state)) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_set_vote_state", {
    p_match_id: id,
    p_state: state === "auto" ? null : state,
  });
  if (error) return failure(translateError(error));
  done([`/gestion/matchs/${id}`, "/gestion/matchs", "/gestion"]);
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
  await requireStaff();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const archived = fd.get("archived") === "true";
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_archived", { p_match_id: id, p_archived: archived });
  if (error) return failure(translateError(error));
  done([`/gestion/matchs/${id}`, "/gestion/matchs"]);
  return success(archived ? "Match archivé : masqué du calendrier des joueurs." : "Match désarchivé.");
}

export async function deleteMatchAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_delete_match", {
    p_match_id: id,
    p_confirm: str(fd, "confirm").toUpperCase() || null,
  });
  if (error) return failure(translateError(error));
  done(["/gestion/matchs"]);
  redirect("/gestion/matchs");
}

export async function saveSheetAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = optUuid(fd, "match_id");
  const ids = fd.getAll("player").map(String).filter((v) => uuid.safeParse(v).success);
  if (!id) return failure("Requête invalide.");
  const roles = ids.map((pid) => roleOf(str(fd, `role_${pid}`)));
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_set_match_sheet", { p_match_id: id, p_player_ids: ids, p_roles: roles });
  if (error) return failure(translateError(error));
  done([`/gestion/matchs/${id}`, `/match/${id}`]);
  return success(`Feuille de match enregistrée : ${data} présent${Number(data) > 1 ? "s" : ""}.`);
}

export async function saveNotificationSettingsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const hours = intOrNull(fd, "reminder_hours");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_notification_prefs", {
    p_notify_on_open: fd.get("notify_on_open") === "on",
    p_reminder_hours: hours ?? 0,
    p_notify_availability: fd.get("notify_availability") === "on",
    p_notify_convocation: fd.get("notify_convocation") === "on",
  });
  if (error) return failure(translateError(error));
  await rememberSiteUrl(createServiceClient());
  done(["/gestion/notifications"]);
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
  done(["/gestion/reglages"]);
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
  done(["/gestion/reglages", "/gestion", "/gestion/matchs", "/gestion/classement"]);
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
  done(["/gestion/equipe"]);
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
      role: str(fd, "account_role") === "entraineur" ? "entraineur" : "joueur",
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
    done(["/gestion/equipe"]);
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
    done(["/gestion/equipe"]);
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
  done(["/gestion/equipe"]);
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
  done([`/gestion/resultats/${matchId}`, "/gestion/classement"]);
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
  done([`/gestion/resultats/${matchId}`, "/gestion/classement"]);
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
  done([`/gestion/resultats/${matchId}`, "/gestion/classement", "/gestion/malus"]);
  return success("Malus mis à jour et journalisé.");
}

// ---------------------------------------------------------------- Disponibilités et convocation
export async function adminSetAvailabilityAction(matchId: string, playerId: string, status: string | null): Promise<ActionResult> {
  await requireStaff();
  if (!uuid.safeParse(matchId).success || !uuid.safeParse(playerId).success) return failure("Requête invalide.");
  if (status !== null && !["present", "absent", "incertain"].includes(status)) return failure("Statut invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_availability", { p_match_id: matchId, p_player_id: playerId, p_status: status });
  if (error) return failure(translateError(error));
  done([`/gestion/matchs/${matchId}`, `/match/${matchId}`]);
  return success("Disponibilité mise à jour.");
}

export async function validateSheetAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const id = optUuid(fd, "match_id");
  if (!id) return failure("Requête invalide.");
  const validated = fd.get("validated") === "true";
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_validate_sheet", { p_match_id: id, p_validated: validated });
  if (error) return failure(translateError(error));
  done([`/gestion/matchs/${id}`, `/match/${id}`]);
  if (validated) {
    try {
      const admin = createServiceClient();
      await sendPendingNotifications(admin, await rememberSiteUrl(admin));
    } catch {
      // Le planificateur réessaiera.
    }
  }
  return success(
    validated
      ? "Feuille validée : les joueurs voient leur convocation (et la reçoivent en notification s'ils l'ont activée)."
      : "Feuille rouverte : les joueurs peuvent à nouveau modifier leur disponibilité.",
  );
}

// ---------------------------------------------------------------- Notifications libres
export async function scheduleNotificationAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const title = str(fd, "title");
  const body = str(fd, "body");
  const audience = str(fd, "audience");
  const matchId = optUuid(fd, "match_id");
  if (!title || title.length > 60) return failure("Titre obligatoire (60 caractères maximum).");
  if (!body || body.length > 200) return failure("Message obligatoire (200 caractères maximum).");
  if (!["tous", "feuille", "moi"].includes(audience)) return failure("Choisissez les destinataires.");
  if (audience === "feuille" && !matchId) return failure("Choisissez le match.");
  let when: string | null = null;
  if (fd.get("when") === "plus_tard") {
    try {
      when = parseLocalInput(fd.get("send_at"));
    } catch {
      return failure("Date d'envoi invalide.");
    }
    if (!when) return failure("Indiquez la date et l'heure d'envoi.");
  }
  const url = fd.get("link") === "match" && matchId ? `/match/${matchId}` : "/";
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_schedule_notification", {
    p_title: title,
    p_body: body,
    p_audience: audience,
    p_match_id: audience === "feuille" || url !== "/" ? matchId : null,
    p_send_local: when,
    p_url: url,
  });
  if (error) return failure(translateError(error));
  const admin = createServiceClient();
  const origin = await rememberSiteUrl(admin);
  if (!when) {
    const report = await sendScheduledNotifications(admin, origin);
    done(["/gestion/notifications"]);
    return report.sent > 0
      ? success(`Notification envoyée à ${report.sent} appareil${report.sent > 1 ? "s" : ""}${report.failed ? ` (${report.failed} échec${report.failed > 1 ? "s" : ""})` : ""}.`)
      : failure("Aucun appareil n'a reçu la notification : aucun destinataire n'a activé les notifications.");
  }
  done(["/gestion/notifications"]);
  return success("Notification programmée. Elle partira automatiquement (vérifiez l'état du planificateur ci-dessous).");
}

export async function cancelNotificationAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const id = optUuid(fd, "id");
  if (!id) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_cancel_notification", { p_id: id });
  if (error) return failure(translateError(error));
  done(["/gestion/notifications"]);
  return success("Notification annulée.");
}

export async function runDispatchNowAction(): Promise<ActionResult> {
  await requireMaitre();
  const admin = createServiceClient();
  const origin = await rememberSiteUrl(admin);
  const auto = await sendPendingNotifications(admin, origin);
  const scheduled = await sendScheduledNotifications(admin, origin);
  done(["/gestion/notifications"]);
  const sent = auto.sent + scheduled.sent;
  return success(
    sent === 0
      ? "Rien à envoyer pour l'instant : aucune notification n'est due."
      : `${sent} notification${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""}.`,
  );
}

export async function saveClubNameAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMaitre();
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_save_club_name", { p_name: str(fd, "club_name") });
  if (error) return failure(translateError(error));
  revalidatePath("/", "layout");
  return success("Nom du club enregistré.");
}

export async function setAccountRoleAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const viewer = await requireMaitre();
  const userId = optUuid(fd, "user_id");
  const role = str(fd, "role") === "entraineur" ? "entraineur" : "joueur";
  if (!userId) return failure("Requête invalide.");
  try {
    await setAccountRole(createServiceClient(), viewer.userId, userId, role);
  } catch (e) {
    return failure(accountMessage(e, "Changement de rôle impossible."));
  }
  done(["/gestion/equipe"]);
  return success(role === "entraineur" ? "Rôle entraîneur attribué." : "Rôle entraîneur retiré : compte joueur.");
}
