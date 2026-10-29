import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getCurrentSeason, getMyBallots, getMySquadMatchIds, getSeasonMatches } from "@/lib/data";
import { EmptyState, LinkButton, PageTitle, Panel, Tag } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Calendrier" };

export default async function CalendarPage() {
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const season = await getCurrentSeason(supabase);
  if (!season) return <EmptyState title="Aucune saison en cours" />;

  const [matches, squad, ballots] = await Promise.all([
    getSeasonMatches(supabase, season.id),
    viewer.playerId ? getMySquadMatchIds(supabase, viewer.playerId) : Promise.resolve(new Set<string>()),
    viewer.playerId ? getMyBallots(supabase, viewer.playerId) : Promise.resolve(new Map()),
  ]);

  return (
    <div>
      <PageTitle title="Calendrier" subtitle={`Saison ${season.name}`} />
      {matches.length === 0 ? (
        <EmptyState title="Aucun match pour le moment" />
      ) : (
        <ol className="space-y-3">
          {matches.map((m) => {
            const inSquad = squad.has(m.id);
            const ballot = ballots.get(m.id);
            return (
              <li key={m.id}>
                <Panel>
                  <Link href={`/match/${m.id}`} className="block rounded-lg" aria-label={`Détails du match contre ${m.opponent}`}>
                    <MatchHeading match={m} />
                  </Link>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {inSquad ? <Tag tone="ok">Sur la feuille de match</Tag> : <Tag tone="muted">Pas sur la feuille</Tag>}
                    {ballot ? (
                      ballot.status === "annule" ? (
                        <Tag tone="warn">Bulletin annulé</Tag>
                      ) : (
                        <>
                          <Tag tone="ok">Voté</Tag>
                          {ballot.is_late ? <Tag tone="late">En retard</Tag> : null}
                        </>
                      )
                    ) : null}
                    <span className="text-muted">Heure limite : {fmtDateTime(m.vote_deadline)}</span>
                    <Link href={`/match/${m.id}`} className="ml-auto inline-flex min-h-10 items-center font-semibold text-pitch">
                      Présents et faits du match
                    </Link>
                  </div>
                  {m.effective_state === "ouvert" && inSquad ? (
                    <LinkButton href={`/vote/${m.id}`} variant={ballot ? "secondary" : "primary"} className="mt-3 w-full sm:w-auto">
                      {ballot ? "Modifier mon vote" : "Voter"}
                    </LinkButton>
                  ) : null}
                </Panel>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
