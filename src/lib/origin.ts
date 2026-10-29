import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Adresse publique du site (ex. https://aubel-reserve-b.vercel.app). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Mémorise l'adresse du site dans la base pour que le planificateur
 * (pg_cron + pg_net) sache quelle adresse réveiller pour les rappels.
 */
export async function rememberSiteUrl(admin: SupabaseClient): Promise<string> {
  const origin = await requestOrigin();
  if (origin.startsWith("https://")) {
    const { data } = await admin.rpc("svc_get_secret", { p_key: "site_url" });
    if (data !== origin) {
      await admin.rpc("svc_set_secret", { p_key: "site_url", p_value: origin, p_overwrite: true });
    }
  }
  return origin;
}
