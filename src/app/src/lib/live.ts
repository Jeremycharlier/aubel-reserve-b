// Calculs du chrono et affichage des minutes (partagés client / serveur).

export type LiveTimes = {
  live_status: "premiere" | "mi_temps" | "seconde" | "termine" | null;
  live_started_at: string | null;
  second_half_started_at: string | null;
};

/** Minute en cours (convention football : 1re minute = 1'). */
export function currentMinute(m: LiveTimes, now = Date.now()): { minute: number; period: 1 | 2 } | null {
  if (m.live_status === "premiere" && m.live_started_at) {
    return { minute: Math.floor((now - Date.parse(m.live_started_at)) / 60000) + 1, period: 1 };
  }
  if (m.live_status === "seconde" && m.second_half_started_at) {
    return { minute: 45 + Math.floor((now - Date.parse(m.second_half_started_at)) / 60000) + 1, period: 2 };
  }
  if (m.live_status === "mi_temps") return { minute: 45, period: 1 };
  return null;
}

/** 47e minute de la 1re mi-temps → « 45+2' » ; 92e → « 90+2' ». */
export function minuteLabel(minute: number | null, period: number | null): string {
  if (minute === null) return "";
  if (period === 1 && minute > 45) return `45+${minute - 45}'`;
  if (minute > 90) return `90+${minute - 90}'`;
  return `${minute}'`;
}

/** Chrono mm:ss de la mi-temps en cours. */
export function clockText(m: LiveTimes, now = Date.now()): string {
  const start =
    m.live_status === "premiere" ? m.live_started_at : m.live_status === "seconde" ? m.second_half_started_at : null;
  if (!start) return m.live_status === "mi_temps" ? "Mi-temps" : m.live_status === "termine" ? "Terminé" : "";
  const elapsed = Math.max(0, Math.floor((now - Date.parse(start)) / 1000)) + (m.live_status === "seconde" ? 45 * 60 : 0);
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export const LIVE_LABEL: Record<NonNullable<LiveTimes["live_status"]>, string> = {
  premiere: "1re mi-temps",
  mi_temps: "Mi-temps",
  seconde: "2e mi-temps",
  termine: "Terminé",
};
