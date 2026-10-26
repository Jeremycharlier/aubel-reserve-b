import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasonMatches, getSeasons } from "@/lib/data";
import { fmtDateTime } from "@/lib/time";
import { EmptyState, PageTitle, StateBadge } from "@/components/ui";
import { SeasonPicker } from "@/components/season-picker";

export const metadata = { title: "Résultats détaillés" };

export default async function ResultsIndexPage({ searchParams }: { searchParams: Promise<{ saison?: string }> }) {
  await requireMaitre();
  const supabase = await createUserClient();
  const seasons = await getSeasons(supabase);
  const { saison } = await searchParams;
  const season = seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  if (!season) return <EmptyState title="Aucune saison" />;
  const matches = (await getSeasonMatches(supabase, season.id)).reverse();
  const [{ data: ballots }, { data: sheets }] = await Promise.all([
    supabase.from("ballots").select("match_id, status, is_late"),
    supabase.from("match_players").select("match_id"),
  ]);
  const count = (rows: { match_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.match_id === id).length;

  return (
    <div>
      <PageTitle
        title="Résultats détaillés"
        subtitle={<SeasonPicker seasons={seasons} current={season.id} basePath="/maitre/resultats" />}
      />
      <p className="mb-4 text-sm text-muted">
        Données confidentielles : l&apos;identité des votants n&apos;est visible que par vous.
      </p>
      {matches.length === 0 ? (
        <EmptyState title="Aucun match" />
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => {
            const valid = (ballots ?? []).filter((b) => b.match_id === m.id && b.status === "valide");
            return (
              <li key={m.id}>
                <Link
                  href={`/maitre/resultats/${m.id}`}
                  className="flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-xl bg-chalk px-4 py-3 hover:ring-2 hover:ring-pitch"
                >
                  <span>
                    <span className="block font-semibold">{m.opponent}</span>
                    <span className="text-sm text-muted">{fmtDateTime(m.kickoff_at)}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="num">
                      <strong>{valid.length}</strong> / {count(sheets, m.id)} bulletins
                      {valid.some((b) => b.is_late) ? `, ${valid.filter((b) => b.is_late).length} en retard` : ""}
                    </span>
                    <StateBadge state={m.effective_state} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
