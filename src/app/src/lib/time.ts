// Affichage des dates en heure de Bruxelles, quel que soit le fuseau
// du serveur (Vercel tourne en UTC) ou de l'appareil du joueur.
export const TZ = "Europe/Brussels";

const dateTimeFmt = new Intl.DateTimeFormat("fr-BE", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const longFmt = new Intl.DateTimeFormat("fr-BE", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const preciseFmt = new Intl.DateTimeFormat("fr-BE", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}
export function fmtLong(iso: string | null | undefined): string {
  return iso ? longFmt.format(new Date(iso)) : "—";
}
export function fmtPrecise(iso: string | null | undefined): string {
  return iso ? preciseFmt.format(new Date(iso)) : "—";
}

/**
 * Convertit un instant ISO en valeur pour <input type="datetime-local">
 * exprimée en heure de Bruxelles ("YYYY-MM-DDTHH:mm").
 */
export function toBrusselsInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Valide une saisie "YYYY-MM-DDTHH:mm" ; la conversion en UTC est faite par la base. */
export function parseLocalInput(value: FormDataEntryValue | null): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new Error("INVALID_DATE");
  return `${v}:00`;
}

/** Durée restante lisible ("dans 2 h 15", "dans 3 jours"). */
export function timeUntil(iso: string, now = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  let label: string;
  if (min < 60) label = `${min} min`;
  else if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    label = m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  } else label = `${Math.round(min / 1440)} jours`;
  return diff >= 0 ? `dans ${label}` : `il y a ${label}`;
}
