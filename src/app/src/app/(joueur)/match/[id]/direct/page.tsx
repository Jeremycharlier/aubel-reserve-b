import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, matchTitle, type PlayerRole } from "@/lib/data";
import type { MatchEvent } from "@/components/timeline";
import { LiveConsole } from "./live-console";

export const metadata = { title: "Match en direct" };

type SheetRow = { player_id: string; role: PlayerRole; players: { display_name: string; shirt_number: number | null } | null };

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireViewer();
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();
  const { data: allowed } = await supabase.rpc("can_record_facts", { p_match_id: id });
  if (!allowed) notFound();

  const [{ data: sheetData }, { data: eventsData }, { data: players }] = await Promise.all([
    supabase.from("match_players").select("player_id, role, players(display_name, shirt_number)").eq("match_id", id),
    supabase.from("match_events").select("id, kind, player_id, assist_player_id, minute, period, created_at").eq("match_id", id),
    supabase.from("players").select("id, display_name"),
  ]);
  const squad = ((sheetData ?? []) as unknown as SheetRow[])
    .map((r) => ({ id: r.player_id, name: r.players?.display_name ?? "?", number: r.players?.shirt_number ?? null, role: r.role }))
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99) || a.name.localeCompare(b.name, "fr"));

  return (
    <div className="space-y-4">
      <Link href={`/match/${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Page du match
      </Link>
      <h1 className="font-display text-3xl font-bold leading-tight text-pitch">{matchTitle(match)}</h1>
      <LiveConsole
        match={{
          id: match.id,
          opponent: match.opponent,
          club: match.club_name,
          isHome: match.is_home,
          live_status: match.live_status,
          live_started_at: match.live_started_at,
          second_half_started_at: match.second_half_started_at,
          scoreFor: match.score_for,
          scoreAgainst: match.score_against,
        }}
        squad={squad}
        events={(eventsData ?? []) as MatchEvent[]}
        names={Object.fromEntries((players ?? []).map((p) => [p.id as string, p.display_name as string]))}
      />
    </div>
  );
}
