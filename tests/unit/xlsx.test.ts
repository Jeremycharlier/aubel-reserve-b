import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildTemplate, readFirstSheet } from "@/lib/xlsx";
import { rowsToMatches, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS } from "@/lib/calendar-import";

const defaults = { opensAfterHours: 2, deadlineAfterHours: 48, closesAfterHours: 72 };
const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("Import Excel", () => {
  it("le modèle Excel téléchargeable se relit sans erreur", async () => {
    const buf = await buildTemplate(TEMPLATE_HEADERS, TEMPLATE_EXAMPLE);
    const table = await readFirstSheet(toAB(buf));
    const { matches, errors } = rowsToMatches(table, defaults);
    expect(errors).toEqual([]);
    expect(matches.map((m) => m.opponent)).toEqual(["FC Herve C", "RFC Warsage B", "Battice FC B (amical)"]);
  });

  it("gère les vraies cellules date et heure d'Excel", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Feuil1");
    ws.addRow(["Date", "Heure", "Adversaire", "Lieu"]);
    // Excel : date seule, heure seule (fraction de jour → 1899-12-30)
    ws.addRow([new Date(Date.UTC(2026, 10, 8)), new Date(Date.UTC(1899, 11, 30, 15, 30)), "Excel FC", "Aubel"]);
    ws.addRow([new Date(Date.UTC(2026, 10, 15, 14, 0)), null, "Date et heure dans une cellule", null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { matches, errors } = rowsToMatches(await readFirstSheet(toAB(buf)), defaults);
    expect(errors).toEqual([]);
    expect(matches[0]).toMatchObject({ opponent: "Excel FC", kickoff: "2026-11-08T15:30:00", location: "Aubel" });
    expect(matches[1].kickoff).toBe("2026-11-15T14:00:00");
  });
});
