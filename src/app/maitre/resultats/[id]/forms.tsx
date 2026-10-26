"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { correctBallotAction, setBallotStatusAction, setPenaltyAction } from "../../actions";

type P = { id: string; name: string };

export function CorrectionForm({
  matchId,
  squad,
  defaults,
}: {
  matchId: string;
  squad: P[];
  defaults?: { voter: string; picks: string[] };
}) {
  const options = squad.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ));
  return (
    <ActionForm action={correctBallotAction} className="space-y-3" key={defaults?.voter ?? "new"}>
      <input type="hidden" name="match_id" value={matchId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Votant">
          <select name="voter_player_id" className={inputClass} defaultValue={defaults?.voter ?? ""} required>
            <option value="" disabled>
              Choisir…
            </option>
            {options}
          </select>
        </Field>
        <Field label="Statut de retard" hint="« Inchangé » conserve le statut actuel (ou le calcule pour un nouveau bulletin).">
          <select name="is_late" className={inputClass} defaultValue="">
            <option value="">Inchangé</option>
            <option value="false">À temps</option>
            <option value="true">En retard</option>
          </select>
        </Field>
        {[1, 2, 3].map((n) => (
          <Field key={n} label={`${n}${n === 1 ? "er" : "e"} choix (${4 - n} pt${n < 3 ? "s" : ""})`}>
            <select name={`pick${n}`} className={inputClass} defaultValue={defaults?.picks[n - 1] ?? ""} required>
              <option value="" disabled>
                Choisir…
              </option>
              {options}
            </select>
          </Field>
        ))}
      </div>
      <Field label="Motif de la correction (obligatoire, journalisé)">
        <input name="reason" className={inputClass} required maxLength={300} placeholder="ex. Vote transmis par SMS au maître" />
      </Field>
      <SubmitButton confirm="Enregistrer cette correction ? Elle sera inscrite au journal avec les valeurs avant et après.">
        Enregistrer la correction
      </SubmitButton>
    </ActionForm>
  );
}

export function BallotStatusForm({ ballotId, matchId, status }: { ballotId: string; matchId: string; status: string }) {
  const next = status === "valide" ? "annule" : "valide";
  return (
    <ActionForm action={setBallotStatusAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="ballot_id" value={ballotId} />
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="status" value={next} />
      <input name="reason" className={`${inputClass} min-h-11 flex-1`} placeholder="Motif" required maxLength={300} aria-label="Motif" />
      <SubmitButton variant={next === "annule" ? "danger" : "secondary"} className="min-h-11">
        {next === "annule" ? "Annuler ce bulletin" : "Rétablir ce bulletin"}
      </SubmitButton>
    </ActionForm>
  );
}

export function PenaltyForm({
  matchId,
  squad,
  defaultPoints,
}: {
  matchId: string;
  squad: P[];
  defaultPoints: number;
}) {
  return (
    <ActionForm action={setPenaltyAction} className="space-y-3">
      <input type="hidden" name="match_id" value={matchId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Joueur">
          <select name="player_id" className={inputClass} required defaultValue="">
            <option value="" disabled>
              Choisir…
            </option>
            {squad.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select name="kind" className={inputClass}>
            <option value="retard">Retard</option>
            <option value="non_vote">Non-vote</option>
          </select>
        </Field>
        <Field label="Points">
          <input name="points" type="number" min={1} max={50} defaultValue={defaultPoints} className={inputClass} required />
        </Field>
        <Field label="Statut">
          <select name="status" className={inputClass}>
            <option value="active">Appliqué</option>
            <option value="annulee">Annulé</option>
          </select>
        </Field>
      </div>
      <Field label="Motif (obligatoire, journalisé)">
        <input name="reason" className={inputClass} required maxLength={300} />
      </Field>
      <SubmitButton variant="secondary">Enregistrer le malus</SubmitButton>
    </ActionForm>
  );
}
