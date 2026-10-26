import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasons } from "@/lib/data";
import { EmptyState, LinkButton, PageTitle, Panel } from "@/components/ui";
import { MatchForm } from "../match-form";

export const metadata = { title: "Nouveau match" };

export default async function NewMatchPage({ searchParams }: { searchParams: Promise<{ saison?: string }> }) {
  await requireMaitre();
  const supabase = await createUserClient();
  const seasons = await getSeasons(supabase);
  const { saison } = await searchParams;
  const season = seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  if (!season) {
    return (
      <EmptyState title="Créez d'abord une saison">
        <LinkButton href="/maitre/reglages" className="mt-3">Créer une saison</LinkButton>
      </EmptyState>
    );
  }
  return (
    <div>
      <Link href="/maitre/matchs" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>
      <PageTitle title="Nouveau match" />
      <Panel>
        <MatchForm
          seasons={seasons}
          values={{ season_id: season.id, opponent: "", location: "", kickoff: "", opens: "", closes: "", deadline: "", counts: true }}
        />
      </Panel>
    </div>
  );
}
