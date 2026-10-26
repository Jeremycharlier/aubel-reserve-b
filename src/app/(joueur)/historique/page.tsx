import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMyBallots, getMySquadMatchIds, getPlayersMap, getSeasons, type MatchRow } from "@/lib/data";
import { fmtPrecise } from "@/lib/time";
import { EmptyState, PageTitle, Panel, RANK_STYLES, Tag, cx } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";

export const metadata = { title: "Historique" };

export default async function HistoryPage() {
  const viewer = await requireViewer();
  if (!viewer.playerId) return <EmptyState title="Aucun joueur associé à ce compte" />;
  const supabase = await createUserClient();

  const [squad, ballots, players, seasons] = await Promise.all([
    getMySquadMatchIds(supabase, viewer.playerId),
    getMyBallots(supabase, viewer.playerId),
    getPlayersMap(supabase),
    getSeasons(supabase),
  ]);
  const ids = [...squad];
  const { data } = ids.length
    ? await supabase.from("v_matches").select("*").in("id", ids).order("kickoff_at", { ascending: false })
    : { data: [] };
  const matches = (data ?? []) as MatchRow[];
  const seasonName = new Map(seasons.map((s) => [s.id, s.name]));
  const voted = matches.filter((m) => ballots.get(m.id)?.status === "valide").length;
  const late = matches.filter((m) => ballots.get(m.id)?.is_late).length;

  return (
    <div>
      <PageTitle title="Mon historique" subtitle="Vos matchs et vos bulletins. Vous seul les voyez." />
      {matches.length > 0 ? (
        <dl className="mb-5 grid grid-cols-3 gap-2 text-center">
          {[
            ["Matchs joués", matches.length],
            ["Bulletins", voted],
            ["Retards", late],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-chalk py-3">
              <dd className="num font-display text-3xl font-bold text-pitch">{value}</dd>
              <dt className="text-xs font-semibold text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState title="Aucun match pour l'instant">Vos matchs apparaîtront ici dès que vous serez sur une feuille de match.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {matches.map((m) => {
            const b = ballots.get(m.id);
            return (
              <li key={m.id}>
                <Panel>
                  <div className="flex items-start justify-between gap-2">
                    <MatchHeading match={m} />
                  </div>
                  <p className="mt-1 text-xs text-muted">Saison {seasonName.get(m.season_id)}</p>
                  {b ? (
                    <div className="mt-3">
                      <div className="mb-2 flex flex-wrap gap-2">
                        {b.status === "annule" ? <Tag tone="warn">Bulletin annulé par le maître</Tag> : null}
                        {b.is_late ? <Tag tone="late">Voté en retard</Tag> : <Tag tone="ok">Voté à temps</Tag>}
                      </div>
                      <ol className="space-y-1.5">
                        {b.ballot_selections.map((s) => (
                          <li key={s.rank} className="flex items-center gap-2">
                            <span
                              className={cx(
                                "num flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold",
                                RANK_STYLES[s.rank - 1].bg,
                                RANK_STYLES[s.rank - 1].text,
                              )}
                            >
                              {s.points}
                            </span>
                            {players.get(s.selected_player_id)?.display_name ?? "Joueur"}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-xs text-muted">
                        Envoyé le {fmtPrecise(b.first_submitted_at)}
                        {b.version > 1 ? `, modifié le ${fmtPrecise(b.last_modified_at)}` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3">
                      <Tag tone={m.effective_state === "ferme" ? "late" : "muted"}>
                        {m.effective_state === "ferme" ? "Pas de bulletin" : "Pas encore voté"}
                      </Tag>
                    </p>
                  )}
                </Panel>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
