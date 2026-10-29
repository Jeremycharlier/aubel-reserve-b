"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMaitre } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { rowsToMatches, type ImportResult } from "@/lib/calendar-import";
import { parseCsv } from "@/lib/csv";
import { translateError } from "@/lib/errors";
import { createUserClient } from "@/lib/supabase/server";
import { readFirstSheet } from "@/lib/xlsx";

const MAX_BYTES = 2 * 1024 * 1024;

const hours = (v: FormDataEntryValue | null, fallback: number | null) => {
  const s = String(v ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 24 * 30 ? n : NaN;
};

/** Étape 1 : lecture du fichier et aperçu (rien n'est enregistré). */
export async function previewImportAction(_p: ActionResult<ImportResult>, fd: FormData): Promise<ActionResult<ImportResult>> {
  await requireMaitre();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return failure("Choisissez un fichier .xlsx ou .csv.");
  if (file.size > MAX_BYTES) return failure("Fichier trop volumineux (2 Mo maximum).");

  const opensManual = fd.get("opens_mode") === "manuel";
  const closesManual = fd.get("closes_mode") === "manuel";
  const defaults = {
    opensAfterHours: opensManual ? null : hours(fd.get("opens_after"), 2),
    deadlineAfterHours: hours(fd.get("deadline_after"), 48),
    closesAfterHours: closesManual ? null : hours(fd.get("closes_after"), 72),
  };
  if (Object.values(defaults).some((v) => Number.isNaN(v)) || defaults.deadlineAfterHours === null) {
    return failure("Délais invalides.");
  }

  const name = file.name.toLowerCase();
  let table: string[][];
  try {
    if (name.endsWith(".xlsx")) {
      table = await readFirstSheet(await file.arrayBuffer());
    } else if (name.endsWith(".csv") || name.endsWith(".txt")) {
      table = parseCsv(await file.text());
    } else {
      return failure("Format non reconnu : utilisez .xlsx (Excel) ou .csv. Pour un ancien .xls, enregistrez-le d'abord en .xlsx.");
    }
  } catch {
    return failure("Le fichier n'a pas pu être lu. Vérifiez qu'il s'agit bien d'un fichier Excel ou CSV.");
  }
  const result = rowsToMatches(table, defaults as Parameters<typeof rowsToMatches>[1]);
  return success(
    result.errors.length
      ? `${result.errors.length} ligne${result.errors.length > 1 ? "s" : ""} à corriger avant l'import.`
      : `${result.matches.length} match${result.matches.length > 1 ? "s" : ""} prêt${result.matches.length > 1 ? "s" : ""} à importer.`,
    result,
  );
}

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
const rowsSchema = z
  .array(
    z.object({
      opponent: z.string().trim().min(1).max(80),
      kickoff: local,
      location: z.string().max(120).nullable(),
      opens: local.nullable(),
      deadline: local,
      closes: local.nullable(),
      counts: z.boolean(),
    }),
  )
  .min(1)
  .max(200);

/** Étape 2 : enregistrement (transaction unique côté base). */
export async function confirmImportAction(seasonId: string, rows: unknown): Promise<ActionResult<{ created: number; skipped: number }>> {
  await requireMaitre();
  if (!z.uuid().safeParse(seasonId).success) return failure("Choisissez une saison.");
  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success) return failure("Données d'import invalides. Relancez l'aperçu.");
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("admin_import_matches", { p_season_id: seasonId, p_rows: parsed.data });
  if (error) return failure(translateError(error));
  revalidatePath("/", "layout");
  const r = data as { created: number; skipped: number };
  return success(
    `${r.created} match${r.created > 1 ? "s" : ""} créé${r.created > 1 ? "s" : ""}${r.skipped ? `, ${r.skipped} déjà présent${r.skipped > 1 ? "s" : ""} ignoré${r.skipped > 1 ? "s" : ""}` : ""}.`,
    r,
  );
}
