import { fmtDateTime } from "@/lib/time";
import { StateBadge } from "@/components/ui";
import { matchTitle, scoreText, type MatchRow } from "@/lib/data";

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

export function LiveBadge({ status }: { status: MatchRow["live_status"] }) {
  if (status === "premiere" || status === "seconde" || status === "mi_temps") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-late px-2.5 py-0.5 text-xs font-bold text-chalk">
        <span className="h-2 w-2 animate-pulse rounded-full bg-chalk" aria-hidden />
        {status === "mi_temps" ? "Mi-temps" : "En direct"}
      </span>
    );
  }
  return null;
}

type HeadingMatch = Pick<MatchRow, "opponent" | "kickoff_at" | "location" | "effective_state"> &
  Partial<Pick<MatchRow, "score_for" | "score_against" | "is_home" | "club_name" | "live_status">>;

export function MatchHeading({ match }: { match: HeadingMatch }) {
  const score = scoreText({ score_for: match.score_for ?? null, score_against: match.score_against ?? null, is_home: match.is_home ?? true });
  return (
    <div className="flex min-w-0 items-start gap-3">
      <MatchDate iso={match.kickoff_at} />
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold leading-tight">
          {matchTitle({ opponent: match.opponent, is_home: match.is_home ?? true, club_name: match.club_name })}
          {score ? (
            <span className="num ml-2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-base text-chalk">{score}</span>
          ) : null}
        </p>
        <p className="text-sm text-muted">
          {fmtDateTime(match.kickoff_at)}
          {match.location ? `, ${match.location}` : ""}
          {match.is_home === false ? " (extérieur)" : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <LiveBadge status={match.live_status ?? null} />
          <StateBadge state={match.effective_state} />
        </div>
      </div>
    </div>
  );
}
