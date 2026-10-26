"use client";

import { useReducer, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, RotateCcw, X } from "lucide-react";
import { Button, Notice, RANK_STYLES, buttonClass, cx } from "@/components/ui";
import { isSelectionComplete, MAX_PICKS, pointsForRank, selectionReducer } from "@/lib/vote-selection";
import { fmtPrecise } from "@/lib/time";
import { submitBallotAction, type BallotReceipt } from "./actions";

export type Teammate = { id: string; name: string; number: number | null };

function Jersey({ number, className }: { number: number | null; className?: string }) {
  return (
    <span
      className={cx(
        "num flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold",
        className,
      )}
      aria-hidden
    >
      {number ?? "–"}
    </span>
  );
}

export function VoteForm({
  matchId,
  teammates,
  initial,
  alreadyVoted,
}: {
  matchId: string;
  teammates: Teammate[];
  initial: string[];
  alreadyVoted: boolean;
}) {
  const [selection, dispatch] = useReducer(selectionReducer, initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<BallotReceipt | null>(null);
  const byId = new Map(teammates.map((t) => [t.id, t]));
  const complete = isSelectionComplete(selection);
  const unchanged = alreadyVoted && initial.join() === selection.join();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitBallotAction(matchId, selection);
      if (res.ok && res.data) setReceipt(res.data);
      else setError(res.message);
    });
  }

  if (receipt) {
    return (
      <div className="rounded-2xl bg-pitch px-5 py-8 text-center text-chalk">
        <div className="stamp mx-auto inline-flex items-center gap-2 rounded-lg border-4 border-gold px-5 py-2 font-display text-3xl font-bold text-gold">
          <Check size={30} strokeWidth={3} aria-hidden /> {receipt.version > 1 ? "Vote modifié" : "Vote validé"}
        </div>
        <ol className="mx-auto mt-6 max-w-xs space-y-2 text-left">
          {selection.map((id, i) => (
            <li key={id} className="flex items-center gap-3">
              <span className={cx("num flex h-8 w-8 items-center justify-center rounded-full font-bold", RANK_STYLES[i].bg, RANK_STYLES[i].text)}>
                {pointsForRank(i)}
              </span>
              <span className="font-semibold">{byId.get(id)?.name}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm text-chalk/80">Reçu par le serveur le {fmtPrecise(receipt.last_modified_at)}</p>
        <p className="mt-1 text-sm font-semibold">
          {receipt.is_late ? "Bulletin enregistré en retard." : "Bulletin enregistré à temps."}
        </p>
        <p className="mt-1 text-sm text-chalk/80">Vous pouvez le modifier tant que le vote reste ouvert.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/" className={buttonClass("secondary")}>
            Retour à l&apos;accueil
          </Link>
          <button type="button" className={buttonClass("ghost", "text-chalk hover:bg-pitch-dark")} onClick={() => setReceipt(null)}>
            Modifier encore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Podium : les trois choix et leurs points */}
      <section aria-label="Vos trois choix" className="sticky top-2 z-30 rounded-2xl bg-chalk p-3 shadow-md ring-1 ring-line">
        <ol className="grid grid-cols-3 gap-2">
          {Array.from({ length: MAX_PICKS }, (_, i) => {
            const id = selection[i];
            const mate = id ? byId.get(id) : null;
            const style = RANK_STYLES[i];
            return (
              <li
                key={i}
                className={cx(
                  "flex min-h-28 flex-col rounded-xl p-2 text-center",
                  mate ? cx(style.bg, style.text) : "border-2 border-dashed border-line text-muted",
                )}
              >
                <span className="num font-display text-3xl font-bold leading-none">{pointsForRank(i)}</span>
                <span className="text-[0.7rem] font-semibold">{pointsForRank(i) > 1 ? "points" : "point"}</span>
                <span className="mt-1 line-clamp-2 flex-1 text-sm font-semibold leading-tight">{mate ? mate.name : style.label}</span>
                {mate ? (
                  <span className="mt-1 flex justify-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "move", index: i, direction: -1 })}
                      disabled={i === 0}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-black/10 disabled:opacity-30"
                      aria-label={`Monter ${mate.name} au rang ${i}`}
                    >
                      <ArrowUp size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "move", index: i, direction: 1 })}
                      disabled={i >= selection.length - 1}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-black/10 disabled:opacity-30"
                      aria-label={`Descendre ${mate.name} au rang ${i + 2}`}
                    >
                      <ArrowDown size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "toggle", playerId: mate.id })}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-black/10"
                      aria-label={`Retirer ${mate.name}`}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-center text-sm text-muted" aria-live="polite">
          {selection.length < MAX_PICKS
            ? `Touchez un coéquipier : il recevra ${pointsForRank(selection.length)} point${pointsForRank(selection.length) > 1 ? "s" : ""}.`
            : "Vos trois choix sont faits. Vérifiez l'ordre puis validez."}
        </p>
      </section>

      <ul className="space-y-2" aria-label="Coéquipiers présents">
        {teammates.map((t) => {
          const rank = selection.indexOf(t.id);
          const picked = rank >= 0;
          const full = !picked && selection.length >= MAX_PICKS;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => dispatch({ type: "toggle", playerId: t.id })}
                disabled={full}
                aria-pressed={picked}
                className={cx(
                  "flex min-h-16 w-full items-center gap-3 rounded-xl bg-chalk px-3 text-left ring-1 transition-[box-shadow,opacity]",
                  picked ? cx("ring-4", RANK_STYLES[rank].ring) : "ring-line active:ring-pitch",
                  full && "opacity-45",
                )}
              >
                <Jersey number={t.number} className="bg-pitch-soft text-pitch" />
                <span className="flex-1 font-semibold">{t.name}</span>
                {picked ? (
                  <span className={cx("num rounded-full px-3 py-1 text-sm font-bold", RANK_STYLES[rank].bg, RANK_STYLES[rank].text)}>
                    {pointsForRank(rank)} pt{pointsForRank(rank) > 1 ? "s" : ""}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex gap-2 rounded-2xl bg-turf/95 py-2 backdrop-blur lg:bottom-4">
        <Button
          type="button"
          variant="secondary"
          onClick={() => dispatch({ type: "reset" })}
          disabled={selection.length === 0 || pending}
          aria-label="Recommencer"
        >
          <RotateCcw size={18} aria-hidden />
        </Button>
        <Button type="button" className="flex-1" onClick={submit} disabled={!complete || pending || unchanged}>
          {pending ? "Envoi…" : alreadyVoted ? "Enregistrer la modification" : "Valider mon vote"}
        </Button>
      </div>
    </div>
  );
}
