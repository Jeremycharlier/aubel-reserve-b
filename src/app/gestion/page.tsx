import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { rememberSiteUrl } from "@/lib/origin";
import { getCurrentSeason, getPlayersMap, getSeasonMatches, matchTitle } from "@/lib/data";
import { fmtDateTime, timeUntil } from "@/lib/time";
import { EmptyState, LinkButton, PageTitle, Panel, SectionTitle, StateBadge, Tag } from "@/components/ui";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const viewer = await requireStaff();
  const isAdmin = viewer.role === "maitre";
  const supabase = await createUserClient();
  // Mémorise l'adresse du site pour les rappels automatiques
  await rememberSiteUrl(createServiceClient()).catch(() => null);
  const season = await getCurrentSeason(supabase);
  if (!season) {
    return (
      <div>
        <PageTitle title="Tableau de bord" />
        <EmptyState title="Commencez par créer une saison">
          {isAdmin ? (
            <LinkButton href="/gestion/reglages" className="mt-3">
              Créer la saison
            </LinkButton>
          ) : (
            "L’administrateur doit d’abord créer la saison."
          )}
        </EmptyState>
      </div>
    );
  }

  const [matches, players, { data: sheets }, { data: ballots }, { data: profiles }, { data: avail }] = await Promise.all([
    getSeasonMatches(supabase, season.id),
    getPlayersMap(supabase),
    supabase.from("match_players").select("match_id, player_id"),
    supabase.from("ballots").select("match_id, voter_player_id, is_late, status"),
    supabase.from("profiles").select("must_change_password, active"),
    supabase.from("match_availability").select("match_id, status"),
  ]);
  const activePlayers = [...players.values()].filter((p) => p.active).length;
  const availBy = new Map<string, { present: number; incertain: number; absent: number }>();
  for (const a of avail ?? []) {
    const c = availBy.get(a.match_id) ?? { present: 0, incertain: 0, absent: 0 };
    c[a.status as "present" | "incertain" | "absent"] += 1;
    availBy.set(a.match_id, c);
  }
  const now = new Date();
  const sheetBy = new Map<string, string[]>();
  for (const s of sheets ?? []) sheetBy.set(s.match_id, [...(sheetBy.get(s.match_id) ?? []), s.player_id]);
  const votedBy = new Map<string, Set<string>>();
  for (const b of ballots ?? []) {
    if (b.status !== "valide") continue;
    if (!votedBy.has(b.match_id)) votedBy.set(b.match_id, new Set());
    votedBy.get(b.match_id)!.add(b.voter_player_id);
  }

  const open = matches.filter((m) => m.effective_state === "ouvert" && !m.archived);
  const toOpen = matches.filter(
    (m) => m.effective_state === "a_venir" && !m.vote_opens_at && new Date(m.kickoff_at) < now && !m.archived,
  );
  const noSheet = matches.filter((m) => !m.archived && (sheetBy.get(m.id)?.length ?? 0) === 0 && m.effective_state !== "ferme");
  const next = matches.filter((m) => new Date(m.kickoff_at) > now).slice(0, 3);
  const pendingFirstLogin = isAdmin ? (profiles ?? []).filter((p) => p.active && p.must_change_password).length : 0;

  return (
    <div className="space-y-6">
      <PageTitle title="Tableau de bord" subtitle={`Saison ${season.name}`} />

      {/* Convocations de la semaine */}
      {matches.some((m) => m.availability_state === "ouverte" || (m.availability_state === "validee" && new Date(m.kickoff_at) > now)) ? (
        <section>
          <SectionTitle>Convocations</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {matches
              .filter((m) => m.availability_state === "ouverte" || (m.availability_state === "validee" && new Date(m.kickoff_at) > now))
              .map((m) => {
                const c = availBy.get(m.id) ?? { present: 0, incertain: 0, absent: 0 };
                const none = Math.max(0, activePlayers - c.present - c.incertain - c.absent);
                return (
                  <Link key={m.id} href={`/gestion/matchs/${m.id}`} className="block rounded-xl bg-chalk p-4 hover:ring-2 hover:ring-pitch">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-xl font-semibold">{matchTitle(m)}</p>
                        <p className="text-sm text-muted">{fmtDateTime(m.kickoff_at)}</p>
                      </div>
                      {m.availability_state === "validee" ? <Tag tone="ok">Feuille validée</Tag> : <Tag tone="warn">À valider</Tag>}
                    </div>
                    <p className="num mt-3 text-sm">
                      <strong className="text-pitch">{c.present} présents</strong>, {c.incertain} incertains, {c.absent} absents, {none} sans réponse
                    </p>
                  </Link>
                );
              })}
          </div>
        </section>
      ) : null}

      <section>
        <SectionTitle>Votes en cours</SectionTitle>
        {open.length === 0 ? (
          <EmptyState title="Aucun vote ouvert">Ouvrez un vote depuis la fiche d&apos;un match, ou programmez-le.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((m) => {
              const squad = sheetBy.get(m.id) ?? [];
              const voted = votedBy.get(m.id) ?? new Set();
              const missing = squad.filter((p) => !voted.has(p));
              const pct = squad.length ? Math.round((voted.size / squad.length) * 100) : 0;
              return (
                <Panel key={m.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display text-xl font-semibold">{matchTitle(m)}</p>
                      <p className="text-sm text-muted">Heure limite {fmtDateTime(m.vote_deadline)} ({timeUntil(m.vote_deadline, now)})</p>
                    </div>
                    <StateBadge state="ouvert" />
                  </div>
                  {isAdmin ? (
                  <>
                  <div className="mt-3">
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Bulletins reçus</span>
                      <span className="num">
                        {voted.size} / {squad.length}
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-turf" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-pitch" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {missing.length > 0 ? (
                    <p className="mt-3 text-sm">
                      <span className="text-muted">Pas encore voté : </span>
                      {missing.map((p) => players.get(p)?.display_name ?? "?").join(", ")}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm font-semibold text-pitch">Tout le monde a voté.</p>
                  )}
                  </>
                  ) : null}
                  <div className="mt-3 flex gap-3 text-sm font-semibold">
                    <Link href={`/gestion/matchs/${m.id}`} className="text-pitch">Gérer le match</Link>
                    {isAdmin ? <Link href={`/gestion/resultats/${m.id}`} className="text-pitch">Voir les bulletins</Link> : null}
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      {toOpen.length + noSheet.length + pendingFirstLogin > 0 ? (
        <section>
          <SectionTitle>À faire</SectionTitle>
          <ul className="space-y-2">
            {toOpen.map((m) => (
              <li key={`o-${m.id}`}>
                <Link href={`/gestion/matchs/${m.id}`} className="flex min-h-12 items-center justify-between gap-2 rounded-lg bg-chalk px-4 py-2">
                  <span>Match contre {m.opponent} joué : le vote n&apos;est ni ouvert ni programmé</span>
                  <Tag tone="warn">À ouvrir</Tag>
                </Link>
              </li>
            ))}
            {noSheet.map((m) => (
              <li key={`s-${m.id}`}>
                <Link href={`/gestion/matchs/${m.id}#feuille`} className="flex min-h-12 items-center justify-between gap-2 rounded-lg bg-chalk px-4 py-2">
                  <span>Feuille de match vide contre {m.opponent} ({fmtDateTime(m.kickoff_at)})</span>
                  <Tag tone="warn">Feuille</Tag>
                </Link>
              </li>
            ))}
            {pendingFirstLogin > 0 ? (
              <li>
                <Link href="/gestion/equipe" className="flex min-h-12 items-center justify-between gap-2 rounded-lg bg-chalk px-4 py-2">
                  <span>
                    {pendingFirstLogin} compte{pendingFirstLogin > 1 ? "s" : ""} n&apos;ont pas encore choisi leur mot de passe
                  </span>
                  <Tag tone="muted">Équipe</Tag>
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle aside={<LinkButton href="/gestion/matchs/nouveau" variant="secondary">Ajouter un match</LinkButton>}>
          Prochains matchs
        </SectionTitle>
        {next.length === 0 ? (
          <EmptyState title="Aucun match à venir" />
        ) : (
          <ul className="space-y-2">
            {next.map((m) => (
              <li key={m.id}>
                <Link href={`/gestion/matchs/${m.id}`} className="flex min-h-12 items-center justify-between gap-2 rounded-lg bg-chalk px-4 py-2">
                  <span>
                    <strong>{matchTitle(m)}</strong> <span className="text-muted">{fmtDateTime(m.kickoff_at)}</span>
                  </span>
                  <StateBadge state={m.effective_state} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
