import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, getSeasons } from "@/lib/data";
import { fmtDateTime, fmtLong, toBrusselsInput } from "@/lib/time";
import { PageTitle, Panel, SectionTitle, StateBadge, Tag } from "@/components/ui";
import { MatchForm } from "../match-form";
import { DangerZone, SheetForm, StatsForm, VoteStateControls } from "./controls";

type Role = "joueur" | "delegue" | "supporter";

export const metadata = { title: "Match" };

const STATE_LABEL = { ouvert: "ouverture", ferme: "fermeture", a_venir: "remise à venir" } as const;

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMaitre();
  const { id } = await params;
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();

  const [seasons, { data: players }, { data: sheet }, { data: ballots }, { data: statsData }, { count: penaltyCount }] =
    await Promise.all([
      getSeasons(supabase),
      supabase.from("players").select("id, display_name, shirt_number, active, default_role").order("display_name"),
      supabase.from("match_players").select("player_id, role").eq("match_id", id),
      supabase.from("ballots").select("voter_player_id, status, ballot_selections(selected_player_id)").eq("match_id", id),
      supabase.from("match_stats").select("player_id, goals, assists, yellow_cards, red_cards").eq("match_id", id),
      supabase.from("penalties").select("player_id", { count: "exact", head: true }).eq("match_id", id),
    ]);
  const sheetRoles = Object.fromEntries((sheet ?? []).map((s) => [s.player_id as string, s.role as Role]));
  const selected = Object.keys(sheetRoles);
  const statsBy = new Map((statsData ?? []).map((s) => [s.player_id as string, s]));
  const locked = new Set<string>();
  for (const b of ballots ?? []) {
    locked.add(b.voter_player_id);
    for (const s of (b.ballot_selections ?? []) as { selected_player_id: string }[]) locked.add(s.selected_player_id);
  }
  const roster = (players ?? [])
    .filter((p) => p.active || selected.includes(p.id))
    .map((p) => ({ id: p.id, name: p.display_name, number: p.shirt_number, active: p.active, defaultRole: p.default_role as Role }));
  const statRows = roster
    .filter((p) => p.id in sheetRoles)
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99) || a.name.localeCompare(b.name, "fr"))
    .map((p) => {
      const st = statsBy.get(p.id);
      return {
        id: p.id, name: p.name, number: p.number,
        goals: st?.goals ?? 0, assists: st?.assists ?? 0, yellow: st?.yellow_cards ?? 0, red: st?.red_cards ?? 0,
      };
    });
  const hasData = (ballots ?? []).length > 0 || (statsData ?? []).length > 0 || (penaltyCount ?? 0) > 0;
  const hasSchedule = !!(match.vote_opens_at || match.vote_closes_at);

  return (
    <div className="space-y-5">
      <Link href="/maitre/matchs" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>
      <PageTitle
        title={`Aubel B – ${match.opponent}`}
        subtitle={`${fmtLong(match.kickoff_at)}${match.location ? `, ${match.location}` : ""}`}
        action={
          <Link href={`/maitre/resultats/${match.id}`} className="font-semibold text-pitch">
            Résultats détaillés
          </Link>
        }
      />

      <Panel>
        <SectionTitle aside={<StateBadge state={match.effective_state} />}>État du vote</SectionTitle>
        <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Heure limite</dt>
          <dd className="font-semibold">{fmtDateTime(match.vote_deadline)}</dd>
          <dt className="text-muted">Ouverture programmée</dt>
          <dd>{match.vote_opens_at ? fmtDateTime(match.vote_opens_at) : "aucune (manuelle)"}</dd>
          <dt className="text-muted">Fermeture programmée</dt>
          <dd>{match.vote_closes_at ? fmtDateTime(match.vote_closes_at) : "aucune (manuelle)"}</dd>
          <dt className="text-muted">Dernière action manuelle</dt>
          <dd>
            {match.manual_state && match.manual_at
              ? `${STATE_LABEL[match.manual_state]} le ${fmtDateTime(match.manual_at)}`
              : "aucune"}
          </dd>
        </dl>
        {match.archived ? (
          <Tag tone="muted">Match archivé : vote fermé</Tag>
        ) : (
          <VoteStateControls
            matchId={match.id}
            effective={match.effective_state}
            hasManual={!!match.manual_state}
            hasSchedule={hasSchedule}
            sheetSize={selected.length}
          />
        )}
      </Panel>

      <Panel>
        <div id="feuille" />
        <SectionTitle>Feuille de match</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Seuls les joueurs cochés peuvent voter et recevoir des voix pour ce match.
        </p>
        {roster.length === 0 ? (
          <p className="text-muted">
            Aucun joueur dans l&apos;effectif. <Link href="/maitre/equipe" className="font-semibold text-pitch">Ajoutez des joueurs</Link>.
          </p>
        ) : (
          <SheetForm matchId={match.id} players={roster} selected={sheetRoles} locked={[...locked]} />
        )}
      </Panel>

      <Panel>
        <div id="statistiques" />
        <SectionTitle>Score, buteurs, passes et cartons</SectionTitle>
        <p className="mb-3 text-sm text-muted">Visible par tous les joueurs sur la page du match et la liste des joueurs.</p>
        <StatsForm matchId={match.id} rows={statRows} scoreFor={match.score_for} scoreAgainst={match.score_against} />
      </Panel>

      <Panel>
        <SectionTitle>Modifier le match</SectionTitle>
        <MatchForm
          seasons={seasons}
          values={{
            id: match.id,
            season_id: match.season_id,
            opponent: match.opponent,
            location: match.location ?? "",
            kickoff: toBrusselsInput(match.kickoff_at),
            opens: toBrusselsInput(match.vote_opens_at),
            closes: toBrusselsInput(match.vote_closes_at),
            deadline: toBrusselsInput(match.vote_deadline),
            counts: match.counts_for_ranking,
          }}
        />
      </Panel>

      <Panel>
        <SectionTitle>Archivage et suppression</SectionTitle>
        <DangerZone matchId={match.id} archived={match.archived} hasVotes={hasData} />
      </Panel>
    </div>
  );
}
