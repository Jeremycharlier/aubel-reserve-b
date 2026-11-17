import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import {
  ageOn,
  getCurrentSeason,
  getSeasonMatches,
  getStatsTotals,
  PLAYER_COLUMNS,
  type PlayerRow,
} from "@/lib/data";
import { EmptyState, PageTitle, cx } from "@/components/ui";
import { AssistIcon, BallIcon, CardIcon, RoleTag } from "@/components/stats";

export const metadata = { title: "Joueurs" };

const SORTS = {
  buts: { label: "Buts", key: "goals" },
  passes: { label: "Passes", key: "assists" },
  cartons: { label: "Cartons", key: "cards" },
  nom: { label: "Nom", key: "name" },
} as const;
type SortKey = keyof typeof SORTS;

/** Barre proportionnelle au meilleur de l'équipe. */
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-turf" aria-hidden>
      <span className={cx("block h-full rounded-full", color)} style={{ width: `${max ? Math.round((value / max) * 100) : 0}%` }} />
    </span>
  );
}

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ tri?: string }> }) {
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const { tri } = await searchParams;
  const sort: SortKey = tri && tri in SORTS ? (tri as SortKey) : "buts";

  const [season, { data: playersData }] = await Promise.all([
    getCurrentSeason(supabase),
    supabase.from("players").select(PLAYER_COLUMNS).eq("active", true),
  ]);
  const matches = season ? await getSeasonMatches(supabase, season.id) : [];
  const ids = matches.map((m) => m.id);
  const [totals, { data: apps }] = await Promise.all([
    getStatsTotals(supabase, ids),
    ids.length
      ? supabase.from("match_players").select("player_id").in("match_id", ids).neq("role", "supporter")
      : Promise.resolve({ data: [] as { player_id: string }[] }),
  ]);
  const appearances = new Map<string, number>();
  for (const a of apps ?? []) appearances.set(a.player_id, (appearances.get(a.player_id) ?? 0) + 1);

  const zero = { goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, matches: 0 };
  const rows = ((playersData ?? []) as PlayerRow[]).map((p) => ({ p, s: totals.get(p.id) ?? zero, apps: appearances.get(p.id) ?? 0 }));
  rows.sort((a, b) => {
    const byName = a.p.display_name.localeCompare(b.p.display_name, "fr");
    if (sort === "nom") return byName;
    if (sort === "cartons") return b.s.red_cards * 2 + b.s.yellow_cards - (a.s.red_cards * 2 + a.s.yellow_cards) || byName;
    const k = SORTS[sort].key as "goals" | "assists";
    return b.s[k] - a.s[k] || byName;
  });
  const maxGoals = Math.max(0, ...rows.map((r) => r.s.goals));
  const maxAssists = Math.max(0, ...rows.map((r) => r.s.assists));
  const teamGoals = rows.reduce((n, r) => n + r.s.goals, 0);

  return (
    <div>
      <PageTitle title="Joueurs" subtitle={season ? `Statistiques de la saison ${season.name}` : undefined} />

      {season ? (
        <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Joueurs", rows.filter((r) => r.p.default_role !== "supporter").length],
            ["Buts", teamGoals],
            ["Matchs", matches.filter((m) => new Date(m.kickoff_at) < new Date()).length],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-chalk py-3">
              <dd className="num font-display text-3xl font-bold text-pitch">{value}</dd>
              <dt className="text-xs font-semibold text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      <nav aria-label="Trier" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(SORTS) as SortKey[]).map((k) => (
          <Link
            key={k}
            href={`/joueurs?tri=${k}`}
            aria-current={sort === k ? "true" : undefined}
            className={cx(
              "inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold",
              sort === k ? "bg-pitch text-chalk" : "bg-chalk text-ink ring-1 ring-inset ring-line",
            )}
          >
            {SORTS[k].label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title="Aucun joueur" />
      ) : (
        <ul className="space-y-2">
          {rows.map(({ p, s, apps: n }) => {
            const age = ageOn(p.birth_date);
            return (
              <li key={p.id} className={cx("rounded-xl bg-chalk px-4 py-3", p.id === viewer.playerId && "ring-2 ring-pitch")}>
                <div className="flex items-center gap-3">
                  <span className="num flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pitch font-display text-xl font-bold text-chalk">
                    {p.shirt_number ?? "–"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                      {p.display_name}
                      <RoleTag role={p.default_role} />
                    </p>
                    <p className="text-sm text-muted">
                      {[
                        p.use_nickname ? p.full_name : p.nickname ? `« ${p.nickname} »` : null,
                        age !== null ? `${age} ans` : null,
                        n > 0 ? `${n} match${n > 1 ? "s" : ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                </div>
                {p.default_role !== "supporter" || s.goals + s.assists + s.yellow_cards + s.red_cards > 0 ? (
                  <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-x-4 gap-y-1">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm">
                        <BallIcon size={16} className="text-ink" />
                        <span className="num font-display text-xl font-bold">{s.goals}</span>
                        <span className="text-muted">{s.goals > 1 ? "buts" : "but"}</span>
                      </div>
                      <Bar value={s.goals} max={maxGoals} color="bg-pitch" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-sm">
                        <AssistIcon size={16} className="text-pitch" />
                        <span className="num font-display text-xl font-bold">{s.assists}</span>
                        <span className="text-muted">{s.assists > 1 ? "passes" : "passe"}</span>
                      </div>
                      <Bar value={s.assists} max={maxAssists} color="bg-gold" />
                    </div>
                    <div className="flex items-center gap-2 pb-0.5" aria-label={`${s.yellow_cards} jaunes, ${s.red_cards} rouges`}>
                      <span className="num inline-flex items-center gap-1 font-semibold">
                        <CardIcon color="yellow" size={18} />
                        {s.yellow_cards}
                      </span>
                      <span className="num inline-flex items-center gap-1 font-semibold">
                        <CardIcon color="red" size={18} />
                        {s.red_cards}
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
