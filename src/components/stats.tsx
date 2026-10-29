import { CornerDownRight } from "lucide-react";
import { cx } from "@/components/ui";

/** Ballon simple (buts). */
export function BallIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="12" cy="12" r="10" fill="white" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.2l4 2.9-1.5 4.7h-5L8 10.1z" fill="currentColor" />
      <path
        d="M12 7.2V2.5M16 10.1l4.4-1.6M14.5 14.8l2.8 3.9M9.5 14.8l-2.8 3.9M8 10.1L3.6 8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
      />
    </svg>
  );
}

export function AssistIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <CornerDownRight size={size} strokeWidth={2.4} aria-hidden className={className} />;
}

/** Carton (jaune ou rouge), légèrement incliné comme brandi par l'arbitre. */
export function CardIcon({ color, size = 16 }: { color: "yellow" | "red"; size?: number }) {
  return (
    <svg width={size * 0.75} height={size} viewBox="0 0 12 16" aria-hidden>
      <rect
        x="1.5"
        y="1"
        width="9"
        height="13"
        rx="1.5"
        transform="rotate(8 6 8)"
        fill={color === "yellow" ? "#f2c230" : "#d1352b"}
        stroke="rgba(0,0,0,.25)"
      />
    </svg>
  );
}

type Line = { goals: number; assists: number; yellow_cards: number; red_cards: number };

/** Petites pastilles icône + nombre ; masque les compteurs à zéro sauf si showZero. */
export function StatPills({ s, showZero = false, className }: { s: Line; showZero?: boolean; className?: string }) {
  const items = [
    { n: s.goals, label: "but", plural: "buts", icon: <BallIcon size={15} className="text-ink" /> },
    { n: s.assists, label: "passe décisive", plural: "passes décisives", icon: <AssistIcon size={15} className="text-pitch" /> },
    { n: s.yellow_cards, label: "carton jaune", plural: "cartons jaunes", icon: <CardIcon color="yellow" size={15} /> },
    { n: s.red_cards, label: "carton rouge", plural: "cartons rouges", icon: <CardIcon color="red" size={15} /> },
  ].filter((i) => showZero || i.n > 0);
  if (items.length === 0) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1.5", className)}>
      {items.map((i) => (
        <span
          key={i.label}
          className={cx(
            "num inline-flex items-center gap-1 rounded-full bg-turf px-2 py-0.5 text-sm font-semibold",
            i.n === 0 && "text-muted opacity-60",
          )}
          title={`${i.n} ${i.n > 1 ? i.plural : i.label}`}
        >
          {i.icon}
          {i.n}
          <span className="sr-only">{i.n > 1 ? i.plural : i.label}</span>
        </span>
      ))}
    </span>
  );
}

export function RoleTag({ role }: { role: "joueur" | "delegue" | "supporter" }) {
  if (role === "joueur") return null;
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        role === "delegue" ? "bg-pitch-soft text-pitch-dark" : "bg-warn-soft text-warn",
      )}
    >
      {role === "delegue" ? "Délégué" : "Supporter"}
    </span>
  );
}
