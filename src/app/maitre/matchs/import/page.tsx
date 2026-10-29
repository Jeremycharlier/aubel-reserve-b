import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasons } from "@/lib/data";
import { EmptyState, LinkButton, PageTitle, Panel, SectionTitle } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importer un calendrier" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ saison?: string }> }) {
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
    <div className="space-y-5">
      <Link href="/maitre/matchs" className="inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
        ← Calendrier
      </Link>
      <PageTitle title="Importer un calendrier" />

      <Panel>
        <SectionTitle>1. Préparer le fichier</SectionTitle>
        <p className="text-sm">
          Téléchargez le modèle, remplissez une ligne par match, puis enregistrez. Les heures sont en heure belge.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/modele-calendrier?format=xlsx" download className="inline-flex min-h-11 items-center rounded-lg bg-pitch px-4 font-semibold text-chalk">
            Modèle Excel (.xlsx)
          </a>
          <a href="/api/modele-calendrier?format=csv" download className="inline-flex min-h-11 items-center rounded-lg bg-chalk px-4 font-semibold text-pitch ring-1 ring-inset ring-line">
            Modèle CSV
          </a>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="mb-1 text-left font-semibold">Format attendu (1re ligne = en-têtes)</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3">Colonne</th>
                <th scope="col" className="py-1 pr-3">Obligatoire</th>
                <th scope="col" className="py-1 pr-3">Format</th>
                <th scope="col" className="py-1">Exemple</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["date", "oui", "JJ/MM/AAAA", "08/11/2026"],
                ["heure", "oui", "HH:MM", "15:00"],
                ["adversaire", "oui", "texte", "FC Herve C"],
                ["lieu", "non", "texte", "Aubel"],
                ["classement", "non", "oui / non (oui par défaut)", "non (amical)"],
                ["ouverture_vote", "non", "JJ/MM/AAAA HH:MM", "08/11/2026 17:00"],
                ["heure_limite", "non", "JJ/MM/AAAA HH:MM", "10/11/2026 20:00"],
                ["fermeture_vote", "non", "JJ/MM/AAAA HH:MM", "11/11/2026 20:00"],
              ].map((r) => (
                <tr key={r[0]} className="border-t border-line">
                  <td className="py-1 pr-3 font-mono">{r[0]}</td>
                  <td className="py-1 pr-3">{r[1]}</td>
                  <td className="py-1 pr-3">{r[2]}</td>
                  <td className="py-1">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          Les colonnes de vote vides suivent les règles choisies ci-dessous. Un match déjà présent (même adversaire, même
          date et heure) est ignoré : vous pouvez réimporter un fichier complété sans créer de doublons.
        </p>
      </Panel>

      <Panel>
        <SectionTitle>2. Vérifier puis importer</SectionTitle>
        <ImportForm seasons={seasons.map((s) => ({ id: s.id, name: s.name }))} defaultSeason={season.id} />
      </Panel>
    </div>
  );
}
