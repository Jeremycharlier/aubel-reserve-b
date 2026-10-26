"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { buttonClass } from "@/components/ui";
import { deleteMatchAction, saveSheetAction, setArchivedAction, setVoteStateAction } from "../../actions";

export function VoteStateControls({
  matchId,
  effective,
  hasManual,
  hasSchedule,
  sheetSize,
}: {
  matchId: string;
  effective: "a_venir" | "ouvert" | "ferme";
  hasManual: boolean;
  hasSchedule: boolean;
  sheetSize: number;
}) {
  return (
    <ActionForm action={setVoteStateAction}>
      <input type="hidden" name="match_id" value={matchId} />
      <div className="flex flex-wrap gap-2">
        {effective !== "ouvert" ? (
          <button
            name="state"
            value="ouvert"
            className={buttonClass("primary")}
            onClick={(e) => {
              if (sheetSize < 4 && !window.confirm("La feuille de match compte moins de 4 joueurs. Ouvrir quand même le vote ?")) {
                e.preventDefault();
              }
            }}
          >
            Ouvrir le vote maintenant
          </button>
        ) : (
          <button
            name="state"
            value="ferme"
            className={buttonClass("danger")}
            onClick={(e) => {
              if (!window.confirm("Fermer le vote ? Les joueurs ne pourront plus voter ni modifier leur bulletin.")) e.preventDefault();
            }}
          >
            Fermer le vote maintenant
          </button>
        )}
        {hasManual && hasSchedule ? (
          <button name="state" value="auto" className={buttonClass("secondary")}>
            Revenir aux horaires programmés
          </button>
        ) : null}
      </div>
    </ActionForm>
  );
}

export function SheetForm({
  matchId,
  players,
  selected,
  locked,
}: {
  matchId: string;
  players: { id: string; name: string; number: number | null; active: boolean }[];
  selected: string[];
  locked: string[];
}) {
  const [checked, setChecked] = useState(() => new Set(selected));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ActionForm action={saveSheetAction}>
      <input type="hidden" name="match_id" value={matchId} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{checked.size} joueur{checked.size > 1 ? "s" : ""} sélectionné{checked.size > 1 ? "s" : ""}</span>
        <button type="button" className={buttonClass("ghost", "min-h-10 px-3 text-sm")} onClick={() => setChecked(new Set(players.filter((p) => p.active).map((p) => p.id)))}>
          Tous les actifs
        </button>
        <button type="button" className={buttonClass("ghost", "min-h-10 px-3 text-sm")} onClick={() => setChecked(new Set(locked))}>
          Vider
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p) => {
          const isLocked = locked.includes(p.id);
          return (
            <li key={p.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg bg-turf px-3 has-[:checked]:bg-pitch-soft has-[:checked]:ring-2 has-[:checked]:ring-pitch">
                <input
                  type="checkbox"
                  name="player"
                  value={p.id}
                  checked={checked.has(p.id)}
                  onChange={() => !isLocked && toggle(p.id)}
                  className="h-5 w-5 accent-pitch"
                />
                <span className="num w-6 text-right text-sm text-muted">{p.number ?? ""}</span>
                <span className="flex-1 font-semibold">
                  {p.name}
                  {!p.active ? <span className="font-normal text-muted"> (inactif)</span> : null}
                </span>
                {isLocked ? <span className="text-xs text-muted" title="A déjà voté ou reçu des voix">verrouillé</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <SubmitButton>Enregistrer la feuille de match</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DangerZone({ matchId, archived, hasVotes }: { matchId: string; archived: boolean; hasVotes: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <ActionForm action={setArchivedAction}>
        <input type="hidden" name="match_id" value={matchId} />
        <input type="hidden" name="archived" value={archived ? "false" : "true"} />
        <SubmitButton variant="secondary" confirm={archived ? undefined : "Archiver ce match ? Il sera masqué du calendrier des joueurs et le vote sera fermé, mais ses résultats restent comptés."}>
          {archived ? "Désarchiver" : "Archiver le match"}
        </SubmitButton>
      </ActionForm>
      <ActionForm action={deleteMatchAction}>
        <input type="hidden" name="match_id" value={matchId} />
        <SubmitButton
          variant="danger"
          disabled={hasVotes}
          confirm="Supprimer définitivement ce match ? Cette action est irréversible."
        >
          Supprimer le match
        </SubmitButton>
      </ActionForm>
      {hasVotes ? (
        <p className="w-full text-sm text-muted">
          Ce match contient des bulletins : il ne peut pas être supprimé. Archivez-le, ou décochez « Compter ce match dans le
          classement ».
        </p>
      ) : null}
    </div>
  );
}
