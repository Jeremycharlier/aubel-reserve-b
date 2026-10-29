import "server-only";
import ExcelJS from "exceljs";

const pad = (n: number) => String(n).padStart(2, "0");

/** Valeur de cellule Excel → texte (dates au format JJ/MM/AAAA HH:MM). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Excel stocke l'heure « murale » : exceljs la renvoie comme une date UTC.
    const hh = value.getUTCHours();
    const mm = value.getUTCMinutes();
    if (value.getUTCFullYear() <= 1900) return `${pad(hh)}:${pad(mm)}`; // heure seule
    const date = `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
    return hh || mm ? `${date} ${pad(hh)}:${pad(mm)}` : date;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value);
}

/** Première feuille d'un classeur .xlsx → tableau de textes. */
export async function readFirstSheet(buffer: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, 8); c++) cells.push(cellText(row.getCell(c).value).trim());
    rows.push(cells);
  });
  return rows.slice(0, 501);
}

/** Classeur modèle à télécharger. */
export async function buildTemplate(headers: readonly string[], example: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Calendrier");
  ws.addRow([...headers]);
  example.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E4D2F" } };
  ws.columns.forEach((c, i) => {
    c.width = [12, 8, 26, 14, 11, 18, 18, 18][i] ?? 14;
    c.numFmt = "@"; // texte : Excel ne transforme pas les dates
  });
  const help = wb.addWorksheet("Mode d'emploi");
  [
    ["Colonne", "Obligatoire", "Format", "Exemple"],
    ["date", "oui", "JJ/MM/AAAA", "08/11/2026"],
    ["heure", "oui", "HH:MM (heure belge)", "15:00"],
    ["adversaire", "oui", "texte", "FC Herve C"],
    ["lieu", "non", "texte", "Aubel"],
    ["classement", "non (oui par défaut)", "oui / non", "non pour un amical"],
    ["ouverture_vote", "non", "JJ/MM/AAAA HH:MM", "vide = règle choisie à l'import"],
    ["heure_limite", "non", "JJ/MM/AAAA HH:MM", "vide = règle choisie à l'import"],
    ["fermeture_vote", "non", "JJ/MM/AAAA HH:MM", "vide = règle choisie à l'import"],
  ].forEach((r) => help.addRow(r));
  help.getRow(1).font = { bold: true };
  help.columns.forEach((c) => (c.width = 26));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
