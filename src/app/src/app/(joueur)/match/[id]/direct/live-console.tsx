"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { Button, Notice, cx } from "@/components/ui";
import { BallIcon, CardIcon } from "@/components/stats";
import { Timeline, type MatchEvent } from "@/components/timeline";
import { clockText, currentMinute, LIVE_LABEL, minuteLabel, type LiveTimes } from "@/lib/live";
import { addEventAction, deleteEventAction, liveControlAction, updateEventMinuteAction } from "../actions";

type Squad = { id: string; name: string; number: number | null; role: string }[];
type Kind = "but" | "but_adverse" | "jaune" | "rouge";

type Props = {
  match: LiveTimes & {
    id: string;
    opponent: string;
    club: string;
    isHome: boolean;
    scoreFor: number | null;
    scoreAgainst: number | null;
  };
  squad: Squad;
  events: MatchEvent[];
  names: Record<string, string>;
};

const KIND_TITLE: Record<Kind, string> = {
  but: "But",
  but_adverse: "But adverse",
  jaune: "Carton jaune",
  rouge: "Carton rouge",
};

export function LiveConsole({ match, squad, events, names }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<{ kind: Kind; player: string | null; assist: string | null; minute: string } | null>(null);

  const status = match.live_status;
  const running = status === "premiere" || status === "seconde" || status === "mi_temps";

  // Chrono local (1 s) + resynchronisation serveur pour plusieurs appareils
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sync = setInterval(() => {
      if (document.visibilityState === "visible" && !draft) router.refresh();
    }, 15000);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [router, draft]);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.message });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const control = (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    run(() => liveControlAction(match.id, action));
  };

  const open = (kind: Kind) => {
    const cm = currentMinute(match, now);
    setDraft({ kind, player: null, assist: null, minute: cm ? String(cm.minute) : "" });
    setMessage(null);
  };

  const save = () => {
    if (!draft) return;
    const minute = draft.minute.trim() === "" ? null : Number(draft.minute);
    run(
      () => addEventAction(match.id, draft.kind, draft.kind === "but_adverse" ? null : draft.player, draft.kind === "but" ? draft.assist : null, minute),
      () => setDraft(null),
    );
  };

  const nameOf = (id: string | null) => (id ? names[id] ?? "Joueur" : "Joueur");
  const homeScore = match.isHome ? match.scoreFor : match.scoreAgainst;
  const awayScore = match.isHome ? match.scoreAgainst : match.scoreFor;
  const home = match.isHome ? match.club : match.opponent;
  const away = match.isHome ? match.opponent : match.club;
  const needsPlayer = draft && draft.kind !== "but_adverse";
  const canSave = draft && (!needsPlayer || draft.kind === "but" || draft.player);

  return (
    <div className="space-y-4">
      {/* Tableau d'affichage */}
      <section className="rounded-2xl bg-pitch px-4 py-5 text-center text-chalk" aria-live="polite">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="truncate font-display text-lg font-semibold">{home}</span>
          <span className="num font-display text-5xl font-bold">
            {homeScore ?? 0} – {awayScore ?? 0}
          </span>
          <span className="truncate font-display text-lg font-semibold">{away}</span>
        </div>
        <p className="num mt-2 font-display text-2xl font-bold text-gold">{status ? clockText(match, now) : "Avant-match"}</p>
        <p className="text-sm text-chalk/80">{status ? LIVE_LABEL[status] : "Démarrez le chrono au coup d'envoi, ou encodez les faits en indiquant la minute."}</p>
      </section>

      {/* Commandes du chrono */}
      <div className="flex flex-wrap gap-2">
        {status === null ? (
          <Button onClick={() => control("start")} disabled={pending} className="flex-1">
            <Play size={18} aria-hidden /> Coup d&apos;envoi
          </Button>
        ) : null}
        {status === "premiere" ? (
          <Button onClick={() => control("halftime")} disabled={pending} variant="secondary" className="flex-1">
            <Pause size={18} aria-hidden /> Mi-temps
          </Button>
        ) : null}
        {status === "mi_temps" ? (
          <Button onClick={() => control("second_half")} disabled={pending} className="flex-1">
            <Play size={18} aria-hidden /> Début 2e mi-temps
          </Button>
        ) : null}
        {running ? (
          <Button onClick={() => control("end", "Siffler la fin du match ?")} disabled={pending} variant="danger" className="flex-1">
            <Square size={18} aria-hidden /> Fin du match
          </Button>
        ) : null}
        {status === "termine" ? (
          <Button onClick={() => control("resume", "Reprendre la 2e mi-temps (fin sifflée par erreur) ?")} disabled={pending} variant="ghost">
            <RotateCcw size={18} aria-hidden /> Reprendre
          </Button>
        ) : null}
        {status && events.length === 0 ? (
          <Button onClick={() => control("reset", "Remettre le chrono à zéro ?")} disabled={pending} variant="ghost">
            Annuler le démarrage
          </Button>
        ) : null}
      </div>

      {/* Boutons de faits de match */}
      {!draft ? (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["but", <BallIcon key="b" size={26} className="text-ink" />, `But ${match.club}`],
              ["but_adverse", <BallIcon key="a" size={26} className="text-late" />, `But ${match.opponent}`],
              ["jaune", <CardIcon key="j" color="yellow" size={26} />, "Carton jaune"],
              ["rouge", <CardIcon key="r" color="red" size={26} />, "Carton rouge"],
            ] as [Kind, React.ReactNode, string][]
          ).map(([kind, icon, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => open(kind)}
              className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl bg-chalk px-2 font-semibold ring-1 ring-line active:ring-pitch"
            >
              {icon}
              <span className="line-clamp-1 text-sm">{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <section className="space-y-3 rounded-2xl bg-chalk p-4 ring-2 ring-pitch" aria-label={KIND_TITLE[draft.kind]}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">{KIND_TITLE[draft.kind]}</h2>
            <button type="button" onClick={() => setDraft(null)} className="flex h-10 w-10 items-center justify-center rounded-full bg-turf" aria-label="Annuler">
              <X size={18} aria-hidden />
            </button>
          </div>

          {needsPlayer ? (
            <div>
              <p className="mb-2 text-sm font-semibold">{draft.kind === "but" ? "Buteur" : "Joueur"}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {squad.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, player: p.id, assist: draft.assist === p.id ? null : draft.assist })}
                    className={cx(
                      "flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold",
                      draft.player === p.id ? "bg-pitch text-chalk" : "bg-turf",
                    )}
                  >
                    <span className="num w-6 shrink-0 text-center opacity-70">{p.number ?? ""}</span>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
                {draft.kind === "but" ? (
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, player: null })}
                    className={cx("min-h-11 rounded-lg px-2 text-sm font-semibold", draft.player === null ? "bg-pitch text-chalk" : "bg-turf")}
                  >
                    Buteur inconnu
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {draft.kind === "but" ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Passe décisive (facultatif)</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, assist: null })}
                  className={cx("min-h-11 rounded-lg px-2 text-sm font-semibold", draft.assist === null ? "bg-gold text-ink" : "bg-turf")}
                >
                  Pas de passe
                </button>
                {squad
                  .filter((p) => p.id !== draft.player)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, assist: p.id })}
                      className={cx(
                        "flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold",
                        draft.assist === p.id ? "bg-gold text-ink" : "bg-turf",
                      )}
                    >
                      <span className="num w-6 shrink-0 text-center opacity-70">{p.number ?? ""}</span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-3">
            <span className="text-sm font-semibold">Minute</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={150}
              value={draft.minute}
              onChange={(e) => setDraft({ ...draft, minute: e.target.value })}
              placeholder="ex. 23"
              className="num min-h-12 w-24 rounded-lg border border-line bg-white px-3 text-lg"
            />
            <span className="text-xs text-muted">{status && running ? "pré-remplie par le chrono" : "à indiquer"}</span>
          </label>

          <Button onClick={save} disabled={!canSave || pending} className="w-full">
            <Flag size={18} aria-hidden /> {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </section>
      )}

      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}

      <section className="rounded-2xl bg-chalk p-4">
        <h2 className="mb-3 font-display text-xl font-semibold">Faits du match</h2>
        <Timeline
          events={events}
          nameOf={nameOf}
          isHome={match.isHome}
          opponent={match.opponent}
          action={(e) => (
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="min-h-10 rounded-md px-2 text-xs font-semibold text-pitch"
                onClick={() => {
                  const v = window.prompt("Minute (vide = inconnue)", e.minute === null ? "" : String(e.minute));
                  if (v === null) return;
                  const n = v.trim() === "" ? null : Number(v);
                  run(() => updateEventMinuteAction(e.id, match.id, n));
                }}
                aria-label={`Corriger la minute (${minuteLabel(e.minute, e.period) || "inconnue"})`}
              >
                Minute
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-md text-late"
                onClick={() => {
                  if (window.confirm("Supprimer ce fait de match ?")) run(() => deleteEventAction(e.id, match.id));
                }}
                aria-label="Supprimer"
              >
                <X size={18} aria-hidden />
              </button>
            </span>
          )}
        />
      </section>
    </div>
  );
}
