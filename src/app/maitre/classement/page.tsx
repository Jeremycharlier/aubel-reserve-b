import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasons } from "@/lib/data";
import { EmptyState, PageTitle, buttonClass, cx } from "@/components/ui";
import { SeasonPicker } from "@/components/season-picker";
import type { StandingRow } from "@/lib/pdf";

export const metadata = { title: "Classement" };

type Row = StandingRow & { player_id: string; active: boolean; nonvote_count: number };

const PODIUM = ["bg-gold text-ink", "bg-silver text-ink", "bg-bronze text-chalk"];

export default async function RankingPage({ searchParams }: { searchParams: Promise<{ saison?: string }> }) {
  await requireMaitre();
  const supabase = await createUserClient();
  const seasons = await getSeasons(supabase);
  const { saison } = await searchParams;
  const season = seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  if (!season) return <EmptyState title="Aucune saison" />;

  const { data, error } = await supabase.rpc("admin_season_standings", { p_season_id: season.id });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const leaderNet = rows[0]?.net_points ?? 0;

  return (
    <div>
      <PageTitle
        title="Classement"
        subtitle={<SeasonPicker seasons={seasons} current={season.id} basePath="/maitre/classement" />}
        action={
          <a href={`/api/classement/pdf?saison=${season.id}`} className={buttonClass("primary")} download>
            Exporter en PDF
          </a>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Pas encore de points">Le classement apparaîtra après les premiers votes.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl bg-chalk">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Classement de la saison {season.name}</caption>
            <thead className="bg-pitch text-sm text-chalk">
              <tr>
                <th scope="col" className="w-14 px-3 py-2 text-center">Rang</th>
                <th scope="col" className="px-3 py-2">Joueur</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Matchs</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Retards</th>
                <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">Bruts</th>
                <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">Malus</th>
                <th scope="col" className="px-3 py-2 text-right">Nets</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player_id} className="border-t border-line">
                  <td className="px-3 py-2 text-center">
                    <span
                      className={cx(
                        "num inline-flex h-9 w-9 items-center justify-center rounded-full font-display text-lg font-bold",
                        r.rank <= 3 ? PODIUM[r.rank - 1] : "text-muted",
                      )}
                    >
                      {r.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/maitre/joueurs/${r.player_id}?saison=${season.id}`} className="font-semibold text-ink hover:text-pitch">
                      {r.display_name}
                    </Link>
                    {!r.active ? <span className="ml-1 text-xs text-muted">(inactif)</span> : null}
                    {/* Détail compact sur mobile */}
                    <span className="num block text-xs text-muted md:hidden">
                      {r.gross_points} bruts{r.penalty_points ? `, ${r.penalty_points} de malus` : ""}
                      <span className="sm:hidden">, {r.matches_counted} matchs, {r.late_count} retard{r.late_count > 1 ? "s" : ""}</span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-turf" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-pitch/60"
                        style={{ width: `${leaderNet ? Math.round((r.net_points / leaderNet) * 100) : 0}%` }}
                      />
                    </span>
                  </td>
                  <td className="num hidden px-3 py-2 text-right sm:table-cell">{r.matches_counted}</td>
                  <td className="num hidden px-3 py-2 text-right sm:table-cell">{r.late_count}</td>
                  <td className="num hidden px-3 py-2 text-right md:table-cell">{r.gross_points}</td>
                  <td className={cx("num hidden px-3 py-2 text-right md:table-cell", r.penalty_points > 0 && "text-late")}>
                    {r.penalty_points > 0 ? `−${r.penalty_points}` : 0}
                  </td>
                  <td className="num px-3 py-2 text-right font-display text-2xl font-bold text-pitch">{r.net_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-sm text-muted">
        Points nets = points bruts reçus − malus (jamais sous zéro). Départage : points nets, puis points bruts ; égalité
        conservée ensuite. Les matchs hors classement ne sont pas comptés.
      </p>
    </div>
  );
}
