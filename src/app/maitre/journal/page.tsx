import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getPlayersMap } from "@/lib/data";
import { fmtPrecise } from "@/lib/time";
import { EmptyState, PageTitle, Panel, SectionTitle } from "@/components/ui";

export const metadata = { title: "Journal et malus" };

const ACTIONS: Record<string, string> = {
  "compte.creation": "Création de compte",
  "compte.creation_maitre": "Création du compte maître",
  "compte.desactivation": "Désactivation de compte",
  "compte.reactivation": "Réactivation de compte",
  "compte.reinitialisation_mdp": "Réinitialisation de mot de passe",
  "compte.changement_mdp": "Changement de mot de passe",
  "joueur.creation": "Ajout d'un joueur",
  "joueur.modification": "Modification d'un joueur",
  "saison.creation": "Création de saison",
  "saison.modification": "Modification de saison",
  "match.creation": "Création de match",
  "match.modification": "Modification de match",
  "match.suppression": "Suppression de match",
  "match.archivage": "Archivage de match",
  "match.desarchivage": "Désarchivage de match",
  "match.feuille": "Feuille de match",
  "vote.etat_manuel": "Ouverture/fermeture manuelle",
  "config.malus": "Règles de malus",
  "bulletin.correction": "Correction de bulletin",
  "bulletin.statut": "Annulation/rétablissement de bulletin",
  "penalite.correction": "Correction de malus",
  "penalite.non_vote.auto": "Malus de non-vote automatiques",
};

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-turf p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function JournalPage() {
  await requireMaitre();
  const supabase = await createUserClient();
  const [{ data: logs }, { data: pens }, players, { data: matches }] = await Promise.all([
    supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(200),
    supabase.from("penalties").select("id, match_id, player_id, kind, points, status, reason, created_by, created_at").order("created_at", { ascending: false }).limit(200),
    getPlayersMap(supabase),
    supabase.from("matches").select("id, opponent"),
  ]);
  const opponent = new Map((matches ?? []).map((m) => [m.id, m.opponent]));

  return (
    <div className="space-y-6">
      <PageTitle title="Journal et malus" />

      <Panel className="overflow-x-auto">
        <SectionTitle>Détail des malus</SectionTitle>
        {(pens ?? []).length === 0 ? (
          <EmptyState title="Aucun malus" />
        ) : (
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3">Joueur</th>
                <th scope="col" className="py-2 pr-3">Match</th>
                <th scope="col" className="py-2 pr-3">Type</th>
                <th scope="col" className="py-2 pr-3 text-right">Points</th>
                <th scope="col" className="py-2 pr-3">Origine</th>
                <th scope="col" className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {(pens ?? []).map((p) => (
                <tr key={p.id} className={`border-t border-line ${p.status === "annulee" ? "text-muted line-through" : ""}`}>
                  <td className="py-2 pr-3 font-semibold">{players.get(p.player_id)?.display_name}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/maitre/resultats/${p.match_id}`} className="text-pitch">{opponent.get(p.match_id)}</Link>
                  </td>
                  <td className="py-2 pr-3">{p.kind === "retard" ? "Retard" : "Non-vote"}</td>
                  <td className="num py-2 pr-3 text-right">−{p.points}</td>
                  <td className="py-2 pr-3">{p.created_by ? "Manuel" : "Automatique"}</td>
                  <td className="num py-2">{fmtPrecise(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <section>
        <SectionTitle>Journal des opérations (200 dernières)</SectionTitle>
        {(logs ?? []).length === 0 ? (
          <EmptyState title="Journal vide" />
        ) : (
          <ul className="space-y-2">
            {(logs ?? []).map((l) => (
              <li key={l.id} className="rounded-xl bg-chalk">
                <details>
                  <summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <span>
                      <span className="font-semibold">{ACTIONS[l.action] ?? l.action}</span>
                      <span className="text-muted"> par {l.actor_label}</span>
                    </span>
                    <span className="num text-sm text-muted">{fmtPrecise(l.created_at)}</span>
                  </summary>
                  <div className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Avant</p>
                      <Json value={l.before_data} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Après</p>
                      <Json value={l.after_data} />
                    </div>
                    <p className="text-xs text-muted sm:col-span-2">
                      Objet : {l.entity} {l.entity_id}
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
