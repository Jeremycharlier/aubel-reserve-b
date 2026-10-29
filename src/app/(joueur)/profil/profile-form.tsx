"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { updateProfileAction } from "./actions";

export function ProfileForm({
  fullName,
  nickname,
  useNickname,
  birthDate,
}: {
  fullName: string;
  nickname: string | null;
  useNickname: boolean;
  birthDate: string | null;
}) {
  const [nick, setNick] = useState(nickname ?? "");
  const [use, setUse] = useState(useNickname);
  const shown = use && nick.trim() ? nick.trim() : fullName;
  return (
    <ActionForm action={updateProfileAction} className="space-y-4">
      <Field label="Surnom (facultatif)" hint="30 caractères maximum.">
        <input
          name="nickname"
          className={inputClass}
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          maxLength={30}
          placeholder="ex. Le Mur"
        />
      </Field>
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          name="use_nickname"
          checked={use}
          disabled={!nick.trim()}
          onChange={(e) => setUse(e.target.checked)}
          className="h-5 w-5 accent-pitch"
        />
        Afficher mon surnom à la place de mon nom
      </label>
      <p className="rounded-lg bg-turf px-3 py-2 text-sm">
        Les autres vous verront sous le nom : <strong>{shown}</strong>
      </p>
      <Field label="Date de naissance (facultatif)" hint="Visible par les membres de l'équipe.">
        <input type="date" name="birth_date" className={inputClass} defaultValue={birthDate ?? ""} max="2025-12-31" />
      </Field>
      <SubmitButton>Enregistrer mon profil</SubmitButton>
    </ActionForm>
  );
}
