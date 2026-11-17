"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { changePasswordAction } from "@/app/premiere-connexion/actions";

export function PasswordForm({ requireCurrent }: { requireCurrent: boolean }) {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4" resetOnSuccess>
      {requireCurrent ? (
        <Field label="Mot de passe actuel">
          <input name="current" type="password" className={inputClass} autoComplete="current-password" required />
        </Field>
      ) : null}
      <Field label="Nouveau mot de passe" hint="8 caractères minimum, avec au moins une lettre et un chiffre.">
        <input name="password" type="password" className={inputClass} autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirmer le mot de passe">
        <input name="confirm" type="password" className={inputClass} autoComplete="new-password" minLength={8} required />
      </Field>
      <SubmitButton className="w-full">Enregistrer le mot de passe</SubmitButton>
    </ActionForm>
  );
}
