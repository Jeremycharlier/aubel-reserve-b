// Génération du PDF du classement (côté serveur, sans dépendance native).
// Ne contient QUE le classement agrégé : aucun votant, aucun bulletin.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type StandingRow = {
  rank: number;
  display_name: string;
  gross_points: number;
  penalty_points: number;
  net_points: number;
  matches_counted: number;
  late_count: number;
};

export type StandingsPdfInput = {
  teamName: string;
  seasonName: string;
  generatedAt: string; // déjà formaté en heure de Bruxelles
  rows: StandingRow[];
  penaltyNote: string;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const GREEN = rgb(0.06, 0.36, 0.22);
const GREEN_LIGHT = rgb(0.92, 0.96, 0.93);
const GREY = rgb(0.42, 0.45, 0.48);
const INK = rgb(0.1, 0.12, 0.14);
const RED = rgb(0.7, 0.12, 0.12);

// Colonnes : [libellé, largeur, alignement]
const COLUMNS: Array<[string, number, "left" | "right" | "center"]> = [
  ["Rang", 42, "center"],
  ["Joueur", 185, "left"],
  ["Matchs", 50, "right"],
  ["Retards", 52, "right"],
  ["Pts bruts", 62, "right"],
  ["Malus", 52, "right"],
  ["Pts nets", 72, "right"],
];

function text(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(value, { x, y, size, font, color });
}

function fitText(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let v = value;
  while (v.length > 1 && font.widthOfTextAtSize(`${v}…`, size) > maxWidth) v = v.slice(0, -1);
  return `${v}…`;
}

/** Remplace les caractères hors WinAnsi (non gérés par les polices standard). */
export function sanitize(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u2014\u2013\u2026\u20AC\u0152\u0153]/gu, "?");
}

export async function buildStandingsPdf(input: StandingsPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`${input.teamName} — Classement ${input.seasonName}`));
  doc.setAuthor(sanitize(input.teamName));
  doc.setCreator("Aubel Réserve B");
  doc.setLanguage("fr-BE");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const tableWidth = COLUMNS.reduce((s, c) => s + c[1], 0);
  const left = (A4[0] - tableWidth) / 2;
  const rowH = 22;
  const pages: PDFPage[] = [];

  const drawHeader = (page: PDFPage, first: boolean): number => {
    let y = A4[1] - MARGIN;
    if (first) {
      page.drawRectangle({ x: 0, y: A4[1] - 110, width: A4[0], height: 110, color: GREEN });
      text(page, sanitize(`${input.teamName} — Classement de la saison`), MARGIN, A4[1] - 52, bold, 20, rgb(1, 1, 1));
      text(page, sanitize(`Saison ${input.seasonName}`), MARGIN, A4[1] - 76, regular, 12, rgb(0.85, 0.95, 0.88));
      text(page, sanitize(`Généré le ${input.generatedAt}`), MARGIN, A4[1] - 94, regular, 9, rgb(0.85, 0.95, 0.88));
      y = A4[1] - 140;
    } else {
      text(page, sanitize(`${input.teamName} — Classement ${input.seasonName} (suite)`), MARGIN, y - 10, bold, 11, GREEN);
      y -= 34;
    }
    // En-tête du tableau
    page.drawRectangle({ x: left, y: y - 6, width: tableWidth, height: rowH, color: GREEN });
    let x = left;
    for (const [label, w, align] of COLUMNS) {
      const tw = bold.widthOfTextAtSize(label, 9);
      const tx = align === "left" ? x + 8 : align === "center" ? x + (w - tw) / 2 : x + w - tw - 8;
      text(page, label, tx, y + 1, bold, 9, rgb(1, 1, 1));
      x += w;
    }
    return y - rowH;
  };

  let page = doc.addPage(A4);
  pages.push(page);
  let y = drawHeader(page, true);

  if (input.rows.length === 0) {
    text(page, "Aucun résultat pour cette saison.", left + 8, y - 4, regular, 11, GREY);
  }

  input.rows.forEach((row, i) => {
    if (y < MARGIN + 90) {
      page = doc.addPage(A4);
      pages.push(page);
      y = drawHeader(page, false);
    }
    if (i % 2 === 0) {
      page.drawRectangle({ x: left, y: y - 6, width: tableWidth, height: rowH, color: GREEN_LIGHT });
    }
    const podium = row.rank <= 3;
    const values: string[] = [
      String(row.rank),
      fitText(sanitize(row.display_name), podium ? bold : regular, 10, COLUMNS[1][1] - 12),
      String(row.matches_counted),
      String(row.late_count),
      String(row.gross_points),
      row.penalty_points > 0 ? `-${row.penalty_points}` : "0",
      String(row.net_points),
    ];
    let x = left;
    COLUMNS.forEach(([, w, align], c) => {
      const isNet = c === 6;
      const font = isNet || podium ? bold : regular;
      const size = isNet ? 11 : 10;
      const color = c === 5 && row.penalty_points > 0 ? RED : isNet ? GREEN : INK;
      const tw = font.widthOfTextAtSize(values[c], size);
      const tx = align === "left" ? x + 8 : align === "center" ? x + (w - tw) / 2 : x + w - tw - 8;
      text(page, values[c], tx, y + 1, font, size, color);
      x += w;
    });
    y -= rowH;
  });

  // Légende sur la dernière page
  const legend = [
    "Barème : 1er choix = 3 points, 2e choix = 2 points, 3e choix = 1 point.",
    "Points nets = points bruts reçus - malus cumulés (jamais inférieurs à 0).",
    "Départage : points nets, puis points bruts ; égalité conservée ensuite.",
    sanitize(input.penaltyNote),
  ];
  let ly = Math.max(y - 24, MARGIN + 50);
  for (const line of legend) {
    text(page, sanitize(line), left, ly, regular, 8.5, GREY);
    ly -= 12;
  }

  pages.forEach((p, idx) => {
    const label = `Page ${idx + 1} / ${pages.length}`;
    text(p, label, A4[0] - MARGIN - regular.widthOfTextAtSize(label, 8), 22, regular, 8, GREY);
    text(p, sanitize(`${input.teamName} — document confidentiel d'équipe`), MARGIN, 22, regular, 8, GREY);
  });

  return doc.save();
}
