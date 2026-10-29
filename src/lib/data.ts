import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoteState } from "@/components/ui";

export type MatchRow = {
  id: string;
  season_id: string;
  opponent: string;
  kickoff_at: string;
  location: string | null;
  vote_opens_at: string | null;
  vote_closes_at: string | null;
  vote_deadline: string;
  counts_for_ranking: boolean;
  archived: boolean;
  manual_state: VoteState | null;
  manual_at: string | null;
  score_for: number | null;
  score_against: number | null;
  effective_state: VoteState;
};

export type PlayerRole = "joueur" | "delegue" | "supporter";

export type PlayerRow = {
  id: string;
  display_name: string;
  full_name: string;
  nickname: string | null;
  use_nickname: boolean;
  birth_date: string | null;
  shirt_number: number | null;
  default_role: PlayerRole;
  active: boolean;
};

export const PLAYER_COLUMNS =
  "id, display_name, full_name, nickname, use_nickname, birth_date, shirt_number, default_role, active";

export type StatLine = { goals: number; assists: number; yellow_cards: number; red_cards: number };

export type Season = { id: string; name: string; starts_on: string | null; ends_on: string | null; is_current: boolean };

export type MyBallot = {
  id: string;
  match_id: string;
  is_late: boolean;
  status: "valide" | "annule";
  version: number;
  first_submitted_at: string;
  last_modified_at: string;
  ballot_selections: { rank: number; points: number; selected_player_id: string }[];
};

export async function getSeasons(supabase: SupabaseClient): Promise<Season[]> {
  const { data } = await supabase.from("seasons").select("*").order("starts_on", { ascending: false, nullsFirst: false });
  return (data ?? []) as Season[];
}

export async function getCurrentSeason(supabase: SupabaseClient): Promise<Season | null> {
  const { data } = await supabase.from("seasons").select("*").eq("is_current", true).maybeSingle();
  return (data as Season) ?? null;
}

export async function getSeasonMatches(supabase: SupabaseClient, seasonId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("v_matches")
    .select("*")
    .eq("season_id", seasonId)
    .order("kickoff_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchRow[];
}

export async function getMatch(supabase: SupabaseClient, id: string): Promise<MatchRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("v_matches").select("*").eq("id", id).maybeSingle();
  return (data as MatchRow) ?? null;
}

export async function getPlayersMap(supabase: SupabaseClient): Promise<Map<string, PlayerRow>> {
  const { data } = await supabase.from("players").select(PLAYER_COLUMNS);
  return new Map(((data ?? []) as PlayerRow[]).map((p) => [p.id, p]));
}

/** Totaux de statistiques par joueur pour une liste de matchs. */
export async function getStatsTotals(supabase: SupabaseClient, matchIds: string[]): Promise<Map<string, StatLine & { matches: number }>> {
  const totals = new Map<string, StatLine & { matches: number }>();
  if (matchIds.length === 0) return totals;
  const { data } = await supabase
    .from("match_stats")
    .select("player_id, goals, assists, yellow_cards, red_cards")
    .in("match_id", matchIds);
  for (const r of (data ?? []) as (StatLine & { player_id: string })[]) {
    const t = totals.get(r.player_id) ?? { goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, matches: 0 };
    t.goals += r.goals;
    t.assists += r.assists;
    t.yellow_cards += r.yellow_cards;
    t.red_cards += r.red_cards;
    totals.set(r.player_id, t);
  }
  return totals;
}

/** Âge en années révolues à une date donnée. */
export function ageOn(birthDate: string | null, now = new Date()): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}

export const ROLE_LABEL: Record<PlayerRole, string> = { joueur: "Joueur", delegue: "Délégué", supporter: "Supporter" };

/** Matchs où le joueur figure sur la feuille. */
export async function getMySquadMatchIds(supabase: SupabaseClient, playerId: string): Promise<Set<string>> {
  const { data } = await supabase.from("match_players").select("match_id").eq("player_id", playerId);
  return new Set((data ?? []).map((r) => r.match_id as string));
}

/** Bulletins de l'utilisateur (la RLS ne renvoie de toute façon que les siens). */
export async function getMyBallots(supabase: SupabaseClient, playerId: string): Promise<Map<string, MyBallot>> {
  const { data } = await supabase
    .from("ballots")
    .select("id, match_id, is_late, status, version, first_submitted_at, last_modified_at, ballot_selections(rank, points, selected_player_id)")
    .eq("voter_player_id", playerId);
  const map = new Map<string, MyBallot>();
  for (const b of (data ?? []) as MyBallot[]) {
    b.ballot_selections.sort((x, y) => x.rank - y.rank);
    map.set(b.match_id, b);
  }
  return map;
}
