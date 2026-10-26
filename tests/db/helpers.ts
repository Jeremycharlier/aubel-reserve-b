import { inject, expect } from "vitest";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { changeOwnPassword, createAccount, loginWithUsername } from "../../src/lib/accounts";
import { toBrusselsInput } from "../../src/lib/time";

export const DOMAIN = "joueurs.aubel-reserve-b.invalid";

export function adminClient(): SupabaseClient {
  return createClient(inject("supabaseUrl"), inject("serviceKey"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(inject("supabaseUrl"), inject("anonKey"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const pool = new pg.Pool({ host: "127.0.0.1", port: 54322, user: "postgres", database: "postgres", max: 4 });

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function login(username: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const res = await loginWithUsername(adminClient(), client, DOMAIN, username, password, "10.0.0.1");
  expect(res).toEqual({ ok: true });
  return client;
}

export async function loginMaitre(): Promise<SupabaseClient> {
  const m = inject("maitre");
  return login(m.username, m.password);
}

export type TestPlayer = {
  client: SupabaseClient;
  userId: string;
  playerId: string;
  username: string;
  password: string;
};

let seq = 0;
/** Crée des comptes joueurs via le même code que l'application, puis les connecte. */
export async function createPlayers(n: number, prefix: string): Promise<TestPlayer[]> {
  const admin = adminClient();
  const maitre = inject("maitre");
  const out: TestPlayer[] = [];
  for (let i = 0; i < n; i++) {
    seq += 1;
    const username = `${prefix}.${seq}`;
    const acc = await createAccount(admin, maitre.userId, DOMAIN, {
      username,
      newPlayerName: `${prefix} Joueur ${seq}`,
    });
    const tmpClient = await login(username, acc.tempPassword);
    const password = `Nouveau-${seq}-mdp`;
    await changeOwnPassword(admin, tmpClient, acc.userId, username, password);
    out.push({ client: tmpClient, userId: acc.userId, playerId: acc.playerId, username, password });
  }
  return out;
}

export async function currentSeasonId(maitre: SupabaseClient): Promise<string> {
  const rows = await sql<{ id: string }>("select id from public.seasons where is_current");
  if (rows[0]) return rows[0].id;
  const { data, error } = await maitre.rpc("admin_save_season", {
    p_id: null,
    p_name: "2026-2027",
    p_starts_on: "2026-08-01",
    p_ends_on: "2027-06-30",
    p_make_current: true,
  });
  if (error) throw error;
  return data as string;
}

export const local = (d: Date) => `${toBrusselsInput(d.toISOString())}:00`;
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);

/** Crée un match ouvert manuellement, avec feuille de match. */
export async function createOpenMatch(
  maitre: SupabaseClient,
  players: string[],
  opts: { deadlineMinutes?: number; opponent?: string; open?: boolean } = {},
): Promise<string> {
  const season = await currentSeasonId(maitre);
  const { data: matchId, error } = await maitre.rpc("admin_save_match", {
    p_id: null,
    p_season_id: season,
    p_opponent: opts.opponent ?? `Adversaire ${Math.random().toString(36).slice(2, 7)}`,
    p_kickoff_local: local(minutesFromNow(-120)),
    p_location: "Aubel",
    p_opens_local: null,
    p_closes_local: null,
    p_deadline_local: local(minutesFromNow(opts.deadlineMinutes ?? 60)),
    p_counts_for_ranking: true,
  });
  if (error) throw error;
  const { error: e2 } = await maitre.rpc("admin_set_match_players", { p_match_id: matchId, p_player_ids: players });
  if (e2) throw e2;
  if (opts.open !== false) {
    const { error: e3 } = await maitre.rpc("admin_set_vote_state", { p_match_id: matchId, p_state: "ouvert" });
    if (e3) throw e3;
  }
  return matchId as string;
}

export async function vote(client: SupabaseClient, matchId: string, picks: string[]) {
  return client.rpc("submit_ballot", { p_match_id: matchId, p_selections: picks });
}
