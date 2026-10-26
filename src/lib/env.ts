// Lecture centralisée des variables d'environnement.
// Les noms "publishable/secret" (nouvelles clés Supabase) et
// "anon/service_role" (anciennes clés) sont tous deux acceptés.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

export function publicEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseKey: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/** Clé secrète : uniquement côté serveur, jamais exposée au navigateur. */
export function serviceKey(): string {
  return required(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Domaine technique des adresses de connexion (les joueurs n'utilisent qu'un identifiant). */
export function loginEmailDomain(): string {
  return process.env.LOGIN_EMAIL_DOMAIN || "joueurs.aubel-reserve-b.invalid";
}
