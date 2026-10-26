import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_STYLES = {
  primary: "bg-pitch text-chalk hover:bg-pitch-dark disabled:bg-line disabled:text-muted",
  secondary: "bg-chalk text-pitch ring-1 ring-inset ring-line hover:ring-pitch disabled:text-muted",
  danger: "bg-late text-chalk hover:brightness-95 disabled:bg-line disabled:text-muted",
  ghost: "text-pitch hover:bg-pitch-soft disabled:text-muted",
} as const;

export type ButtonVariant = keyof typeof BUTTON_STYLES;

export function buttonClass(variant: ButtonVariant = "primary", extra?: string) {
  return cx(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 font-semibold transition-colors disabled:cursor-not-allowed",
    BUTTON_STYLES[variant],
    extra,
  );
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold leading-tight text-pitch sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl bg-chalk p-4 shadow-[0_1px_0_var(--color-line)] sm:p-5", className)}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-xl font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-line px-5 py-8 text-center">
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {children ? <div className="mt-2 text-muted">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error" | "warn"; children: ReactNode }) {
  const styles = {
    info: "bg-pitch-soft text-pitch-dark",
    success: "bg-pitch text-chalk",
    error: "bg-late-soft text-late",
    warn: "bg-warn-soft text-warn",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg px-4 py-3 text-sm font-medium", styles)}>
      {children}
    </div>
  );
}

export type VoteState = "a_venir" | "ouvert" | "ferme";

export function StateBadge({ state }: { state: VoteState }) {
  const map = {
    a_venir: { label: "Vote à venir", cls: "bg-turf text-muted ring-1 ring-inset ring-line" },
    ouvert: { label: "Vote ouvert", cls: "bg-pitch text-chalk" },
    ferme: { label: "Vote fermé", cls: "bg-ink/80 text-chalk" },
  }[state];
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", map.cls)}>{map.label}</span>;
}

export function Tag({ tone, children }: { tone: "late" | "ok" | "muted" | "warn"; children: ReactNode }) {
  const cls = {
    late: "bg-late-soft text-late",
    ok: "bg-pitch-soft text-pitch-dark",
    muted: "bg-turf text-muted",
    warn: "bg-warn-soft text-warn",
  }[tone];
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", cls)}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "block min-h-12 w-full rounded-lg border border-line bg-white px-3 text-base text-ink placeholder:text-muted/70 focus:border-pitch focus:outline-none focus:ring-2 focus:ring-pitch/30";

/** Podium des trois choix : or, argent, bronze. */
export const RANK_STYLES = [
  { bg: "bg-gold", ring: "ring-gold", text: "text-ink", label: "1er choix" },
  { bg: "bg-silver", ring: "ring-silver", text: "text-ink", label: "2e choix" },
  { bg: "bg-bronze", ring: "ring-bronze", text: "text-chalk", label: "3e choix" },
] as const;
