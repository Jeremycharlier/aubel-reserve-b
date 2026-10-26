"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginWithUsername } from "@/lib/accounts";
import { failure, type ActionResult } from "@/lib/action-result";
import { loginEmailDomain } from "@/lib/env";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const userClient = await createUserClient();
  const result = await loginWithUsername(
    createServiceClient(),
    userClient,
    loginEmailDomain(),
    username,
    password,
    await clientIp(),
  );
  if (!result.ok) {
    const messages = {
      invalid: "Identifiant ou mot de passe incorrect.",
      throttled: "Trop de tentatives. Réessayez dans 15 minutes ou demandez au maître de vérifier votre compte.",
      disabled: "Ce compte est désactivé. Contactez le maître.",
    };
    return failure(messages[result.reason]);
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
