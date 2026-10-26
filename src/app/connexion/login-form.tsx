"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Identifiant">
        <input
          name="username"
          className={inputClass}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ex. jean.dupont"
          required
        />
      </Field>
      <Field label="Mot de passe">
        <input name="password" type="password" className={inputClass} autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Connexion…">
        Se connecter
      </SubmitButton>
    </ActionForm>
  );
}
