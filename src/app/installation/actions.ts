"use server";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountError, bootstrapMaitre, loginWithUsername } from "@/lib/accounts";
import { failure, type ActionResult } from "@/lib/action-result";
import { loginEmailDomain } from "@/lib/env";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

/** Vrai tant qu'aucun compte maître n'existe. */
export async function installationOpen(): Promise<boolean> {
  const { count, error } = await createServiceClient()
    .from("profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "maitre");
  if (error) throw new Error("La base de données n'est pas prête (migrations appliquées ?).");
  return (count ?? 0) === 0;
}

function tokenMatches(given: string): boolean {
  const expected = process.env.SETUP_TOKEN ?? "";
  if (expected.length < 16 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Création du premier compte maître depuis le navigateur. Exige le code
 * SETUP_TOKEN (variable d'environnement), ne fonctionne qu'une seule fois,
 * et les essais de code erronés sont limités comme les connexions.
 */
export async function installAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = createServiceClient();
  if (!(await installationOpen())) return failure("L'installation est déjà terminée.");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const { data: allowed } = await admin.rpc("svc_login_allowed", { p_username: "__installation__", p_ip: ip });
  if (allowed === false) return failure("Trop d'essais. Réessayez dans 15 minutes.");

  if (!tokenMatches(String(fd.get("token") ?? "").trim())) {
    await admin.rpc("svc_login_record", { p_username: "__installation__", p_ip: ip, p_success: false });
    return failure(
      process.env.SETUP_TOKEN ? "Code d'installation incorrect." : "SETUP_TOKEN n'est pas configuré dans Vercel.",
    );
  }

  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return failure("Les deux mots de passe ne correspondent pas.");
  const shirt = String(fd.get("shirt_number") ?? "").trim();

  try {
    await bootstrapMaitre(admin, loginEmailDomain(), {
      username,
      displayName: String(fd.get("display_name") ?? "").trim(),
      password,
      shirtNumber: shirt ? Number(shirt) : null,
    });
  } catch (e) {
    return failure(e instanceof AccountError ? e.message : "Création impossible.");
  }
  await loginWithUsername(admin, await createUserClient(), loginEmailDomain(), username, password, ip);
  redirect("/maitre/reglages");
}
