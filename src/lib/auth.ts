import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";

export type Role = "maitre" | "joueur";

export type Viewer = {
  userId: string;
  username: string;
  role: Role;
  playerId: string | null;
  displayName: string;
  mustChangePassword: boolean;
};

/**
 * Couche d'accès : identité vérifiée auprès du serveur d'authentification
 * (getUser) puis profil lu sous RLS. Mémorisée pour la durée de la requête.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, username, role, player_id, active, must_change_password, players(display_name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile || !profile.active) return null;
  const player = profile.players as unknown as { display_name: string } | null;

  return {
    userId: profile.user_id,
    username: profile.username,
    role: profile.role as Role,
    playerId: profile.player_id,
    displayName: player?.display_name ?? profile.username,
    mustChangePassword: profile.must_change_password,
  };
});

export async function requireViewer(options: { allowPasswordChange?: boolean } = {}): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/connexion");
  if (viewer.mustChangePassword && !options.allowPasswordChange) redirect("/premiere-connexion");
  return viewer;
}

/** Réservé au maître : toute autre personne reçoit une page 404. */
export async function requireMaitre(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "maitre") notFound();
  return viewer;
}
