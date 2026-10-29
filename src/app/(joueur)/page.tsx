import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getCurrentSeason, getMyBallots, getMySquadMatchIds, getSeasonMatches } from "@/lib/data";
import { fmtDateTime, timeUntil } from "@/lib/time";
import { EmptyState, LinkButton, Panel, SectionTitle, Tag } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";

export const metadata = { title: "Accueil" };

export default async function HomePage() {
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const season = await getCurrentSeason(supabase);

  if (!season) {
    return (
      <EmptyState title="Aucune saison en cours">
        Le maître n&apos;a pas encore ouvert de saison. Revenez bientôt.
      </EmptyState>
    );
  }

  const [matches, squad, ballots] = await Promise.all([
    getSeasonMatches(supabase, season.id),
    viewer.playerId ? getMySquadMatchIds(supabase, viewer.playerId) : Promise.resolve(new Set<string>()),
    viewer.playerId ? getMyBallots(supabase, viewer.playerId) : Promise.resolve(new Map()),
  ]);
  const now = new Date();
  const open = matches.filter((m) => m.effective_state === "ouvert" && squad.has(m.id));
  const upcoming = matches.filter((m) => new Date(m.kickoff_at) > now).slice(0, 3);
  const todo = open.filter((m) => !ballots.has(m.id)).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted">Bonjour {viewer.displayName}</p>
        <h1 className="font-display text-4xl font-bold leading-tight text-pitch">
          {todo === 0 ? (open.length > 0 ? "Vos votes sont faits" : "Rien à voter pour l'instant") : todo === 1 ? "Un vote vous attend" : `${todo} votes vous attendent`}
        </h1>
      </div>

      {open.length > 0 ? (
        <section className="space-y-3" aria-label="Votes ouverts">
          {open.map((m) => {
            const ballot = ballots.get(m.id);
            const deadlinePassed = new Date(m.vote_deadline) < now;
            return (
              <Panel key={m.id} className={ballot ? "" : "ring-2 ring-pitch"}>
                <MatchHeading match={m} />
                <div className="mt-4 rounded-lg bg-turf px-3 py-2 text-sm">
                  {deadlinePassed ? (
                    <span className="font-semibold text-late">
                      Heure limite dépassée ({fmtDateTime(m.vote_deadline)}) : un nouveau bulletin sera compté en retard.
                    </span>
                  ) : (
                    <>
                      Heure limite : <strong>{fmtDateTime(m.vote_deadline)}</strong>{" "}
                      <span className="text-muted">({timeUntil(m.vote_deadline, now)})</span>
                    </>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {ballot ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Tag tone="ok">Bulletin validé</Tag>
                        {ballot.is_late ? <Tag tone="late">En retard</Tag> : <Tag tone="muted">À temps</Tag>}
                      </div>
                      <LinkButton href={`/vote/${m.id}`} variant="secondary">
                        Modifier mon vote
                      </LinkButton>
                    </>
                  ) : (
                    <LinkButton href={`/vote/${m.id}`} className="w-full">
                      Voter maintenant
                    </LinkButton>
                  )}
                </div>
              </Panel>
            );
          })}
        </section>
      ) : null}

      <section>
        <SectionTitle aside={<Link href="/calendrier" className="text-sm font-semibold text-pitch">Tout le calendrier</Link>}>
          Prochains matchs
        </SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyState title="Aucun match programmé">Le calendrier sera complété par le maître.</EmptyState>
        ) : (
          <div className="space-y-3">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/match/${m.id}`} className="block rounded-xl">
                <Panel>
                  <MatchHeading match={m} />
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
