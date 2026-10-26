"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { installAction } from "./actions";

export function InstallForm() {
  return (
    <ActionForm action={installAction} className="space-y-4">
      <Field label="Code d'installation">
        <input name="token" type="password" className={inputClass} required autoComplete="off" />
      </Field>
      <Field label="Votre nom affiché">
        <input name="display_name" className={inputClass} required maxLength={60} placeholder="Marc Lejeune" />
      </Field>
      <Field label="Numéro de maillot (facultatif)">
        <input name="shirt_number" type="number" min={1} max={99} className={inputClass} />
      </Field>
      <Field label="Identifiant de connexion" hint="Minuscules, chiffres, point ou tiret. Ex. coach">
        <input name="username" className={inputClass} required autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </Field>
      <Field label="Mot de passe" hint="8 caractères minimum, avec au moins une lettre et un chiffre.">
        <input name="password" type="password" className={inputClass} required minLength={8} autoComplete="new-password" />
      </Field>
      <Field label="Confirmer le mot de passe">
        <input name="confirm" type="password" className={inputClass} required minLength={8} autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Création…">
        Créer le compte maître
      </SubmitButton>
    </ActionForm>
  );
}
