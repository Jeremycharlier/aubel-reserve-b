import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasonMatches, getSeasons } from "@/lib/data";
import { fmtDateTime } from "@/lib/time";
import { EmptyState, PageTitle, Panel, Tag } from "@/components/ui";
import { SeasonPicker } from "@/components/season-picker";

export const metadata = { title: "Récapitulatif joueur" };

export default async function PlayerRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saison?: string }>;
}) {
  await requireMaitre();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createUserClient();
  const { data: player } = await supabase.from("players").select("id, display_name, shirt_number, active").eq("id", id).maybeSingle();
  if (!player) notFound();
  const seasons = await getSeasons(supabase);
  const { saison } = await searchParams;
  const season = seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  if (!season) return <EmptyState title="Aucune saison" />;

  const matches = await getSeasonMatches(supabase, season.id);
  const ids = matches.map((m) => m.id);
  const [{ data: sheet }, { data: received }, { data: own }, { data: pens }] = await Promise.all([
    supabase.from("match_players").select("match_id").eq("player_id", id).in("match_id", ids),
    supabase
      .from("ballot_selections")
      .select("points, rank, ballots!inner(match_id, status)")
      .eq("selected_player_id", id)
      .in("ballots.match_id", ids),
    supabase.from("ballots").select("match_id, is_late, status").eq("voter_player_id", id).in("match_id", ids),
    supabase.from("penalties").select("match_id, kind, points, status").eq("player_id", id).in("match_id", ids),
  ]);
  const onSheet = new Set((sheet ?? []).map((s) => s.match_id));
  const recv = new Map<string, { pts: number; votes: number }>();
  for (const r of (received ?? []) as unknown as { points: number; ballots: { match_id: string; status: string } }[]) {
    if (r.ballots.status !== "valide") continue;
    const cur = recv.get(r.ballots.match_id) ?? { pts: 0, votes: 0 };
    recv.set(r.ballots.match_id, { pts: cur.pts + r.points, votes: cur.votes + 1 });
  }
  const ownBy = new Map((own ?? []).map((b) => [b.match_id, b]));
  const penBy = new Map((pens ?? []).map((p) => [p.match_id, p]));
  const rows = matches.filter((m) => onSheet.has(m.id) || recv.has(m.id) || penBy.has(m.id));

  const counted = rows.filter((m) => m.counts_for_ranking);
  const gross = counted.reduce((s, m) => s + (recv.get(m.id)?.pts ?? 0), 0);
  const malus = counted.reduce((s, m) => s + (penBy.get(m.id)?.status === "active" ? penBy.get(m.id)!.points : 0), 0);

  return (
    <div className="space-y-5">
      <Link href={`/maitre/classement?saison=${season.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Classement
      </Link>
      <PageTitle
        title={player.display_name}
        subtitle={<SeasonPicker seasons={seasons} current={season.id} basePath={`/maitre/joueurs/${id}`} />}
      />
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Points bruts", gross],
          ["Malus", malus],
          ["Points nets", Math.max(0, gross - malus)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-chalk py-3">
            <dd className="num font-display text-3xl font-bold text-pitch">{value}</dd>
            <dt className="text-xs font-semibold text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      {rows.length === 0 ? (
        <EmptyState title="Aucun match pour ce joueur dans cette saison" />
      ) : (
        <Panel className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-turf text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Match</th>
                <th scope="col" className="px-3 py-2 text-right">Points reçus</th>
                <th scope="col" className="px-3 py-2 text-right">Voix</th>
                <th scope="col" className="px-3 py-2">Son bulletin</th>
                <th scope="col" className="px-3 py-2 text-right">Malus</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const b = ownBy.get(m.id);
                const p = penBy.get(m.id);
                return (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/maitre/resultats/${m.id}`} className="font-semibold text-pitch">{m.opponent}</Link>
                      <span className="block text-xs text-muted">
                        {fmtDateTime(m.kickoff_at)}
                        {!m.counts_for_ranking ? ", hors classement" : ""}
                      </span>
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold">{recv.get(m.id)?.pts ?? 0}</td>
                    <td className="num px-3 py-2 text-right">{recv.get(m.id)?.votes ?? 0}</td>
                    <td className="px-3 py-2">
                      {b ? (
                        b.status === "annule" ? <Tag tone="warn">Annulé</Tag> : b.is_late ? <Tag tone="late">En retard</Tag> : <Tag tone="ok">À temps</Tag>
                      ) : (
                        <Tag tone="muted">Aucun</Tag>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {p ? (
                        <span className={p.status === "active" ? "text-late" : "text-muted line-through"}>
                          −{p.points} ({p.kind === "retard" ? "retard" : "non-vote"})
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
