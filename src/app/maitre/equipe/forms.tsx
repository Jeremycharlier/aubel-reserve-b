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

type Role = "joueur" | "delegue" | "supporter";

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: "joueur", label: "Joueur", hint: "Vote et peut recevoir des voix" },
  { value: "delegue", label: "Délégué", hint: "Vote et peut recevoir des voix" },
  { value: "supporter", label: "Supporter", hint: "Vote, mais personne ne peut voter pour lui" },
];

export function RoleSelect({ name = "default_role", defaultValue = "joueur" }: { name?: string; defaultValue?: Role }) {
  return (
    <Field label="Statut par défaut" hint="Repris sur chaque feuille de match, modifiable match par match.">
      <select name={name} className={inputClass} defaultValue={defaultValue}>
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} : {o.hint.toLowerCase()}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Surnom, choix d'affichage et date de naissance. */
function IdentityFields({
  nickname,
  useNickname,
  birthDate,
}: {
  nickname?: string | null;
  useNickname?: boolean;
  birthDate?: string | null;
}) {
  return (
    <>
      <Field label="Surnom (facultatif)">
        <input name="nickname" className={inputClass} defaultValue={nickname ?? ""} maxLength={30} />
      </Field>
      <Field label="Date de naissance (facultatif)">
        <input type="date" name="birth_date" className={inputClass} defaultValue={birthDate ?? ""} max="2025-12-31" />
      </Field>
      <label className="flex min-h-12 items-center gap-2 sm:col-span-full">
        <input type="checkbox" name="use_nickname" defaultChecked={useNickname} className="h-5 w-5 accent-pitch" />
        Afficher le surnom à la place du nom
      </label>
    </>
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
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "new" ? (
          <>
            <Field label="Nom et prénom">
              <input name="new_player_name" className={inputClass} required maxLength={60} placeholder="Jean Dupont" />
            </Field>
            <Field label="N° de maillot (facultatif)">
              <input name="shirt_number" type="number" min={1} max={99} className={inputClass} />
            </Field>
            <RoleSelect />
            <IdentityFields />
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
    <ActionForm action={savePlayerAction} resetOnSuccess className="grid items-end gap-3 sm:grid-cols-2">
      <Field label="Nom et prénom">
        <input name="full_name" className={inputClass} required maxLength={60} />
      </Field>
      <Field label="N° de maillot">
        <input name="shirt_number" type="number" min={1} max={99} className={inputClass} />
      </Field>
      <RoleSelect />
      <IdentityFields />
      <div className="sm:col-span-full">
        <SubmitButton variant="secondary">Ajouter sans compte</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditPlayerForm({
  player,
  hasAccount,
}: {
  player: {
    id: string;
    full_name: string;
    nickname: string | null;
    use_nickname: boolean;
    birth_date: string | null;
    shirt_number: number | null;
    default_role: Role;
    active: boolean;
  };
  hasAccount: boolean;
}) {
  const { id, active } = player;
  return (
    <ActionForm action={savePlayerAction} className="grid items-end gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active_field" value="1" />
      <Field label="Nom et prénom">
        <input name="full_name" className={inputClass} defaultValue={player.full_name} required maxLength={60} />
      </Field>
      <Field label="N° de maillot">
        <input name="shirt_number" type="number" min={1} max={99} className={inputClass} defaultValue={player.shirt_number ?? ""} />
      </Field>
      <RoleSelect defaultValue={player.default_role} />
      <IdentityFields nickname={player.nickname} useNickname={player.use_nickname} birthDate={player.birth_date} />
      {hasAccount ? (
        <input type="hidden" name="active" value={active ? "on" : ""} />
      ) : (
        <label className="flex min-h-12 items-center gap-2 sm:col-span-full">
          <input type="checkbox" name="active" defaultChecked={active} className="h-5 w-5 accent-pitch" />
          Joueur actif (proposé sur les feuilles de match)
        </label>
      )}
      <div className="sm:col-span-full">
        <SubmitButton variant="secondary">Enregistrer</SubmitButton>
      </div>
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
