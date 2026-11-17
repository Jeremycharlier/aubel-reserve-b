"use client";

import { useState, useTransition } from "react";
import { Check, HelpCircle, X } from "lucide-react";
import { Notice, cx } from "@/components/ui";
import { setAvailabilityAction } from "@/app/(joueur)/match/[id]/actions";

type Status = "present" | "absent" | "incertain";

const OPTIONS: { value: Status; label: string; icon: typeof Check; on: string }[] = [
  { value: "present", label: "Présent", icon: Check, on: "bg-pitch text-chalk ring-pitch" },
  { value: "incertain", label: "Incertain", icon: HelpCircle, on: "bg-warn text-chalk ring-warn" },
  { value: "absent", label: "Absent", icon: X, on: "bg-late text-chalk ring-late" },
];

/** Trois gros boutons : la réponse est enregistrée dès le toucher. */
export function AvailabilityPicker({
  matchId,
  initial,
  initialComment,
}: {
  matchId: string;
  initial: Status | null;
  initialComment: string | null;
}) {
  const [status, setStatus] = useState<Status | null>(initial);
  const [comment, setComment] = useState(initialComment ?? "");
  const [showComment, setShowComment] = useState(Boolean(initialComment));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: Status, nextComment = comment) =>
    startTransition(async () => {
      const previous = status;
      setStatus(next);
      const res = await setAvailabilityAction(matchId, next, nextComment);
      if (!res.ok) setStatus(previous);
      setMessage({ ok: res.ok, text: res.message });
    });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ma disponibilité">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const on = status === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              onClick={() => save(o.value)}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center rounded-xl font-semibold ring-2 transition-colors",
                on ? o.on : "bg-chalk text-ink ring-line",
              )}
            >
              <Icon size={20} aria-hidden />
              <span className="text-sm">{o.label}</span>
            </button>
          );
        })}
      </div>
      {showComment ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (status) save(status, comment);
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={140}
            placeholder="ex. j'arrive à 15 h, blessé à la cheville…"
            className="min-h-11 flex-1 rounded-lg border border-line bg-white px-3 text-sm"
            aria-label="Commentaire pour l'entraîneur"
          />
          <button type="submit" disabled={!status || pending} className="min-h-11 rounded-lg bg-pitch px-3 text-sm font-semibold text-chalk disabled:opacity-50">
            OK
          </button>
        </form>
      ) : (
        <button type="button" className="min-h-10 text-sm font-semibold text-pitch" onClick={() => setShowComment(true)}>
          Ajouter un commentaire
        </button>
      )}
      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}
    </div>
  );
}
