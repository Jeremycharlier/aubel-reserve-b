// Données de démonstration pour un environnement LOCAL uniquement.
//   npm run seed:demo
// Crée un maître « coach » et 11 joueurs (mot de passe commun « Demo-2026 »),
// une saison et trois matchs (fermé, ouvert, à venir) avec des votes.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bootstrapMaitre, changeOwnPassword, createAccount, loginWithUsername } from "../src/lib/accounts";
import { toBrusselsInput } from "../src/lib/time";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const secret = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!;
const domain = process.env.LOGIN_EMAIL_DOMAIN || "joueurs.aubel-reserve-b.invalid";
const PASSWORD = "Demo-2026";

if (!/127\.0\.0\.1|localhost/.test(url ?? "")) {
  console.error("Refusé : ce script ne s'exécute que sur une base locale.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const newClient = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const local = (minutes: number) => `${toBrusselsInput(new Date(Date.now() + minutes * 60_000).toISOString())}:00`;

async function signIn(username: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const r = await loginWithUsername(admin, c, domain, username, password, null);
  if (!r.ok) throw new Error(`Connexion impossible pour ${username}`);
  return c;
}

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

async function main() {
  const maitreInfo = await bootstrapMaitre(admin, domain, {
    username: "coach",
    displayName: "Marc Lejeune",
    password: PASSWORD,
    shirtNumber: 6,
  });
  const coach = await signIn("coach", PASSWORD);

  const names = [
    ["Thomas Kessels", 1], ["Julien Franssen", 2], ["Nicolas Hick", 4], ["Maxime Schyns", 5],
    ["Kevin Lambert", 7], ["Arnaud Wintgens", 8], ["Loïc Pirard", 9], ["Sébastien Brouwers", 10],
    ["Damien Lejoly", 11], ["Romain Xhonneux", 14], ["Cédric Meessen", 17],
  ] as const;
  const team: { id: string; client: SupabaseClient }[] = [];
  for (const [name, shirt] of names) {
    const username = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(" ", ".");
    const acc = await createAccount(admin, maitreInfo.userId, domain, { username, newPlayerName: name, shirtNumber: shirt });
    const c = await signIn(username, acc.tempPassword);
    await changeOwnPassword(admin, c, acc.userId, username, PASSWORD);
    team.push({ id: acc.playerId, client: c });
  }
  const all = [maitreInfo.playerId, ...team.map((t) => t.id)];

  const season = await must(coach.rpc("admin_save_season", {
    p_id: null, p_name: "2026-2027", p_starts_on: "2026-08-15", p_ends_on: "2027-05-31", p_make_current: true,
  }));

  // Profils : statuts, surnom, dates de naissance
  const SUPPORTER = all.length - 1; // Cédric Meessen
  const roles: Record<number, "delegue" | "supporter"> = { 1: "delegue", [SUPPORTER]: "supporter" };
  for (const [idx, role] of Object.entries(roles)) {
    const { data: pl } = await admin.from("players").select("*").eq("id", all[Number(idx)]).single();
    await must(coach.rpc("admin_save_player_full", {
      p_id: pl.id, p_full_name: pl.full_name, p_nickname: null, p_use_nickname: false, p_birth_date: null,
      p_shirt_number: pl.shirt_number, p_default_role: role, p_active: true,
    }));
  }
  const births = ["1988-03-14", "1995-07-02", "1999-11-23", "1993-01-30", "2001-05-17", "1997-09-08"];
  for (let i = 1; i <= births.length; i++) {
    await must(team[i - 1].client.rpc("update_my_profile", {
      p_nickname: null, p_use_nickname: false, p_birth_date: births[i - 1],
    }));
  }
  await must(team[9].client.rpc("update_my_profile", { p_nickname: "Xhoxho", p_use_nickname: true, p_birth_date: "1996-12-04" }));

  const mk = async (opponent: string, kickoff: number, deadline: number, location: string) => {
    const id = await must(coach.rpc("admin_save_match", {
      p_id: null, p_season_id: season, p_opponent: opponent, p_kickoff_local: local(kickoff),
      p_location: location, p_opens_local: null, p_closes_local: null, p_deadline_local: local(deadline),
      p_counts_for_ranking: true,
    }));
    await must(coach.rpc("admin_set_match_players", { p_match_id: id, p_player_ids: all }));
    return id as string;
  };
  const pick = (self: number) => {
    const others = all.map((_, i) => i).filter((i) => i !== self && i !== SUPPORTER);
    const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 3);
    return shuffled.map((i) => all[i]);
  };
  const voters = [coach, ...team.map((t) => t.client)];

  // Match 1 : terminé, fermé
  const m1 = await mk("RFC Warsage B", -7 * 1440, -6 * 1440 + 60, "Aubel");
  await must(coach.rpc("admin_set_vote_state", { p_match_id: m1, p_state: "ouvert" }));
  for (let i = 0; i < voters.length - 1; i++) await must(voters[i].rpc("submit_ballot", { p_match_id: m1, p_selections: pick(i) }));
  await must(coach.rpc("admin_set_vote_state", { p_match_id: m1, p_state: "ferme" }));
  await must(coach.rpc("admin_save_match_stats", {
    p_match_id: m1, p_score_for: 3, p_score_against: 1,
    p_rows: [
      { player_id: all[7], goals: 2, assists: 0 }, { player_id: all[9], goals: 1, assists: 1 },
      { player_id: all[5], assists: 2, yellow: 1 }, { player_id: all[3], yellow: 1 },
    ],
  }));

  // Match 2 : joué hier, vote ouvert, fermeture programmée dans 2 jours
  const m2 = await mk("FC Herve C", -1440, 1200, "Herve");
  await must(coach.rpc("admin_save_match", {
    p_id: m2, p_season_id: season, p_opponent: "FC Herve C", p_kickoff_local: local(-1440), p_location: "Herve",
    p_opens_local: null, p_closes_local: local(2 * 1440), p_deadline_local: local(1200), p_counts_for_ranking: true,
  }));
  await must(coach.rpc("admin_set_vote_state", { p_match_id: m2, p_state: "ouvert" }));
  for (let i = 1; i < 7; i++) await must(voters[i].rpc("submit_ballot", { p_match_id: m2, p_selections: pick(i) }));
  await must(coach.rpc("admin_save_match_stats", {
    p_match_id: m2, p_score_for: 2, p_score_against: 2,
    p_rows: [
      { player_id: all[7], goals: 1 }, { player_id: all[2], goals: 1, assists: 1 },
      { player_id: all[9], assists: 1 }, { player_id: all[4], yellow: 2, red: 1 },
    ],
  }));

  // Match 3 : à venir
  await mk("Battice FC B", 5 * 1440, 6 * 1440 + 600, "Battice");

  console.log("Démo prête. Maître : coach / Demo-2026 ; joueurs : thomas.kessels, julien.franssen… / Demo-2026");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
