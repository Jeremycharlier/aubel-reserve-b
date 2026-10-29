"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { buttonClass } from "@/components/ui";
import { deleteMatchAction, saveSheetAction, saveStatsAction, setArchivedAction, setVoteStateAction } from "../../actions";

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

type Role = "joueur" | "delegue" | "supporter";
const ROLE_LABELS: Record<Role, string> = { joueur: "Joueur", delegue: "Délégué", supporter: "Supporter" };

export function SheetForm({
  matchId,
  players,
  selected,
  locked,
}: {
  matchId: string;
  players: { id: string; name: string; number: number | null; active: boolean; defaultRole: Role }[];
  selected: Record<string, Role>;
  locked: string[];
}) {
  const [roles, setRoles] = useState<Record<string, Role>>(() => ({ ...selected }));
  const count = Object.keys(roles).length;
  const toggle = (id: string, def: Role) =>
    setRoles((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = def;
      return next;
    });

  return (
    <ActionForm action={saveSheetAction}>
      <input type="hidden" name="match_id" value={matchId} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {count} présent{count > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className={buttonClass("ghost", "min-h-10 px-3 text-sm")}
          onClick={() =>
            setRoles((prev) => {
              const next = { ...prev };
              for (const p of players) if (p.active && !(p.id in next)) next[p.id] = p.defaultRole;
              return next;
            })
          }
        >
          Tous les actifs
        </button>
        <button
          type="button"
          className={buttonClass("ghost", "min-h-10 px-3 text-sm")}
          onClick={() => setRoles((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => locked.includes(id))))}
        >
          Vider
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {players.map((p) => {
          const isLocked = locked.includes(p.id);
          const on = p.id in roles;
          return (
            <li key={p.id} className={`flex min-h-14 items-center gap-2 rounded-lg px-3 py-1.5 ${on ? "bg-pitch-soft ring-2 ring-pitch" : "bg-turf"}`}>
              <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="player"
                  value={p.id}
                  checked={on}
                  onChange={() => !isLocked && toggle(p.id, p.defaultRole)}
                  className="h-5 w-5 accent-pitch"
                />
                <span className="num w-6 text-right text-sm text-muted">{p.number ?? ""}</span>
                <span className="flex-1 font-semibold">
                  {p.name}
                  {!p.active ? <span className="font-normal text-muted"> (inactif)</span> : null}
                  {isLocked ? <span className="block text-xs font-normal text-muted">a voté ou a des voix</span> : null}
                </span>
              </label>
              {on ? (
                <select
                  name={`role_${p.id}`}
                  value={roles[p.id]}
                  onChange={(e) => setRoles((prev) => ({ ...prev, [p.id]: e.target.value as Role }))}
                  className="min-h-10 rounded-lg border border-line bg-white px-2 text-sm font-semibold"
                  aria-label={`Statut de ${p.name}`}
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">
        Joueur et délégué : votent et peuvent recevoir des voix. Supporter : vote, mais ne peut pas être choisi.
      </p>
      <div className="mt-4">
        <SubmitButton>Enregistrer la feuille de match</SubmitButton>
      </div>
    </ActionForm>
  );
}

type StatRow = { id: string; name: string; number: number | null; goals: number; assists: number; yellow: number; red: number };

export function StatsForm({
  matchId,
  rows,
  scoreFor,
  scoreAgainst,
}: {
  matchId: string;
  rows: StatRow[];
  scoreFor: number | null;
  scoreAgainst: number | null;
}) {
  const num = "num min-h-11 w-11 rounded-lg border border-line bg-white px-0.5 text-center text-base sm:w-14";
  return (
    <ActionForm action={saveStatsAction}>
      <input type="hidden" name="match_id" value={matchId} />
      <fieldset className="mb-4 flex flex-wrap items-end gap-3">
        <legend className="mb-2 font-semibold">Score final (facultatif)</legend>
        <label className="text-sm">
          <span className="block text-muted">Aubel B</span>
          <input name="score_for" type="number" min={0} max={99} defaultValue={scoreFor ?? ""} className={num} />
        </label>
        <span className="pb-3 font-display text-xl font-bold">–</span>
        <label className="text-sm">
          <span className="block text-muted">Adversaire</span>
          <input name="score_against" type="number" min={0} max={99} defaultValue={scoreAgainst ?? ""} className={num} />
        </label>
      </fieldset>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Remplissez d&apos;abord la feuille de match.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full table-fixed text-sm">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 text-left">Joueur</th>
                <th scope="col" className="w-12 py-2 text-xs sm:w-16 sm:text-sm">Buts</th>
                <th scope="col" className="w-12 py-2 text-xs sm:w-16 sm:text-sm">Passes</th>
                <th scope="col" className="w-12 py-2 text-xs sm:w-16 sm:text-sm">Jaunes</th>
                <th scope="col" className="w-12 py-2 text-xs sm:w-16 sm:text-sm">Rouge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="truncate py-1.5 pr-2 font-semibold">
                    <input type="hidden" name="player" value={r.id} />
                    <span className="num mr-1 text-muted">{r.number ?? ""}</span>
                    {r.name}
                  </td>
                  <td className="py-1.5 text-center">
                    <input name={`goals_${r.id}`} type="number" min={0} max={20} defaultValue={r.goals || ""} placeholder="0" className={num} aria-label={`Buts de ${r.name}`} />
                  </td>
                  <td className="py-1.5 text-center">
                    <input name={`assists_${r.id}`} type="number" min={0} max={20} defaultValue={r.assists || ""} placeholder="0" className={num} aria-label={`Passes décisives de ${r.name}`} />
                  </td>
                  <td className="py-1.5 text-center">
                    <input name={`yellow_${r.id}`} type="number" min={0} max={2} defaultValue={r.yellow || ""} placeholder="0" className={num} aria-label={`Cartons jaunes de ${r.name}`} />
                  </td>
                  <td className="py-1.5 text-center">
                    <input name={`red_${r.id}`} type="number" min={0} max={1} defaultValue={r.red || ""} placeholder="0" className={num} aria-label={`Carton rouge de ${r.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4">
        <SubmitButton>Enregistrer score et statistiques</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DangerZone({ matchId, archived, hasVotes }: { matchId: string; archived: boolean; hasVotes: boolean }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="space-y-4">
      <ActionForm action={setArchivedAction}>
        <input type="hidden" name="match_id" value={matchId} />
        <input type="hidden" name="archived" value={archived ? "false" : "true"} />
        <SubmitButton
          variant="secondary"
          confirm={archived ? undefined : "Archiver ce match ? Il sera masqué du calendrier des joueurs et le vote sera fermé, mais ses résultats restent comptés."}
        >
          {archived ? "Désarchiver" : "Archiver le match"}
        </SubmitButton>
      </ActionForm>
      <ActionForm action={deleteMatchAction} className="rounded-xl border-2 border-late-soft p-4">
        <input type="hidden" name="match_id" value={matchId} />
        {hasVotes ? (
          <>
            <p className="text-sm">
              Ce match contient des bulletins, des malus ou des statistiques. Les supprimer les retire définitivement du
              classement. Une copie complète reste consultable dans le journal.
            </p>
            <label className="mt-3 block text-sm font-semibold">
              Tapez SUPPRIMER pour confirmer
              <input
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                className="mt-1 block min-h-12 w-full max-w-xs rounded-lg border border-line bg-white px-3 text-base"
              />
            </label>
          </>
        ) : null}
        <div className="mt-3">
          <SubmitButton
            variant="danger"
            disabled={hasVotes && typed.trim().toUpperCase() !== "SUPPRIMER"}
            confirm="Supprimer définitivement ce match ? Cette action est irréversible."
          >
            Supprimer le match
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
