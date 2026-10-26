import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildStandingsPdf, sanitize, type StandingRow } from "@/lib/pdf";

const rows: StandingRow[] = Array.from({ length: 34 }, (_, i) => ({
  rank: i < 2 ? 1 : i + 1,
  display_name: ["Loïc Pirard", "Sébastien Brouwers", "Cédric Meessen"][i % 3] + ` ${i + 1}`,
  gross_points: 60 - i,
  penalty_points: i % 4 === 0 ? 2 : 0,
  net_points: Math.max(0, 60 - i - (i % 4 === 0 ? 2 : 0)),
  matches_counted: 10,
  late_count: i % 4 === 0 ? 1 : 0,
}));

describe("Export PDF du classement", () => {
  it("produit un PDF valide, paginé, sans données de bulletin", async () => {
    const bytes = await buildStandingsPdf({
      teamName: "Aubel Réserve B",
      seasonName: "2026-2027",
      generatedAt: "08/11/2026 18:05:09",
      rows,
      penaltyNote: "Malus en vigueur : retard 2 pt(s).",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toContain("Classement 2026-2027");
    mkdirSync("tests/output", { recursive: true });
    writeFileSync("tests/output/classement-exemple.pdf", bytes);
  });

  it("gère un classement vide", async () => {
    const bytes = await buildStandingsPdf({
      teamName: "Aubel Réserve B",
      seasonName: "2027-2028",
      generatedAt: "x",
      rows: [],
      penaltyNote: "",
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("remplace les caractères non imprimables par les polices standard", () => {
    expect(sanitize("Équipe — « test » ’ok’")).toBe("Équipe — « test » 'ok'");
    expect(sanitize("Joueur 😀")).toBe("Joueur ?");
  });
});
