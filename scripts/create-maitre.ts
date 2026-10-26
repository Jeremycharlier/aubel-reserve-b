// Création sécurisée du premier compte maître, à lancer UNE fois après le
// déploiement, depuis votre ordinateur :
//
//   npm run create-maitre
//
// Le script lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY (ou
// SUPABASE_SERVICE_ROLE_KEY) depuis .env.local, puis demande l'identifiant,
// le nom et le mot de passe au clavier (le mot de passe n'est pas affiché
// et n'est écrit nulle part). Refuse de s'exécuter si un maître existe déjà.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { bootstrapMaitre } from "../src/lib/accounts";

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const domain = process.env.LOGIN_EMAIL_DOMAIN || "joueurs.aubel-reserve-b.invalid";
  if (!url || !key) {
    console.error("Renseignez NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local.");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const username = process.env.MAITRE_USERNAME || (await ask("Identifiant du maître (ex. coach) : "));
  const displayName = process.env.MAITRE_NAME || (await ask("Nom affiché (ex. Marc Lejeune) : "));
  const shirt = process.env.MAITRE_SHIRT ?? (await ask("Numéro de maillot (vide si aucun) : "));
  let password = process.env.MAITRE_PASSWORD ?? "";
  if (!password) {
    password = await ask("Mot de passe (8 caractères min., lettre + chiffre) : ", true);
    const confirm = await ask("Confirmez le mot de passe : ", true);
    if (password !== confirm) {
      console.error("Les mots de passe ne correspondent pas.");
      process.exit(1);
    }
  }

  const res = await bootstrapMaitre(admin, domain, {
    username,
    displayName,
    password,
    shirtNumber: shirt ? Number(shirt) : null,
  });
  console.log(`\nCompte maître créé (identifiant : ${username.toLowerCase()}, joueur ${res.playerId}).`);
  console.log("Connectez-vous sur l'application puis créez la saison et les comptes des joueurs.");
}

main().catch((e) => {
  console.error(`Échec : ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
