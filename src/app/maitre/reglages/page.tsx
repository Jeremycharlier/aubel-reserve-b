import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getSeasons } from "@/lib/data";
import { PageTitle, Panel, SectionTitle, Tag } from "@/components/ui";
import { SeasonForm, SettingsForm } from "./forms";

export const metadata = { title: "Règles et saisons" };

export default async function SettingsPage() {
  await requireMaitre();
  const supabase = await createUserClient();
  const [{ data: settings }, seasons] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", 1).single(),
    getSeasons(supabase),
  ]);

  return (
    <div className="space-y-5">
      <PageTitle title="Règles et saisons" />

      <Panel>
        <SectionTitle>Règles de notation</SectionTitle>
        <ul className="space-y-1.5">
          <li>Chaque joueur de la feuille de match désigne trois coéquipiers différents, jamais lui-même.</li>
          <li>
            1<sup>er</sup> choix : <strong>3 points</strong>, 2<sup>e</sup> : <strong>2 points</strong>, 3<sup>e</sup> :{" "}
            <strong>1 point</strong>.
          </li>
          <li>Le bulletin reste modifiable tant que le vote est ouvert ; seule la dernière version compte.</li>
          <li>
            Un bulletin est « en retard » si sa <em>première</em> soumission arrive après l&apos;heure limite (horloge du
            serveur). Le modifier ensuite ne change pas ce statut.
          </li>
          <li>Points nets = points bruts reçus − malus, jamais sous zéro. Départage : nets, puis bruts, puis égalité.</li>
          <li>Fuseau horaire de référence : {settings?.timezone ?? "Europe/Brussels"}.</li>
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>Malus</SectionTitle>
        <SettingsForm
          lateEnabled={settings?.late_penalty_enabled ?? true}
          latePoints={settings?.late_penalty_points ?? 2}
          nonvoteEnabled={settings?.nonvote_penalty_enabled ?? false}
          nonvotePoints={settings?.nonvote_penalty_points ?? 2}
        />
      </Panel>

      <Panel>
        <SectionTitle>Saisons</SectionTitle>
        <ul className="mb-5 space-y-4">
          {seasons.map((s) => (
            <li key={s.id} className="rounded-lg bg-turf p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-semibold">{s.name}</span>
                {s.is_current ? <Tag tone="ok">En cours</Tag> : null}
              </div>
              <SeasonForm season={s} />
            </li>
          ))}
        </ul>
        <p className="mb-2 font-semibold">Nouvelle saison</p>
        <SeasonForm />
      </Panel>

      <Panel>
        <SectionTitle>Mon compte maître</SectionTitle>
        <p className="text-sm text-muted">
          Changez votre mot de passe depuis <Link href="/profil" className="font-semibold text-pitch">votre profil</Link>.
          Les opérations sensibles sont consultables dans le <Link href="/maitre/journal" className="font-semibold text-pitch">journal</Link>.
        </p>
      </Panel>
    </div>
  );
}
