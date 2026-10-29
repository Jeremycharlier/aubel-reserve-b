// Lecture d'un calendrier (CSV ou Excel) et conversion en matchs.
// Toutes les heures sont des heures locales belges, manipulées « à
// l'horloge murale » ; la base les convertit en instants absolus.

export const TEMPLATE_HEADERS = [
  "date",
  "heure",
  "adversaire",
  "lieu",
  "classement",
  "ouverture_vote",
  "heure_limite",
  "fermeture_vote",
] as const;

export const TEMPLATE_EXAMPLE: string[][] = [
  ["08/11/2026", "15:00", "FC Herve C", "Herve", "oui", "", "", ""],
  ["15/11/2026", "14:30", "RFC Warsage B", "Aubel", "oui", "15/11/2026 17:00", "17/11/2026 20:00", "18/11/2026 20:00"],
  ["22/11/2026", "15:00", "Battice FC B (amical)", "Battice", "non", "", "", ""],
];

export type ImportDefaults = {
  /** Heures après le coup d'envoi ; null = ouverture/fermeture manuelle */
  opensAfterHours: number | null;
  deadlineAfterHours: number;
  closesAfterHours: number | null;
};

export type ImportedMatch = {
  line: number;
  opponent: string;
  kickoff: string; // YYYY-MM-DDTHH:MM:00
  location: string | null;
  opens: string | null;
  deadline: string;
  closes: string | null;
  counts: boolean;
};

export type ImportResult = { matches: ImportedMatch[]; errors: { line: number; message: string }[] };

type Local = { y: number; m: number; d: number; h: number; min: number };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");

const ALIASES: Record<string, (typeof TEMPLATE_HEADERS)[number]> = {
  date: "date",
  jour: "date",
  date_du_match: "date",
  heure: "heure",
  heure_du_match: "heure",
  coup_d_envoi: "heure",
  adversaire: "adversaire",
  equipe_adverse: "adversaire",
  contre: "adversaire",
  lieu: "lieu",
  terrain: "lieu",
  classement: "classement",
  compte_au_classement: "classement",
  ouverture_vote: "ouverture_vote",
  ouverture_du_vote: "ouverture_vote",
  ouverture: "ouverture_vote",
  heure_limite: "heure_limite",
  limite: "heure_limite",
  heure_limite_vote: "heure_limite",
  fermeture_vote: "fermeture_vote",
  fermeture_du_vote: "fermeture_vote",
  fermeture: "fermeture_vote",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatLocal(l: Local): string {
  return `${l.y}-${pad(l.m)}-${pad(l.d)}T${pad(l.h)}:${pad(l.min)}:00`;
}

function valid(l: Local): boolean {
  const dt = new Date(Date.UTC(l.y, l.m - 1, l.d, l.h, l.min));
  return (
    l.y >= 2000 && l.y <= 2100 &&
    dt.getUTCFullYear() === l.y && dt.getUTCMonth() === l.m - 1 && dt.getUTCDate() === l.d &&
    l.h >= 0 && l.h <= 23 && l.min >= 0 && l.min <= 59
  );
}

export function addHours(l: Local, hours: number): Local {
  const dt = new Date(Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) + hours * 3_600_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), min: dt.getUTCMinutes() };
}

/** "08/11/2026", "8/11/26", "2026-11-08", "08.11.2026" → {y,m,d} */
export function parseDate(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/);
  if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[2], d: +m[1] };
  return null;
}

/** "15:00", "15h", "15h30", "15:00:00" → {h,min} */
export function parseTime(raw: string): { h: number; min: number } | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?(?::\d{2})?$/);
  if (!m) return null;
  return { h: +m[1], min: m[2] ? +m[2] : 0 };
}

/** "15/11/2026 17:00" ou "2026-11-15T17:00" */
export function parseDateTime(raw: string): Local | null {
  const s = raw.trim();
  const d = parseDate(s);
  if (!d) return null;
  const rest = s.replace(/^\S+?(?:[ T]|$)/, "").trim();
  const t = rest ? parseTime(rest) : null;
  if (rest && !t) return null;
  const l = { ...d, h: t?.h ?? 0, min: t?.min ?? 0 };
  return valid(l) ? l : null;
}

function yes(raw: string): boolean | null {
  const v = norm(raw);
  if (v === "" ) return true;
  if (["oui", "o", "yes", "y", "1", "vrai", "true", "x"].includes(v)) return true;
  if (["non", "n", "no", "0", "faux", "false"].includes(v)) return false;
  return null;
}

/** Convertit un tableau (1re ligne = en-têtes) en matchs, avec erreurs par ligne. */
export function rowsToMatches(table: string[][], defaults: ImportDefaults): ImportResult {
  const errors: ImportResult["errors"] = [];
  const matches: ImportedMatch[] = [];
  if (table.length === 0) return { matches, errors: [{ line: 1, message: "Fichier vide." }] };

  const header = table[0].map((h) => ALIASES[norm(h)] ?? null);
  const col = (name: (typeof TEMPLATE_HEADERS)[number]) => header.indexOf(name);
  for (const required of ["date", "adversaire"] as const) {
    if (col(required) < 0) {
      errors.push({ line: 1, message: `Colonne « ${required} » introuvable. Utilisez le modèle fourni.` });
    }
  }
  if (errors.length) return { matches, errors };

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (name: (typeof TEMPLATE_HEADERS)[number]) => {
      const c = col(name);
      return c >= 0 ? String(cells[c] ?? "").trim() : "";
    };
    if (cells.every((c) => String(c ?? "").trim() === "")) return;

    const opponent = get("adversaire");
    if (!opponent) return errors.push({ line, message: "Adversaire manquant." });
    if (opponent.length > 80) return errors.push({ line, message: "Nom d'adversaire trop long (80 caractères max.)." });

    const dateRaw = get("date");
    const date = parseDate(dateRaw);
    if (!date) return errors.push({ line, message: `Date illisible : « ${dateRaw} » (format attendu JJ/MM/AAAA).` });
    const timeRaw = get("heure");
    const inline = parseDateTime(dateRaw);
    const time = timeRaw ? parseTime(timeRaw) : inline && (inline.h || inline.min) ? { h: inline.h, min: inline.min } : null;
    if (!time) return errors.push({ line, message: timeRaw ? `Heure illisible : « ${timeRaw} » (format HH:MM).` : "Heure du match manquante." });
    const kickoff: Local = { ...date, ...time };
    if (!valid(kickoff)) return errors.push({ line, message: "Date ou heure impossible." });

    const opt = (name: "ouverture_vote" | "heure_limite" | "fermeture_vote") => {
      const raw = get(name);
      if (!raw) return { value: null as Local | null, error: null as string | null };
      const v = parseDateTime(raw);
      return v ? { value: v, error: null } : { value: null, error: `« ${name.replace("_", " ")} » illisible : « ${raw} » (JJ/MM/AAAA HH:MM).` };
    };
    const o = opt("ouverture_vote");
    const dl = opt("heure_limite");
    const cl = opt("fermeture_vote");
    const optError = o.error ?? dl.error ?? cl.error;
    if (optError) return errors.push({ line, message: optError });

    const opens = o.value ?? (defaults.opensAfterHours === null ? null : addHours(kickoff, defaults.opensAfterHours));
    const deadline = dl.value ?? addHours(kickoff, defaults.deadlineAfterHours);
    const closes = cl.value ?? (defaults.closesAfterHours === null ? null : addHours(kickoff, defaults.closesAfterHours));
    const toNum = (l: Local) => Date.UTC(l.y, l.m - 1, l.d, l.h, l.min);
    if (opens && closes && toNum(closes) <= toNum(opens)) {
      return errors.push({ line, message: "La fermeture du vote doit être après son ouverture." });
    }

    const counts = yes(get("classement"));
    if (counts === null) return errors.push({ line, message: "Colonne classement : indiquez oui ou non." });

    matches.push({
      line,
      opponent,
      kickoff: formatLocal(kickoff),
      location: get("lieu") || null,
      opens: opens ? formatLocal(opens) : null,
      deadline: formatLocal(deadline),
      closes: closes ? formatLocal(closes) : null,
      counts,
    });
  });

  if (matches.length + errors.length === 0) errors.push({ line: 2, message: "Aucun match trouvé sous la ligne d'en-têtes." });
  if (matches.length > 200) errors.push({ line: 1, message: "200 matchs maximum par import." });
  return { matches, errors };
}
