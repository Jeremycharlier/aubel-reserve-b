"use server";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { AccountError, changeOwnPassword, usernameToEmail } from "@/lib/accounts";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { requireViewer } from "@/lib/auth";
import { loginEmailDomain, publicEnv } from "@/lib/env";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const viewer = await requireViewer({ allowPasswordChange: true });
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return failure("Les deux mots de passe ne correspondent pas.");

  // Hors première connexion, on exige le mot de passe actuel.
  if (!viewer.mustChangePassword) {
    const { supabaseUrl, supabaseKey } = publicEnv();
    const probe = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await probe.auth.signInWithPassword({
      email: usernameToEmail(viewer.username, loginEmailDomain()),
      password: current,
    });
    if (error) return failure("Mot de passe actuel incorrect.");
    await probe.auth.signOut({ scope: "local" });
  }

  try {
    await changeOwnPassword(createServiceClient(), await createUserClient(), viewer.userId, viewer.username, next);
  } catch (e) {
    return failure(e instanceof AccountError ? e.message : "Le mot de passe n'a pas pu être modifié.");
  }
  if (viewer.mustChangePassword) redirect("/");
  return success("Mot de passe modifié.");
}
