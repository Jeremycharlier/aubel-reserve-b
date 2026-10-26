// Opérations sur les comptes. Les fonctions reçoivent leurs clients en
// paramètre (testables contre une vraie pile Supabase) et vérifient
// systématiquement le rôle maître de l'auteur côté base.
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_MIN = 8;

export class AccountError extends Error {}

export function normalizeUsername(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".");
}

export function usernameToEmail(username: string, domain: string): string {
  return `${normalizeUsername(username)}@${domain}`;
}

/** Mot de passe temporaire lisible (sans caractères ambigus), ex. « K7PQ-M3XR-9TBW ». */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

export function validateNewPassword(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Au moins ${PASSWORD_MIN} caractères.`;
  if (password.length > 72) return "72 caractères maximum.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Utilisez au moins une lettre et un chiffre.";
  }
  if (username && password.toLowerCase().includes(normalizeUsername(username))) {
    return "Le mot de passe ne doit pas contenir votre identifiant.";
  }
  return null;
}

async function assertMaitre(admin: SupabaseClient, actorId: string) {
  const { error } = await admin.rpc("svc_require_maitre", { p_actor: actorId });
  if (error) throw new AccountError("FORBIDDEN");
}

export type CreateAccountInput = {
  username: string;
  role?: "joueur" | "maitre";
  playerId?: string | null;
  newPlayerName?: string | null;
  shirtNumber?: number | null;
};

export async function createAccount(
  admin: SupabaseClient,
  actorId: string,
  domain: string,
  input: CreateAccountInput,
): Promise<{ userId: string; playerId: string; username: string; tempPassword: string }> {
  await assertMaitre(admin, actorId);
  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) {
    throw new AccountError("Identifiant invalide : 3 à 32 caractères parmi a-z, 0-9, point, tiret, tiret bas.");
  }
  if (!input.playerId && !input.newPlayerName?.trim()) {
    throw new AccountError("Choisissez un joueur existant ou indiquez le nom du nouveau joueur.");
  }

  const { data: existing } = await admin.from("profiles").select("user_id").eq("username", username).maybeSingle();
  if (existing) throw new AccountError("Cet identifiant est déjà utilisé.");
  if (input.playerId) {
    const { data: linked } = await admin
      .from("profiles")
      .select("user_id")
      .eq("player_id", input.playerId)
      .maybeSingle();
    if (linked) throw new AccountError("Ce joueur possède déjà un compte.");
  }

  const tempPassword = generateTempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username, domain),
    password: tempPassword,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new AccountError(
      createErr?.message?.includes("already") ? "Cet identifiant est déjà utilisé." : "Création du compte impossible.",
    );
  }

  const { data: playerId, error } = await admin.rpc("svc_create_account", {
    p_actor: actorId,
    p_user_id: created.user.id,
    p_username: username,
    p_role: input.role ?? "joueur",
    p_player_id: input.playerId ?? null,
    p_new_player_name: input.newPlayerName?.trim() || null,
    p_shirt_number: input.shirtNumber ?? null,
  });
  if (error) {
    // Compensation : on ne laisse pas d'utilisateur orphelin
    await admin.auth.admin.deleteUser(created.user.id);
    throw new AccountError(error.message);
  }
  return { userId: created.user.id, playerId: playerId as string, username, tempPassword };
}

export async function resetPassword(
  admin: SupabaseClient,
  actorId: string,
  userId: string,
): Promise<string> {
  await assertMaitre(admin, actorId);
  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) throw new AccountError("Réinitialisation impossible.");
  const { error: markErr } = await admin.rpc("svc_mark_password_reset", { p_actor: actorId, p_user_id: userId });
  if (markErr) throw new AccountError(markErr.message);
  return tempPassword;
}

export async function setAccountActive(
  admin: SupabaseClient,
  actorId: string,
  userId: string,
  active: boolean,
): Promise<void> {
  await assertMaitre(admin, actorId);
  const { error } = await admin.rpc("svc_set_account_active", {
    p_actor: actorId,
    p_user_id: userId,
    p_active: active,
  });
  if (error) throw new AccountError(error.message);
  // Un compte désactivé est banni côté authentification : ses sessions ne
  // peuvent plus être prolongées et toute nouvelle connexion est refusée.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banErr) throw new AccountError("Le statut d'authentification n'a pas pu être mis à jour.");
}

export type LoginResult = { ok: true } | { ok: false; reason: "invalid" | "throttled" | "disabled" };

/**
 * Connexion par identifiant. Le client utilisateur reçoit la session ;
 * le client service applique la limitation des tentatives.
 */
export async function loginWithUsername(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  domain: string,
  rawUsername: string,
  password: string,
  ip: string | null,
): Promise<LoginResult> {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RE.test(username) || !password) return { ok: false, reason: "invalid" };

  const { data: allowed } = await admin.rpc("svc_login_allowed", { p_username: username, p_ip: ip });
  if (allowed === false) return { ok: false, reason: "throttled" };

  const { data, error } = await userClient.auth.signInWithPassword({
    email: usernameToEmail(username, domain),
    password,
  });
  if (error || !data.user) {
    await admin.rpc("svc_login_record", { p_username: username, p_ip: ip, p_success: false });
    const banned = error?.message?.toLowerCase().includes("banned");
    return { ok: false, reason: banned ? "disabled" : "invalid" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!profile?.active) {
    await userClient.auth.signOut();
    return { ok: false, reason: "disabled" };
  }
  await admin.rpc("svc_login_record", { p_username: username, p_ip: ip, p_success: true });
  return { ok: true };
}

/** Création du premier compte maître (au déploiement, via scripts/create-maitre.ts). */
export async function bootstrapMaitre(
  admin: SupabaseClient,
  domain: string,
  input: { username: string; displayName: string; password: string; shirtNumber?: number | null },
): Promise<{ userId: string; playerId: string }> {
  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) throw new AccountError("Identifiant invalide.");
  const invalid = validateNewPassword(input.password, username);
  if (invalid) throw new AccountError(invalid);
  const { count } = await admin.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "maitre");
  if ((count ?? 0) > 0) throw new AccountError("Un compte maître existe déjà.");

  const { data: created, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username, domain),
    password: input.password,
    email_confirm: true,
  });
  if (error || !created.user) throw new AccountError(`Création impossible : ${error?.message ?? "inconnue"}`);
  const { data: playerId, error: rpcErr } = await admin.rpc("svc_bootstrap_maitre", {
    p_user_id: created.user.id,
    p_username: username,
    p_display_name: input.displayName,
    p_shirt_number: input.shirtNumber ?? null,
  });
  if (rpcErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new AccountError(rpcErr.message);
  }
  return { userId: created.user.id, playerId: playerId as string };
}

/** Changement de son propre mot de passe (première connexion ou profil). */
export async function changeOwnPassword(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  userId: string,
  username: string,
  newPassword: string,
): Promise<void> {
  const invalid = validateNewPassword(newPassword, username);
  if (invalid) throw new AccountError(invalid);
  const { error } = await userClient.auth.updateUser({ password: newPassword });
  if (error) {
    throw new AccountError(
      error.message.toLowerCase().includes("different")
        ? "Choisissez un mot de passe différent du mot de passe temporaire."
        : "Le mot de passe n'a pas pu être modifié.",
    );
  }
  const { error: rpcErr } = await admin.rpc("svc_password_changed", { p_user_id: userId });
  if (rpcErr) throw new AccountError("Le mot de passe a été modifié mais le profil n'a pas été mis à jour.");
}
