import type { ReactNode } from "react";
import { minuteLabel } from "@/lib/live";
import { BallIcon, CardIcon, AssistIcon } from "@/components/stats";
import { cx } from "@/components/ui";

export type MatchEvent = {
  id: string;
  kind: "but" | "but_adverse" | "jaune" | "rouge" | "passe";
  player_id: string | null;
  assist_player_id: string | null;
  minute: number | null;
  period: number | null;
  created_at: string;
};

export function sortEvents<T extends MatchEvent>(events: T[]): T[] {
  return [...events].sort(
    (a, b) =>
      (a.period ?? 3) - (b.period ?? 3) ||
      (a.minute ?? 999) - (b.minute ?? 999) ||
      a.created_at.localeCompare(b.created_at),
  );
}

const KIND_LABEL: Record<MatchEvent["kind"], string> = {
  but: "But",
  but_adverse: "But adverse",
  jaune: "Carton jaune",
  rouge: "Carton rouge",
  passe: "Passe décisive",
};

function Icon({ kind }: { kind: MatchEvent["kind"] }) {
  if (kind === "jaune") return <CardIcon color="yellow" size={18} />;
  if (kind === "rouge") return <CardIcon color="red" size={18} />;
  if (kind === "passe") return <AssistIcon size={18} className="text-pitch" />;
  return <BallIcon size={18} className={kind === "but_adverse" ? "text-late" : "text-ink"} />;
}

/**
 * Déroulé du match. Les faits de l'équipe adverse sont alignés du côté de
 * l'adversaire (gauche si l'adversaire reçoit, droite sinon).
 */
export function Timeline({
  events,
  nameOf,
  isHome,
  opponent,
  action,
}: {
  events: MatchEvent[];
  nameOf: (id: string | null) => string;
  isHome: boolean;
  opponent: string;
  action?: (e: MatchEvent) => ReactNode;
}) {
  if (events.length === 0) return <p className="text-sm text-muted">Aucun fait de match pour l&apos;instant.</p>;
  return (
    <ol className="space-y-1.5">
      {sortEvents(events).map((e) => {
        const adverse = e.kind === "but_adverse";
        const rightSide = adverse === isHome; // côté visiteur à droite
        return (
          <li key={e.id} className={cx("flex items-center gap-2", rightSide && "flex-row-reverse text-right")}>
            <span className="num w-12 shrink-0 text-center font-display font-bold text-muted">{minuteLabel(e.minute, e.period)}</span>
            <span className="shrink-0">
              <Icon kind={e.kind} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{adverse ? opponent : e.player_id ? nameOf(e.player_id) : "Buteur non précisé"}</span>
              <span className="sr-only"> : {KIND_LABEL[e.kind]}</span>
              {e.assist_player_id ? (
                <span className="block text-xs text-muted">passe de {nameOf(e.assist_player_id)}</span>
              ) : null}
            </span>
            {action ? action(e) : null}
          </li>
        );
      })}
    </ol>
  );
}
