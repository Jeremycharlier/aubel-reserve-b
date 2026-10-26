import { fmtDateTime } from "@/lib/time";
import { StateBadge } from "@/components/ui";
import type { MatchRow } from "@/lib/data";

/** Bloc date en « affiche de match » : jour en gros chiffres condensés. */
export function MatchDate({ iso }: { iso: string }) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", day: "numeric" }).format(d);
  const month = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", month: "short" }).format(d);
  return (
    <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-pitch py-1.5 text-chalk">
      <span className="num font-display text-2xl font-bold leading-none">{day}</span>
      <span className="text-xs font-semibold text-chalk/80">{month.replace(".", "")}</span>
    </div>
  );
}

export function MatchHeading({ match }: { match: Pick<MatchRow, "opponent" | "kickoff_at" | "location" | "effective_state"> }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <MatchDate iso={match.kickoff_at} />
      <div className="min-w-0">
        <p className="truncate font-display text-xl font-semibold leading-tight">Aubel B – {match.opponent}</p>
        <p className="text-sm text-muted">
          {fmtDateTime(match.kickoff_at)}
          {match.location ? `, ${match.location}` : ""}
        </p>
        <div className="mt-1.5">
          <StateBadge state={match.effective_state} />
        </div>
      </div>
    </div>
  );
}
