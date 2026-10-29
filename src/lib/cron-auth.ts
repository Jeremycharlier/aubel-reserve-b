import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function same(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Autorise les appels planifiés : Vercel Cron (CRON_SECRET) ou la base
 * Supabase elle-même (jeton aléatoire généré par la migration 5).
 */
export async function isAuthorizedCron(authorization: string | null, admin: SupabaseClient): Promise<boolean> {
  const given = authorization ?? "";
  if (!given.startsWith("Bearer ") || given.length < 30) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && secret.length >= 16 && same(given, `Bearer ${secret}`)) return true;
  const { data } = await admin.rpc("svc_get_secret", { p_key: "cron_token" });
  return typeof data === "string" && data.length >= 32 && same(given, `Bearer ${data}`);
}
