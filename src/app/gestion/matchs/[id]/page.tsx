import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { matchTitle, getMatch, getSeasons, type Availability } from "@/lib/data";
import { fmtDateTime, fmtLong, toBrusselsInput } from "@/lib/time";
import { LIVE_LABEL } from "@/lib/live";
import { LinkButton, PageTitle, Panel, SectionTitle, StateBadge, Tag } from "@/components/ui";
import { Timeline, type MatchEvent } from "@/components/timeline";
import { MatchForm } from "../match-form";
import { AvailabilityBoard, DangerZone, SheetForm, ValidateSheetControl, VoteStateControls } from "./controls";

type Role = "joueur" | "delegue" | "supporter";

export const metadata = { title: "Match" };

const STATE_LABEL = { ouvert: "ouverture", ferme: "fermeture", a_venir: "remise à venir" } as const;
const AVAIL_STATE = {
  a_venir: "Ouverture prévue le",
  ouverte: "Ouvertes depuis le",
  validee: "Feuille validée : joueurs convoqués",
  fermee: "Fermées",
} as const;

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaff();
  const isAdmin = viewer.role === "maitre";
  const { id } = await params;
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();

  const [seasons, { data: players }, { data: sheet }, { data: ballots }, { data: hasVotes }, { data: avail }, { data: eventsData }] =
    await Promise.all([
      getSeasons(supabase),
      supabase.from("players").select("id, display_name, shirt_number, active, default_role").order("display_name"),
      supabase.from("match_players").select("player_id, role").eq("match_id", id),
      // Bulletins : visibles par l'administrateur uniquement (RLS) ; l'entraîneur ne reçoit rien.
      isAdmin
        ? supabase.from("ballots").select("voter_player_id, ballot_selections(selected_player_id)").eq("match_id", id)
        : Promise.resolve({ data: [] as { voter_player_id: string; ballot_selections: { selected_player_id: string }[] }[] }),
      supabase.rpc("match_has_votes", { p_match_id: id }),
      supabase.from("match_availability").select("player_id, status, comment").eq("match_id", id),
      supabase.from("match_events").select("id, kind, player_id, assist_player_id, minute, period, created_at").eq("match_id", id),
    ]);
  const sheetRoles = Object.fromEntries((sheet ?? []).map((s) => [s.player_id as string, s.role as Role]));
  const selected = Object.keys(sheetRoles);
  const locked = new Set<string>();
  for (const b of ballots ?? []) {
    locked.add(b.voter_player_id);
    for (const s of (b.ballot_selections ?? []) as { selected_player_id: string }[]) locked.add(s.selected_player_id);
  }
  const roster = (players ?? [])
    .filter((p) => p.active || selected.includes(p.id))
    .map((p) => ({ id: p.id, name: p.display_name, number: p.shirt_number, active: p.active, defaultRole: p.default_role as Role }));
  const names = new Map((players ?? []).map((p) => [p.id as string, p.display_name as string]));
  const answers = Object.fromEntries(
    ((avail ?? []) as { player_id: string; status: Availability; comment: string | null }[]).map((a) => [
      a.player_id,
      { status: a.status, comment: a.comment },
    ]),
  );
  const events = (eventsData ?? []) as MatchEvent[];
  const hasData = Boolean(hasVotes) || events.length > 0;
  const hasSchedule = !!(match.vote_opens_at || match.vote_closes_at);
  const validated = match.availability_state === "validee";
  const upcoming = new Date(match.kickoff_at) > new Date();

  return (
    <div className="space-y-5">
      <Link href="/gestion/matchs" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>
      <PageTitle
        title={matchTitle(match)}
        subtitle={`${fmtLong(match.kickoff_at)}${match.location ? `, ${match.location}` : ""}${match.is_home ? "" : " (extérieur)"}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/match/${match.id}`} className="font-semibold text-pitch">
              Page joueurs
            </Link>
            {isAdmin ? (
              <Link href={`/gestion/resultats/${match.id}`} className="font-semibold text-pitch">
                Résultats détaillés
              </Link>
            ) : null}
          </div>
        }
      />

      {/* 1. Disponibilités et convocation */}
      <Panel>
        <SectionTitle aside={validated ? <Tag tone="ok">Convocation envoyée</Tag> : null}>Disponibilités</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          {AVAIL_STATE[match.availability_state]}
          {match.availability_state === "a_venir" || match.availability_state === "ouverte"
            ? ` ${fmtDateTime(match.availability_opens_at)}.`
            : "."}{" "}
          Les joueurs répondent depuis l&apos;application ; vous pouvez noter une réponse reçue autrement.
        </p>
        <AvailabilityBoard
          matchId={match.id}
          players={roster.filter((p) => p.active)}
          answers={answers}
          editable={upcoming && !validated && !match.archived}
        />
      </Panel>

      {/* 2. Feuille de match */}
      <Panel>
        <div id="feuille" />
        <SectionTitle>Feuille de match</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Cochez les joueurs retenus, puis validez : ils reçoivent leur convocation. Seuls les joueurs de la feuille votent
          et peuvent recevoir des voix.
        </p>
        {roster.length === 0 ? (
          <p className="text-muted">Aucun joueur dans l&apos;effectif.</p>
        ) : (
          <SheetForm
            matchId={match.id}
            players={roster}
            selected={sheetRoles}
            locked={[...locked]}
            availability={Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.status]))}
          />
        )}
        {upcoming && !match.archived ? (
          <div className="mt-4 border-t border-line pt-4">
            <ValidateSheetControl matchId={match.id} validated={validated} count={selected.length} />
            {validated && match.sheet_validated_at ? (
              <p className="mt-2 text-xs text-muted">Validée le {fmtDateTime(match.sheet_validated_at)}.</p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* 3. Faits de match */}
      <Panel>
        <SectionTitle aside={match.live_status ? <Tag tone={match.live_status === "termine" ? "muted" : "late"}>{LIVE_LABEL[match.live_status]}</Tag> : null}>
          Faits de match
        </SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Buts, passes décisives et cartons avec la minute, en direct ou après le match. Accessible aussi aux délégués.
        </p>
        <Timeline events={events} nameOf={(pid) => (pid ? names.get(pid) ?? "Joueur" : "Joueur")} isHome={match.is_home} opponent={match.opponent} />
        <LinkButton href={`/match/${match.id}/direct`} className="mt-4">
          {match.live_status === null ? "Démarrer le match / encoder" : match.live_status === "termine" ? "Corriger les faits" : "Ouvrir la feuille en direct"}
        </LinkButton>
      </Panel>

      {/* 4. Vote */}
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
          <dd>{match.manual_state && match.manual_at ? `${STATE_LABEL[match.manual_state]} le ${fmtDateTime(match.manual_at)}` : "aucune"}</dd>
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
            isHome: match.is_home,
          }}
        />
      </Panel>

      <Panel>
        <SectionTitle>Archivage et suppression</SectionTitle>
        {hasVotes && !isAdmin ? (
          <p className="mb-3 text-sm text-muted">Ce match contient des votes : seul l&apos;administrateur peut le supprimer.</p>
        ) : null}
        <DangerZone matchId={match.id} archived={match.archived} hasVotes={hasData} canDelete={isAdmin || !hasVotes} />
      </Panel>
    </div>
  );
}
