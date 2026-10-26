"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { saveMatchAction } from "../actions";

export type MatchFormValues = {
  id?: string;
  season_id: string;
  opponent: string;
  location: string;
  kickoff: string;
  opens: string;
  closes: string;
  deadline: string;
  counts: boolean;
};

export function MatchForm({
  values,
  seasons,
}: {
  values: MatchFormValues;
  seasons: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={saveMatchAction} className="space-y-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adversaire">
          <input name="opponent" className={inputClass} defaultValue={values.opponent} required maxLength={80} />
        </Field>
        <Field label="Lieu (facultatif)">
          <input name="location" className={inputClass} defaultValue={values.location} maxLength={120} />
        </Field>
        <Field label="Date et heure du match">
          <input type="datetime-local" name="kickoff" className={inputClass} defaultValue={values.kickoff} required />
        </Field>
        <Field label="Saison">
          <select name="season_id" className={inputClass} defaultValue={values.season_id} required>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">Horaires du vote (heure belge)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Heure limite" hint="Un premier bulletin reçu après cette heure est en retard.">
            <input type="datetime-local" name="deadline" className={inputClass} defaultValue={values.deadline} required />
          </Field>
          <Field label="Ouverture automatique" hint="Facultatif. Vide = ouverture manuelle.">
            <input type="datetime-local" name="opens" className={inputClass} defaultValue={values.opens} />
          </Field>
          <Field label="Fermeture automatique" hint="Facultatif. Peut être après l'heure limite.">
            <input type="datetime-local" name="closes" className={inputClass} defaultValue={values.closes} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-muted">
          Vous pouvez à tout moment ouvrir ou fermer le vote à la main : la dernière action, manuelle ou programmée,
          l&apos;emporte.
        </p>
      </fieldset>

      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" name="counts" defaultChecked={values.counts} className="h-5 w-5 accent-pitch" />
        <span>Compter ce match dans le classement de la saison</span>
      </label>

      <SubmitButton>{values.id ? "Enregistrer les modifications" : "Créer le match"}</SubmitButton>
    </ActionForm>
  );
}
