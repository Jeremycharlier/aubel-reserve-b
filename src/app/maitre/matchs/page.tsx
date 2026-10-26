import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasonMatches, getSeasons } from "@/lib/data";
import { fmtDateTime } from "@/lib/time";
import { EmptyState, LinkButton, PageTitle, StateBadge, Tag } from "@/components/ui";
import { SeasonPicker } from "@/components/season-picker";

export const metadata = { title: "Calendrier" };

function modeLabel(m: { vote_opens_at: string | null; vote_closes_at: string | null; manual_state: string | null }) {
  const auto = m.vote_opens_at || m.vote_closes_at;
  if (auto && m.manual_state) return "Mixte";
  if (auto) return "Automatique";
  return "Manuel";
}

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ saison?: string }> }) {
  await requireMaitre();
  const supabase = await createUserClient();
  const seasons = await getSeasons(supabase);
  const { saison } = await searchParams;
  const season = seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.is_current) ?? seasons[0];

  if (!season) {
    return (
      <div>
        <PageTitle title="Calendrier" />
        <EmptyState title="Aucune saison">
          <LinkButton href="/maitre/reglages" className="mt-3">Créer une saison</LinkButton>
        </EmptyState>
      </div>
    );
  }
  const matches = await getSeasonMatches(supabase, season.id);

  return (
    <div>
      <PageTitle
        title="Calendrier"
        subtitle={<SeasonPicker seasons={seasons} current={season.id} basePath="/maitre/matchs" />}
        action={<LinkButton href={`/maitre/matchs/nouveau?saison=${season.id}`}>Ajouter un match</LinkButton>}
      />
      {matches.length === 0 ? (
        <EmptyState title="Aucun match dans cette saison">Ajoutez le premier match pour commencer.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.id}>
              <Link
                href={`/maitre/matchs/${m.id}`}
                className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-chalk px-4 py-3 hover:ring-2 hover:ring-pitch sm:grid-cols-[10rem_1fr_auto_auto]"
              >
                <span className="num text-sm text-muted sm:order-none">{fmtDateTime(m.kickoff_at)}</span>
                <span className="col-span-2 font-semibold sm:col-span-1">
                  {m.opponent}
                  {m.location ? <span className="font-normal text-muted">, {m.location}</span> : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <StateBadge state={m.effective_state} />
                  <Tag tone="muted">{modeLabel(m)}</Tag>
                  {m.archived ? <Tag tone="muted">Archivé</Tag> : null}
                  {!m.counts_for_ranking ? <Tag tone="warn">Hors classement</Tag> : null}
                </span>
                <span className="hidden text-sm text-muted sm:inline">Limite {fmtDateTime(m.vote_deadline)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
