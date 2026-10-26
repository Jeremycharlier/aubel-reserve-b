import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serviceKey } from "@/lib/env";

/** Client agissant au nom de l'utilisateur connecté (soumis à la RLS). */
export async function createUserClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = publicEnv();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appel depuis un Server Component : le proxy rafraîchit la session.
        }
      },
    },
  });
}

/**
 * Client « service » : contourne la RLS. Réservé aux opérations serveur
 * précédées d'une vérification explicite du rôle maître.
 */
export function createServiceClient(): SupabaseClient {
  const { supabaseUrl } = publicEnv();
  return createClient(supabaseUrl, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
