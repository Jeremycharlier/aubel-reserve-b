// Traduction des codes d'erreur levés par la base de données.
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous.",
  FORBIDDEN: "Action réservée au maître.",
  NO_PLAYER: "Votre compte n'est rattaché à aucun joueur.",
  MATCH_NOT_FOUND: "Match introuvable.",
  NOT_FOUND: "Élément introuvable.",
  VOTE_CLOSED: "Le vote est fermé pour ce match.",
  NOT_IN_SQUAD: "Vous ne figurez pas sur la feuille de ce match.",
  NEED_THREE: "Sélectionnez exactement trois coéquipiers.",
  DUPLICATE_SELECTION: "Un même joueur ne peut être choisi qu'une seule fois.",
  SELF_VOTE: "Vous ne pouvez pas voter pour vous-même.",
  INVALID_SELECTION: "Un joueur sélectionné ne figure pas sur la feuille de match.",
  BALLOT_CANCELLED: "Votre bulletin a été annulé par le maître. Contactez-le.",
  BALLOT_NEEDS_THREE: "Un bulletin doit contenir exactement trois joueurs.",
  INVALID_PENALTY: "Le malus doit être compris entre 1 et 50 points.",
  MATCH_FIELDS_REQUIRED: "Adversaire, date du match et heure limite sont obligatoires.",
  CLOSE_BEFORE_OPEN: "La fermeture doit être postérieure à l'ouverture.",
  MATCH_ARCHIVED: "Ce match est archivé.",
  MATCH_HAS_VOTES:
    "Ce match contient des bulletins ou des malus : il ne peut pas être supprimé. Archivez-le ou excluez-le du classement.",
  PLAYER_HAS_VOTES: "Impossible de retirer de la feuille un joueur ayant voté ou ayant reçu des voix.",
  REASON_REQUIRED: "Indiquez le motif de la correction.",
  INVALID_STATUS: "Statut invalide.",
  MAITRE_EXISTS: "Un compte maître existe déjà.",
  CANNOT_DISABLE_SELF: "Vous ne pouvez pas désactiver votre propre compte.",
  AUDIT_IMMUTABLE: "Le journal ne peut pas être modifié.",
};

export function translateError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  if (MESSAGES[raw]) return MESSAGES[raw];
  if (raw.includes("duplicate key") && raw.includes("username")) return "Cet identifiant est déjà utilisé.";
  if (raw.includes("duplicate key") && raw.includes("display_name")) return "Un joueur porte déjà ce nom.";
  if (raw.includes("duplicate key") && raw.includes("seasons_name")) return "Une saison porte déjà ce nom.";
  if (raw.includes("profiles_username_format"))
    return "Identifiant invalide : 3 à 32 caractères parmi a-z, 0-9, point, tiret, tiret bas.";
  return "Une erreur est survenue. Réessayez.";
}
