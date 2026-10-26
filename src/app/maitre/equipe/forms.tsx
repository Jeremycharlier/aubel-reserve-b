"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import {
  createAccountAction,
  resetPasswordAction,
  savePlayerAction,
  setAccountActiveAction,
  type Credentials,
} from "../actions";

/** Fiche à remettre au joueur : affichée une seule fois, jamais stockée en clair. */
function CredentialsCard({ result }: { result: ActionResult<Credentials> }) {
  const [copied, setCopied] = useState(false);
  if (!result.data) return null;
  const { username, tempPassword } = result.data;
  const message = (origin: string) =>
    `Aubel Réserve B\nAdresse : ${origin}\nIdentifiant : ${username}\nMot de passe temporaire : ${tempPassword}\nVous choisirez votre propre mot de passe à la première connexion.`;
  return (
    <div className="mt-3 rounded-xl border-2 border-gold bg-white p-4">
      <p className="text-sm text-muted">Accès à transmettre (affichés une seule fois)</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Identifiant</dt>
        <dd className="font-mono text-lg font-semibold">{username}</dd>
        <dt className="text-muted">Mot de passe</dt>
        <dd className="font-mono text-lg font-semibold tracking-wide">{tempPassword}</dd>
      </dl>
      <button
        type="button"
        className="mt-3 min-h-11 rounded-lg bg-pitch px-4 text-sm font-semibold text-chalk"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(message(window.location.origin));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copié" : "Copier le message à envoyer"}
      </button>
    </div>
  );
}

export function NewPlayerForm({ unlinked }: { unlinked: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  return (
    <ActionForm action={createAccountAction} resetOnSuccess renderResult={(r) => <CredentialsCard result={r} />}>
      {unlinked.length > 0 ? (
        <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Type de création">
          {(["new", "existing"] as const).map((m) => (
            <button
              type="button"
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${mode === m ? "bg-pitch text-chalk" : "bg-turf text-ink"}`}
            >
              {m === "new" ? "Nouveau joueur" : "Joueur déjà dans l'effectif"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === "new" ? (
          <>
            <Field label="Nom affiché">
              <input name="new_player_name" className={inputClass} required maxLength={60} placeholder="Jean Dupont" />
            </Field>
            <Field label="N° de maillot (facultatif)">
              <input name="shirt_number" type="number" min={1} max={99} className={inputClass} />
            </Field>
          </>
        ) : (
          <Field label="Joueur">
            <select name="player_id" className={inputClass} required defaultValue="">
              <option value="" disabled>
                Choisir…
              </option>
              {unlinked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Identifiant de connexion" hint="Minuscules, chiffres, point ou tiret. Ex. jean.dupont">
          <input name="username" className={inputClass} required autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
      </div>
      <div className="mt-4">
        <SubmitButton pendingLabel="Création…">Créer le compte</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PlayerOnlyForm() {
  return (
    <ActionForm action={savePlayerAction} resetOnSuccess className="grid items-end gap-3 sm:grid-cols-[1fr_10rem_auto]">
      <Field label="Nom affiché">
        <input name="display_name" className={inputClass} required maxLength={60} />
      </Field>
      <Field label="N° de maillot">
        <input name="shirt_number" type="number" min={1} max={99} className={inputClass} />
      </Field>
      <SubmitButton variant="secondary">Ajouter sans compte</SubmitButton>
    </ActionForm>
  );
}

export function EditPlayerForm({ id, name, number, active, hasAccount }: { id: string; name: string; number: number | null; active: boolean; hasAccount: boolean }) {
  return (
    <ActionForm action={savePlayerAction} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_auto]">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active_field" value="1" />
      <Field label="Nom affiché">
        <input name="display_name" className={inputClass} defaultValue={name} required maxLength={60} />
      </Field>
      <Field label="N° de maillot">
        <input name="shirt_number" type="number" min={1} max={99} className={inputClass} defaultValue={number ?? ""} />
      </Field>
      {hasAccount ? (
        <input type="hidden" name="active" value={active ? "on" : ""} />
      ) : (
        <label className="flex min-h-12 items-center gap-2 sm:col-span-3">
          <input type="checkbox" name="active" defaultChecked={active} className="h-5 w-5 accent-pitch" />
          Joueur actif (proposé sur les feuilles de match)
        </label>
      )}
      <SubmitButton variant="secondary">Enregistrer</SubmitButton>
    </ActionForm>
  );
}

export function AccountActions({
  userId,
  username,
  displayName,
  active,
  isSelf,
}: {
  userId: string;
  username: string;
  displayName: string;
  active: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionForm action={resetPasswordAction} renderResult={(r) => <CredentialsCard result={r} />}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="username" value={username} />
        <input type="hidden" name="display_name" value={displayName} />
        <SubmitButton variant="secondary" confirm={`Générer un nouveau mot de passe temporaire pour ${displayName} ?`}>
          Réinitialiser le mot de passe
        </SubmitButton>
      </ActionForm>
      {!isSelf ? (
        <ActionForm action={setAccountActiveAction}>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <SubmitButton
            variant={active ? "danger" : "secondary"}
            confirm={active ? `Désactiver le compte de ${displayName} ? Il ne pourra plus se connecter ; son historique est conservé.` : undefined}
          >
            {active ? "Désactiver le compte" : "Réactiver le compte"}
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
