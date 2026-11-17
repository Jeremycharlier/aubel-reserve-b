"use client";

import { useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { buttonClass } from "@/components/ui";
import {
  adminSetAvailabilityAction,
  deleteMatchAction,
  saveSheetAction,
  setArchivedAction,
  setVoteStateAction,
  validateSheetAction,
} from "../../actions";

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
  availability = {},
}: {
  matchId: string;
  players: { id: string; name: string; number: number | null; active: boolean; defaultRole: Role }[];
  selected: Record<string, Role>;
  locked: string[];
  availability?: Record<string, Avail>;
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
        {Object.keys(availability).length > 0 ? (
          <button
            type="button"
            className={buttonClass("ghost", "min-h-10 px-3 text-sm")}
            onClick={() =>
              setRoles((prev) => {
                const next = { ...prev };
                for (const p of players) if (availability[p.id] === "present" && !(p.id in next)) next[p.id] = p.defaultRole;
                return next;
              })
            }
          >
            Cocher les présents
          </button>
        ) : null}
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
                  {availability[p.id] ? (
                    <span
                      className={`block text-xs font-semibold ${
                        availability[p.id] === "present" ? "text-pitch" : availability[p.id] === "absent" ? "text-late" : "text-warn"
                      }`}
                    >
                      {AVAIL.find((x) => x.value === availability[p.id])!.label}
                    </span>
                  ) : null}
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

export function DangerZone({
  matchId,
  archived,
  hasVotes,
  canDelete = true,
}: {
  matchId: string;
  archived: boolean;
  hasVotes: boolean;
  canDelete?: boolean;
}) {
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
      {canDelete ? (
      <ActionForm action={deleteMatchAction} className="rounded-xl border-2 border-late-soft p-4">
        <input type="hidden" name="match_id" value={matchId} />
        {hasVotes ? (
          <>
            <p className="text-sm">
              Ce match contient des votes ou des faits de match. Les supprimer les retire définitivement du
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
      ) : null}
    </div>
  );
}

type Avail = "present" | "absent" | "incertain";
const AVAIL: { value: Avail; label: string; cls: string }[] = [
  { value: "present", label: "Présent", cls: "bg-pitch text-chalk" },
  { value: "incertain", label: "Incertain", cls: "bg-warn text-chalk" },
  { value: "absent", label: "Absent", cls: "bg-late text-chalk" },
];

export function AvailabilityBoard({
  matchId,
  players,
  answers,
  editable,
}: {
  matchId: string;
  players: { id: string; name: string; number: number | null }[];
  answers: Record<string, { status: Avail; comment: string | null }>;
  editable: boolean;
}) {
  const [local, setLocal] = useState(answers);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const counts = { present: 0, incertain: 0, absent: 0, none: 0 };
  for (const p of players) {
    const a = local[p.id];
    if (a) counts[a.status] += 1;
    else counts.none += 1;
  }
  const order = (id: string) => ({ present: 0, incertain: 1, absent: 3 })[local[id]?.status ?? "none"] ?? 2;

  return (
    <div>
      <dl className="mb-3 grid grid-cols-4 gap-2 text-center text-sm">
        {[
          ["Présents", counts.present, "text-pitch"],
          ["Incertains", counts.incertain, "text-warn"],
          ["Sans réponse", counts.none, "text-muted"],
          ["Absents", counts.absent, "text-late"],
        ].map(([label, n, cls]) => (
          <div key={label as string} className="rounded-lg bg-turf py-2">
            <dd className={`num font-display text-2xl font-bold ${cls}`}>{n}</dd>
            <dt className="text-xs font-semibold text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-line">
        {[...players]
          .sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name, "fr"))
          .map((p) => {
            const a = local[p.id];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="num w-6 text-right text-sm text-muted">{p.number ?? ""}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{p.name}</span>
                  {a?.comment ? <span className="block text-xs text-muted">« {a.comment} »</span> : null}
                </span>
                {editable ? (
                  <select
                    aria-label={`Disponibilité de ${p.name}`}
                    value={a?.status ?? ""}
                    disabled={pending}
                    onChange={(e) => {
                      const v = (e.target.value || null) as Avail | null;
                      const prev = local;
                      setLocal((cur) => {
                        const next = { ...cur };
                        if (v) next[p.id] = { status: v, comment: cur[p.id]?.comment ?? null };
                        else delete next[p.id];
                        return next;
                      });
                      startTransition(async () => {
                        const res = await adminSetAvailabilityAction(matchId, p.id, v);
                        if (!res.ok) {
                          setLocal(prev);
                          setError(res.message);
                        } else setError(null);
                      });
                    }}
                    className={`min-h-10 rounded-lg border border-line px-2 text-sm font-semibold ${
                      a ? AVAIL.find((x) => x.value === a.status)!.cls : "bg-white text-muted"
                    }`}
                  >
                    <option value="">Sans réponse</option>
                    {AVAIL.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : a ? (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${AVAIL.find((x) => x.value === a.status)!.cls}`}>
                    {AVAIL.find((x) => x.value === a.status)!.label}
                  </span>
                ) : (
                  <span className="text-xs text-muted">Sans réponse</span>
                )}
              </li>
            );
          })}
      </ul>
      {error ? <p className="mt-2 text-sm font-semibold text-late">{error}</p> : null}
    </div>
  );
}

export function ValidateSheetControl({ matchId, validated, count }: { matchId: string; validated: boolean; count: number }) {
  return (
    <ActionForm action={validateSheetAction}>
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="validated" value={validated ? "false" : "true"} />
      <SubmitButton
        variant={validated ? "secondary" : "primary"}
        disabled={!validated && count === 0}
        confirm={
          validated
            ? "Rouvrir la feuille ? Les joueurs pourront de nouveau modifier leur disponibilité."
            : `Valider la feuille et convoquer ${count} joueur${count > 1 ? "s" : ""} ?`
        }
      >
        {validated ? "Rouvrir les disponibilités" : `Valider la feuille et convoquer (${count})`}
      </SubmitButton>
    </ActionForm>
  );
}
