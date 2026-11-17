"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import {
  cancelNotificationAction,
  runDispatchNowAction,
  saveNotificationSettingsAction,
  scheduleNotificationAction,
} from "../actions";

export function ComposeForm({ matches }: { matches: { id: string; label: string }[] }) {
  const [audience, setAudience] = useState("moi");
  const [when, setWhen] = useState("maintenant");
  return (
    <ActionForm action={scheduleNotificationAction} className="space-y-4" resetOnSuccess>
      <Field label="Titre" hint="60 caractères maximum.">
        <input name="title" className={inputClass} required maxLength={60} placeholder="ex. Entraînement annulé" />
      </Field>
      <Field label="Message" hint="200 caractères maximum.">
        <textarea name="body" className={`${inputClass} min-h-24 py-2`} required maxLength={200} placeholder="ex. Terrain impraticable, rendez-vous jeudi." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destinataires">
          <select name="audience" className={inputClass} value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="moi">Moi seulement (test)</option>
            <option value="tous">Toute l&apos;équipe</option>
            <option value="feuille">Joueurs de la feuille d&apos;un match</option>
          </select>
        </Field>
        <Field label="Match concerné" hint="Pour les joueurs de la feuille, ou pour ouvrir la page du match.">
          <select name="match_id" className={inputClass} defaultValue="" required={audience === "feuille"}>
            <option value="">Aucun</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Au toucher, ouvrir">
          <select name="link" className={inputClass} defaultValue="accueil">
            <option value="accueil">L&apos;accueil de l&apos;application</option>
            <option value="match">La page du match choisi</option>
          </select>
        </Field>
        <Field label="Quand">
          <select name="when" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)}>
            <option value="maintenant">Maintenant</option>
            <option value="plus_tard">À une date et heure précises</option>
          </select>
        </Field>
      </div>
      {when === "plus_tard" ? (
        <Field label="Date et heure d'envoi (heure belge)" hint="Le planificateur vérifie toutes les 10 minutes : l'envoi peut avoir jusqu'à 10 minutes de décalage.">
          <input type="datetime-local" name="send_at" className={`${inputClass} max-w-xs`} required />
        </Field>
      ) : null}
      <SubmitButton pendingLabel="Envoi…">{when === "maintenant" ? "Envoyer maintenant" : "Programmer"}</SubmitButton>
    </ActionForm>
  );
}

export function CancelButton({ id }: { id: string }) {
  return (
    <ActionForm action={cancelNotificationAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="min-h-10 px-3 text-sm" confirm="Annuler cette notification programmée ?">
        Annuler
      </SubmitButton>
    </ActionForm>
  );
}

export function DispatchNow() {
  return (
    <ActionForm action={runDispatchNowAction}>
      <SubmitButton variant="secondary" pendingLabel="Vérification…">
        Envoyer maintenant ce qui est dû
      </SubmitButton>
    </ActionForm>
  );
}

export function PrefsForm({
  notifyOnOpen,
  reminderHours,
  notifyAvailability,
  notifyConvocation,
}: {
  notifyOnOpen: boolean;
  reminderHours: number;
  notifyAvailability: boolean;
  notifyConvocation: boolean;
}) {
  return (
    <ActionForm action={saveNotificationSettingsAction} className="space-y-3">
      {[
        ["notify_availability", notifyAvailability, "Inscriptions ouvertes (lundi 9 h) : aux joueurs qui n'ont pas encore répondu"],
        ["notify_convocation", notifyConvocation, "Convocation : aux joueurs retenus, à la validation de la feuille"],
        ["notify_on_open", notifyOnOpen, "Vote ouvert : aux joueurs de la feuille qui n'ont pas encore voté"],
      ].map(([name, checked, label]) => (
        <label key={name as string} className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name={name as string} defaultChecked={checked as boolean} className="h-5 w-5 shrink-0 accent-pitch" />
          {label as string}
        </label>
      ))}
      <Field label="Rappel de vote avant l'heure limite (heures)" hint="Seulement à ceux qui n'ont pas voté. 0 = pas de rappel.">
        <input type="number" name="reminder_hours" min={0} max={72} defaultValue={reminderHours} className={`${inputClass} max-w-32`} required />
      </Field>
      <SubmitButton>Enregistrer</SubmitButton>
    </ActionForm>
  );
}
