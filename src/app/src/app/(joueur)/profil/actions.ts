"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { translateError } from "@/lib/errors";
import { createUserClient } from "@/lib/supabase/server";

export async function updateProfileAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireViewer();
  const nickname = String(fd.get("nickname") ?? "").trim();
  const birth = String(fd.get("birth_date") ?? "").trim();
  if (nickname.length > 30) return failure("Surnom : 30 caractères maximum.");
  if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return failure("Date de naissance invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_nickname: nickname || null,
    p_use_nickname: fd.get("use_nickname") === "on" && nickname !== "",
    p_birth_date: birth || null,
  });
  if (error) return failure(translateError(error));
  revalidatePath("/", "layout");
  return success("Profil enregistré.");
}
