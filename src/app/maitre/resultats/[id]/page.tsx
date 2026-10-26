import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, getPlayersMap } from "@/lib/data";
import { fmtLong, fmtPrecise } from "@/lib/time";
import { EmptyState, PageTitle, Panel, RANK_STYLES, SectionTitle, StateBadge, Tag, cx } from "@/components/ui";
import { BallotStatusForm, CorrectionForm, PenaltyForm } from "./forms";

export const metadata = { title: "Résultats du match" };

type Summary = {
  player_id: string;
  display_name: string;
  voted: boolean;
  ballot_late: boolean;
  points_received: number;
  votes_received: number;
  penalty_points: number;
  penalty_kind: "retard" | "non_vote" | null;
};

type Ballot = {
  id: string;
  voter_player_id: string;
  first_submitted_at: string;
  last_modified_at: string;
  is_late: boolean;
  status: "valide" | "annule";
  version: number;
  ballot_selections: { rank: number; points: number; selected_player_id: string }[];
  ballot_versions: { version: number; source: string; reason: string | null; recorded_at: string }[];
};

export default async function MatchResultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMaitre();
  const { id } = await params;
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();

  const [{ data: summary, error }, { data: ballotsData }, players, { data: pens }, { data: settings }] = await Promise.all([
    supabase.rpc("admin_match_summary", { p_match_id: id }),
    supabase
      .from("ballots")
      .select(
        "id, voter_player_id, first_submitted_at, last_modified_at, is_late, status, version, ballot_selections(rank, points, selected_player_id), ballot_versions(version, source, reason, recorded_at)",
      )
      .eq("match_id", id)
      .order("first_submitted_at"),
    getPlayersMap(supabase),
    supabase.from("penalties").select("player_id, kind, points, status, reason, created_by, created_at").eq("match_id", id),
    supabase.from("app_settings").select("late_penalty_points").eq("id", 1).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const rows = (summary ?? []) as Summary[];
  const ballots = (ballotsData ?? []) as Ballot[];
  const name = (pid: string) => players.get(pid)?.display_name ?? "Joueur inconnu";
  const squad = rows.map((r) => ({ id: r.player_id, name: r.display_name }));

  return (
    <div className="space-y-5">
      <Link href="/maitre/resultats" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Résultats
      </Link>
      <PageTitle
        title={`Aubel B – ${match.opponent}`}
        subtitle={fmtLong(match.kickoff_at)}
        action={<StateBadge state={match.effective_state} />}
      />
      <p className="text-sm text-muted">
        Heure limite : {fmtPrecise(match.vote_deadline)}. Données confidentielles réservées au maître.
      </p>

      <Panel className="overflow-x-auto">
        <SectionTitle>Points du match</SectionTitle>
        {rows.length === 0 ? (
          <EmptyState title="Feuille de match vide" />
        ) : (
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3">Joueur</th>
                <th scope="col" className="py-2 pr-3 text-right">Points reçus</th>
                <th scope="col" className="py-2 pr-3 text-right">Voix</th>
                <th scope="col" className="py-2 pr-3">A voté</th>
                <th scope="col" className="py-2 text-right">Malus</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player_id} className="border-t border-line">
                  <td className="py-2 pr-3 font-semibold">{r.display_name}</td>
                  <td className="num py-2 pr-3 text-right font-display text-xl font-bold text-pitch">{r.points_received}</td>
                  <td className="num py-2 pr-3 text-right">{r.votes_received}</td>
                  <td className="py-2 pr-3">
                    {r.voted ? r.ballot_late ? <Tag tone="late">En retard</Tag> : <Tag tone="ok">À temps</Tag> : <Tag tone="muted">Non</Tag>}
                  </td>
                  <td className="num py-2 text-right">
                    {r.penalty_points ? <span className="text-late">−{r.penalty_points} ({r.penalty_kind === "retard" ? "retard" : "non-vote"})</span> : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <section>
        <SectionTitle>Bulletins ({ballots.length})</SectionTitle>
        {ballots.length === 0 ? (
          <EmptyState title="Aucun bulletin pour ce match" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {ballots.map((b) => (
              <Panel key={b.id} className={cx(b.status === "annule" && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-display text-xl font-semibold">{name(b.voter_player_id)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {b.status === "annule" ? <Tag tone="warn">Annulé</Tag> : null}
                    {b.is_late ? <Tag tone="late">En retard</Tag> : <Tag tone="ok">À temps</Tag>}
                  </div>
                </div>
                <ol className="mt-3 space-y-1.5">
                  {[...b.ballot_selections]
                    .sort((x, y) => x.rank - y.rank)
                    .map((s) => (
                      <li key={s.rank} className="flex items-center gap-2">
                        <span className={cx("num flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold", RANK_STYLES[s.rank - 1].bg, RANK_STYLES[s.rank - 1].text)}>
                          {s.points}
                        </span>
                        <span>
                          Rang {s.rank} : <strong>{name(s.selected_player_id)}</strong>
                        </span>
                      </li>
                    ))}
                </ol>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted">
                  <dt>Soumis le</dt>
                  <dd className="num">{fmtPrecise(b.first_submitted_at)}</dd>
                  <dt>Modifié le</dt>
                  <dd className="num">
                    {b.version > 1 ? fmtPrecise(b.last_modified_at) : "jamais"} (version {b.version})
                  </dd>
                </dl>
                {b.ballot_versions.some((v) => v.source === "correction") ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-warn">
                    {b.ballot_versions
                      .filter((v) => v.source === "correction")
                      .map((v) => (
                        <li key={v.version}>
                          Correction v{v.version} du {fmtPrecise(v.recorded_at)} : {v.reason}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-pitch">Corriger ou annuler</summary>
                  <div className="mt-2 space-y-4">
                    <CorrectionForm
                      matchId={id}
                      squad={squad}
                      defaults={{
                        voter: b.voter_player_id,
                        picks: [...b.ballot_selections].sort((x, y) => x.rank - y.rank).map((s) => s.selected_player_id),
                      }}
                    />
                    <BallotStatusForm ballotId={b.id} matchId={id} status={b.status} />
                  </div>
                </details>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <Panel>
        <SectionTitle>Malus de ce match</SectionTitle>
        {(pens ?? []).length === 0 ? (
          <p className="mb-3 text-sm text-muted">Aucun malus.</p>
        ) : (
          <ul className="mb-4 space-y-1 text-sm">
            {(pens ?? []).map((p) => (
              <li key={p.player_id} className={p.status === "annulee" ? "text-muted line-through" : ""}>
                <strong>{name(p.player_id)}</strong> : −{p.points} ({p.kind === "retard" ? "retard" : "non-vote"},{" "}
                {p.created_by ? "manuel" : "automatique"}){p.reason ? `. ${p.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-pitch">Ajouter ou modifier un malus</summary>
          <div className="mt-2">
            <PenaltyForm matchId={id} squad={squad} defaultPoints={settings?.late_penalty_points ?? 2} />
          </div>
        </details>
      </Panel>

      {squad.length >= 4 ? (
        <Panel>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-display text-lg font-semibold">
              Saisir un bulletin à la place d&apos;un joueur (exceptionnel)
            </summary>
            <p className="mb-3 mt-1 text-sm text-muted">
              Par exemple si un joueur vous a transmis son vote autrement. Toujours journalisé avec votre nom et le motif.
            </p>
            <CorrectionForm matchId={id} squad={squad} />
          </details>
        </Panel>
      ) : null}
    </div>
  );
}
