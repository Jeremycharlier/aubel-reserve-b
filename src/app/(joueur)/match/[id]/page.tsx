import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, getMyBallots, type PlayerRole, type StatLine } from "@/lib/data";
import { fmtDateTime } from "@/lib/time";
import { EmptyState, LinkButton, Panel, SectionTitle, Tag } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";
import { BallIcon, CardIcon, AssistIcon, RoleTag, StatPills } from "@/components/stats";

export const metadata = { title: "Match" };

type SheetRow = {
  player_id: string;
  role: PlayerRole;
  players: { display_name: string; shirt_number: number | null } | null;
};

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const match = await getMatch(supabase, id);
  if (!match) notFound();

  const [{ data: sheetData }, { data: statsData }, ballots] = await Promise.all([
    supabase.from("match_players").select("player_id, role, players(display_name, shirt_number)").eq("match_id", id),
    supabase.from("match_stats").select("player_id, goals, assists, yellow_cards, red_cards").eq("match_id", id),
    viewer.playerId ? getMyBallots(supabase, viewer.playerId) : Promise.resolve(new Map()),
  ]);
  const sheet = ((sheetData ?? []) as unknown as SheetRow[]).sort(
    (a, b) =>
      ["joueur", "delegue", "supporter"].indexOf(a.role) - ["joueur", "delegue", "supporter"].indexOf(b.role) ||
      (a.players?.shirt_number ?? 99) - (b.players?.shirt_number ?? 99) ||
      (a.players?.display_name ?? "").localeCompare(b.players?.display_name ?? "", "fr"),
  );
  const stats = new Map(((statsData ?? []) as (StatLine & { player_id: string })[]).map((s) => [s.player_id, s]));
  const nameOf = (pid: string) => sheet.find((r) => r.player_id === pid)?.players?.display_name ?? "Joueur";
  const inSquad = sheet.some((r) => r.player_id === viewer.playerId);
  const ballot = ballots.get(match.id);

  const list = (key: keyof StatLine) =>
    [...stats.values()]
      .filter((s) => s[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .map((s) => `${nameOf(s.player_id)}${s[key] > 1 ? ` (${s[key]})` : ""}`);
  const scorers = list("goals");
  const assisters = list("assists");
  const yellows = list("yellow_cards");
  const reds = list("red_cards");
  const hasFacts = scorers.length + assisters.length + yellows.length + reds.length > 0;

  return (
    <div className="space-y-4">
      <Link href="/calendrier" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>

      <Panel>
        <MatchHeading match={match} />
        {match.effective_state === "ouvert" && inSquad ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              Heure limite : <strong>{fmtDateTime(match.vote_deadline)}</strong>
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
      </Panel>

      {hasFacts ? (
        <Panel>
          <SectionTitle>Faits du match</SectionTitle>
          <dl className="space-y-2">
            {[
              { label: "Buts", icon: <BallIcon size={18} className="text-ink" />, names: scorers },
              { label: "Passes décisives", icon: <AssistIcon size={18} className="text-pitch" />, names: assisters },
              { label: "Cartons jaunes", icon: <CardIcon color="yellow" size={18} />, names: yellows },
              { label: "Cartons rouges", icon: <CardIcon color="red" size={18} />, names: reds },
            ]
              .filter((r) => r.names.length > 0)
              .map((r) => (
                <div key={r.label} className="flex gap-3">
                  <dt className="flex w-40 shrink-0 items-center gap-2 text-sm font-semibold text-muted">
                    {r.icon}
                    {r.label}
                  </dt>
                  <dd>{r.names.join(", ")}</dd>
                </div>
              ))}
          </dl>
        </Panel>
      ) : null}

      <section>
        <SectionTitle aside={<span className="text-sm text-muted">{sheet.length} personnes</span>}>Présents</SectionTitle>
        {sheet.length === 0 ? (
          <EmptyState title="Feuille de match pas encore remplie">Le maître l&apos;indiquera avant ou après le match.</EmptyState>
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
    </div>
  );
}
