"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { saveNotificationSettingsAction, saveSeasonAction, saveSettingsAction } from "../actions";

export function SettingsForm({
  lateEnabled,
  latePoints,
  nonvoteEnabled,
  nonvotePoints,
}: {
  lateEnabled: boolean;
  latePoints: number;
  nonvoteEnabled: boolean;
  nonvotePoints: number;
}) {
  return (
    <ActionForm action={saveSettingsAction} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="font-semibold">Malus de retard</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name="late_enabled" defaultChecked={lateEnabled} className="h-5 w-5 accent-pitch" />
          Activer : retirer des points au joueur dont le premier bulletin arrive après l&apos;heure limite
        </label>
        <Field label="Points retirés">
          <input type="number" name="late_points" min={1} max={50} defaultValue={latePoints} className={`${inputClass} max-w-32`} required />
        </Field>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-semibold">Malus de non-vote</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name="nonvote_enabled" defaultChecked={nonvoteEnabled} className="h-5 w-5 accent-pitch" />
          Activer : retirer des points aux joueurs de la feuille de match sans bulletin à la fermeture du vote
        </label>
        <Field label="Points retirés">
          <input type="number" name="nonvote_points" min={1} max={50} defaultValue={nonvotePoints} className={`${inputClass} max-w-32`} required />
        </Field>
      </fieldset>
      <p className="text-sm text-muted">
        Un changement s&apos;applique aux bulletins reçus et aux votes fermés après son enregistrement. Les malus déjà
        appliqués ne sont pas recalculés ; vous pouvez les ajuster match par match dans les résultats détaillés.
      </p>
      <SubmitButton>Enregistrer les règles</SubmitButton>
    </ActionForm>
  );
}

export function SeasonForm({
  season,
}: {
  season?: { id: string; name: string; starts_on: string | null; ends_on: string | null; is_current: boolean };
}) {
  return (
    <ActionForm action={saveSeasonAction} resetOnSuccess={!season} className="grid items-end gap-3 sm:grid-cols-[1fr_10rem_10rem]">
      {season ? <input type="hidden" name="id" value={season.id} /> : null}
      <Field label="Nom">
        <input name="name" className={inputClass} defaultValue={season?.name ?? ""} placeholder="2026-2027" required maxLength={40} />
      </Field>
      <Field label="Début">
        <input type="date" name="starts_on" className={inputClass} defaultValue={season?.starts_on ?? ""} />
      </Field>
      <Field label="Fin">
        <input type="date" name="ends_on" className={inputClass} defaultValue={season?.ends_on ?? ""} />
      </Field>
      <label className="flex min-h-12 items-center gap-3 sm:col-span-2">
        <input type="checkbox" name="is_current" defaultChecked={season ? season.is_current : true} className="h-5 w-5 accent-pitch" />
        Saison en cours (affichée aux joueurs)
      </label>
      <SubmitButton variant={season ? "secondary" : "primary"}>{season ? "Enregistrer" : "Créer la saison"}</SubmitButton>
    </ActionForm>
  );
}

export function NotificationSettingsForm({ notifyOnOpen, reminderHours }: { notifyOnOpen: boolean; reminderHours: number }) {
  return (
    <ActionForm action={saveNotificationSettingsAction} className="space-y-4">
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" name="notify_on_open" defaultChecked={notifyOnOpen} className="h-5 w-5 accent-pitch" />
        Prévenir les joueurs de la feuille de match à l&apos;ouverture du vote
      </label>
      <Field label="Rappel avant l'heure limite (heures)" hint="Envoyé seulement à ceux qui n'ont pas encore voté. 0 = pas de rappel.">
        <input type="number" name="reminder_hours" min={0} max={72} defaultValue={reminderHours} className={`${inputClass} max-w-32`} required />
      </Field>
      <SubmitButton>Enregistrer</SubmitButton>
    </ActionForm>
  );
}
