"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/forms";
import { Button, Field, Notice, buttonClass, inputClass } from "@/components/ui";
import { initialResult, type ActionResult } from "@/lib/action-result";
import type { ImportResult } from "@/lib/calendar-import";
import { confirmImportAction, previewImportAction } from "./actions";

const hoursClass = "min-h-12 w-20 shrink-0 rounded-lg border border-line bg-white px-3 text-base text-ink focus:border-pitch focus:outline-none focus:ring-2 focus:ring-pitch/30";

const fmt = (local: string | null) => {
  if (!local) return "manuel";
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)} ${t.slice(0, 5)}`;
};

export function ImportForm({ seasons, defaultSeason }: { seasons: { id: string; name: string }[]; defaultSeason: string }) {
  const [state, preview] = useActionState(previewImportAction, initialResult as unknown as ActionResult<ImportResult>);
  const [seasonId, setSeasonId] = useState(defaultSeason);
  const [opensMode, setOpensMode] = useState<"auto" | "manuel">("auto");
  const [closesMode, setClosesMode] = useState<"auto" | "manuel">("auto");
  const [done, setDone] = useState<ActionResult<{ created: number; skipped: number }> | null>(null);
  const [pending, startTransition] = useTransition();
  const result = state.ok ? state.data : undefined;

  return (
    <div className="space-y-5">
      <form action={preview} className="space-y-5">
        <Field label="Saison">
          <select className={inputClass} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fichier Excel (.xlsx) ou CSV">
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-pitch file:px-4 file:font-semibold file:text-chalk"
          />
        </Field>

        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 font-semibold">Horaires de vote pour les lignes qui ne les précisent pas</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Field label="Ouverture">
                <select name="opens_mode" className={inputClass} value={opensMode} onChange={(e) => setOpensMode(e.target.value as "auto" | "manuel")}>
                  <option value="auto">Automatique</option>
                  <option value="manuel">Manuelle</option>
                </select>
              </Field>
              {opensMode === "auto" ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input name="opens_after" type="number" min={0} max={720} defaultValue={2} className={hoursClass} />
                  h après le coup d&apos;envoi
                </label>
              ) : null}
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold">Heure limite</span>
              <label className="flex items-center gap-2 text-sm">
                <input name="deadline_after" type="number" min={0} max={720} defaultValue={48} className={hoursClass} required />
                h après le coup d&apos;envoi
              </label>
            </div>
            <div>
              <Field label="Fermeture">
                <select name="closes_mode" className={inputClass} value={closesMode} onChange={(e) => setClosesMode(e.target.value as "auto" | "manuel")}>
                  <option value="auto">Automatique</option>
                  <option value="manuel">Manuelle</option>
                </select>
              </Field>
              {closesMode === "auto" ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input name="closes_after" type="number" min={0} max={720} defaultValue={72} className={hoursClass} />
                  h après le coup d&apos;envoi
                </label>
              ) : null}
            </div>
          </div>
        </fieldset>

        <SubmitButton variant="secondary" pendingLabel="Lecture…">
          Vérifier le fichier
        </SubmitButton>
      </form>

      {state.message && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}

      {result ? (
        <section className="space-y-3" aria-live="polite">
          <Notice tone={result.errors.length ? "warn" : "info"}>{state.message}</Notice>
          {result.errors.length ? (
            <ul className="space-y-1 rounded-lg bg-late-soft px-4 py-3 text-sm text-late">
              {result.errors.map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  Ligne {e.line} : {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          {result.matches.length ? (
            <div className="overflow-x-auto rounded-xl bg-chalk">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="bg-turf text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Match</th>
                    <th scope="col" className="px-3 py-2">Coup d&apos;envoi</th>
                    <th scope="col" className="px-3 py-2">Ouverture</th>
                    <th scope="col" className="px-3 py-2">Limite</th>
                    <th scope="col" className="px-3 py-2">Fermeture</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m) => (
                    <tr key={m.line} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{m.opponent}</span>
                        <span className="block text-xs text-muted">
                          {m.location ?? "lieu non précisé"}
                          {m.counts ? "" : ", hors classement"}
                        </span>
                      </td>
                      <td className="num px-3 py-2">{fmt(m.kickoff)}</td>
                      <td className="num px-3 py-2">{fmt(m.opens)}</td>
                      <td className="num px-3 py-2">{fmt(m.deadline)}</td>
                      <td className="num px-3 py-2">{fmt(m.closes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.matches.length && !result.errors.length && !done?.ok ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setDone(await confirmImportAction(seasonId, result.matches));
                })
              }
            >
              {pending ? "Import…" : `Importer ${result.matches.length} match${result.matches.length > 1 ? "s" : ""}`}
            </Button>
          ) : null}
        </section>
      ) : null}

      {done ? (
        <div className="space-y-3">
          <Notice tone={done.ok ? "success" : "error"}>{done.message}</Notice>
          {done.ok ? (
            <Link href={`/maitre/matchs?saison=${seasonId}`} className={buttonClass("primary")}>
              Voir le calendrier
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
