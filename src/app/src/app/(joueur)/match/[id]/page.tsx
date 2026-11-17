import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, getMyBallots, matchTitle, scoreText, type Availability, type PlayerRole, type StatLine } from "@/lib/data";
import { fmtDateTime } from "@/lib/time";
import { LIVE_LABEL } from "@/lib/live";
import { EmptyState, LinkButton, Panel, SectionTitle, Tag, cx } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";
import { RoleTag, StatPills } from "@/components/stats";
import { Timeline, type MatchEvent } from "@/components/timeline";
import { AvailabilityPicker } from "@/components/availability-picker";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata = { title: "Match" };

type SheetRow = {
  player_id: string;
  role: PlayerRole;
  players: { display_name: string; shirt_number: number | null } | null;
};
type AvailabilityRow = { player_id: string; status: Availability; comment: string | null };

const AVAIL_LABEL: Record<Availability, string> = { present: "Présents", incertain: "Incertains", absent: "Absents" };

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();

  const [{ data: sheetData }, { data: statsData }, { data: eventsData }, { data: availData }, { data: players }, { data: canRecord }, ballots] =
    await Promise.all([
      supabase.from("match_players").select("player_id, role, players(display_name, shirt_number)").eq("match_id", id),
      supabase.from("match_stats").select("player_id, goals, assists, yellow_cards, red_cards").eq("match_id", id),
      supabase.from("match_events").select("id, kind, player_id, assist_player_id, minute, period, created_at").eq("match_id", id),
      supabase.from("match_availability").select("player_id, status, comment").eq("match_id", id),
      supabase.from("players").select("id, display_name"),
      supabase.rpc("can_record_facts", { p_match_id: id }),
      viewer.playerId ? getMyBallots(supabase, viewer.playerId) : Promise.resolve(new Map()),
    ]);
  const sheet = ((sheetData ?? []) as unknown as SheetRow[]).sort(
    (a, b) =>
      ["joueur", "delegue", "supporter"].indexOf(a.role) - ["joueur", "delegue", "supporter"].indexOf(b.role) ||
      (a.players?.shirt_number ?? 99) - (b.players?.shirt_number ?? 99) ||
      (a.players?.display_name ?? "").localeCompare(b.players?.display_name ?? "", "fr"),
  );
  const names = new Map((players ?? []).map((p) => [p.id as string, p.display_name as string]));
  const nameOf = (pid: string | null) => (pid ? names.get(pid) ?? "Joueur" : "Joueur");
  const stats = new Map(((statsData ?? []) as (StatLine & { player_id: string })[]).map((s) => [s.player_id, s]));
  const events = (eventsData ?? []) as MatchEvent[];
  const avail = (availData ?? []) as AvailabilityRow[];
  const mine = avail.find((a) => a.player_id === viewer.playerId) ?? null;
  const inSquad = sheet.some((r) => r.player_id === viewer.playerId);
  const ballot = ballots.get(match.id);
  const isLive = match.live_status === "premiere" || match.live_status === "seconde" || match.live_status === "mi_temps";
  const validated = match.availability_state === "validee";
  const upcoming = new Date(match.kickoff_at) > new Date();
  const score = scoreText(match);

  return (
    <div className="space-y-4">
      {isLive ? <AutoRefresh seconds={20} /> : null}
      <Link href="/calendrier" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>

      <Panel>
        <MatchHeading match={match} />
        {match.effective_state === "ouvert" && inSquad ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              Heure limite du vote : <strong>{fmtDateTime(match.vote_deadline)}</strong>
            </span>
            <LinkButton href={`/vote/${match.id}`} variant={ballot ? "secondary" : "primary"}>
              {ballot ? "Modifier mon vote" : "Voter"}
            </LinkButton>
          </div>
        ) : ballot ? (
          <p className="mt-3">
            <Tag tone="ok">Vous avez voté{ballot.is_late ? " (en retard)" : ""}</Tag>
          </p>
        ) : null}
        {canRecord && !match.archived ? (
          <LinkButton href={`/match/${match.id}/direct`} variant={isLive ? "danger" : "secondary"} className="mt-4 w-full sm:w-auto">
            {isLive ? "Ouvrir la feuille en direct" : match.live_status === "termine" ? "Corriger les faits de match" : "Démarrer / encoder le match"}
          </LinkButton>
        ) : null}
      </Panel>

      {/* Convocation */}
      {viewer.playerId && upcoming && validated ? (
        <Panel className={cx(inSquad ? "ring-2 ring-pitch" : "")}>
          <SectionTitle>Convocation</SectionTitle>
          {inSquad ? (
            <p className="font-semibold text-pitch">Vous êtes convoqué pour ce match.</p>
          ) : (
            <p className="text-muted">Vous n&apos;êtes pas retenu pour ce match.</p>
          )}
        </Panel>
      ) : null}

      {/* Disponibilités */}
      {viewer.playerId && upcoming && match.availability_state !== "validee" ? (
        <Panel>
          <SectionTitle>Ma disponibilité</SectionTitle>
          {match.availability_state === "ouverte" ? (
            <AvailabilityPicker matchId={match.id} initial={mine?.status ?? null} initialComment={mine?.comment ?? null} />
          ) : match.availability_state === "a_venir" ? (
            <p className="text-sm text-muted">Ouverture des inscriptions le {fmtDateTime(match.availability_opens_at)}.</p>
          ) : (
            <p className="text-sm text-muted">Inscriptions fermées.</p>
          )}
        </Panel>
      ) : null}

      {/* Score et déroulé */}
      {match.live_status || events.length > 0 ? (
        <Panel>
          <SectionTitle aside={match.live_status ? <span className="text-sm font-semibold text-muted">{LIVE_LABEL[match.live_status]}</span> : null}>
            Déroulé du match
          </SectionTitle>
          {score ? (
            <p className="num mb-3 text-center font-display text-4xl font-bold">
              <span className="block text-base font-semibold text-muted">{matchTitle(match)}</span>
              {score}
            </p>
          ) : null}
          <Timeline events={events} nameOf={nameOf} isHome={match.is_home} opponent={match.opponent} />
          {isLive ? <p className="mt-3 text-xs text-muted">Mise à jour automatique toutes les 20 secondes.</p> : null}
        </Panel>
      ) : null}

      {/* Feuille de match */}
      <section>
        <SectionTitle aside={<span className="text-sm text-muted">{sheet.length} personnes</span>}>
          {validated ? "Joueurs convoqués" : "Feuille de match"}
        </SectionTitle>
        {sheet.length === 0 ? (
          <EmptyState title="Feuille de match pas encore remplie">L’entraîneur la publiera avant le match.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-chalk">
            {sheet.map((r) => {
              const s = stats.get(r.player_id);
              return (
                <li key={r.player_id} className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2">
                  <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pitch-soft font-display font-bold text-pitch">
                    {r.players?.shirt_number ?? "–"}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">
                    {r.players?.display_name}
                    {r.player_id === viewer.playerId ? <span className="font-normal text-muted"> (vous)</span> : null}
                  </span>
                  <RoleTag role={r.role} />
                  {s ? <StatPills s={s} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Réponses de l'équipe (avant validation) */}
      {upcoming && !validated && avail.length > 0 ? (
        <section>
          <SectionTitle>Réponses de l&apos;équipe</SectionTitle>
          <div className="space-y-2">
            {(["present", "incertain", "absent"] as Availability[]).map((st) => {
              const list = avail.filter((a) => a.status === st);
              if (list.length === 0) return null;
              return (
                <p key={st} className="rounded-xl bg-chalk px-4 py-3 text-sm">
                  <strong>
                    {AVAIL_LABEL[st]} ({list.length}) :
                  </strong>{" "}
                  {list.map((a) => nameOf(a.player_id)).sort((x, y) => x.localeCompare(y, "fr")).join(", ")}
                </p>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
