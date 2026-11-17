"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice, type ButtonVariant } from "@/components/ui";
import { initialResult, type ActionResult } from "@/lib/action-result";

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  variant = "primary",
  className,
  disabled,
  confirm,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  disabled?: boolean;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

type FormAction<T> = (prev: ActionResult<T>, formData: FormData) => Promise<ActionResult<T>>;

/**
 * Formulaire relié à une Server Action : affiche le message de retour,
 * et peut afficher un contenu supplémentaire (ex. mot de passe temporaire).
 */
export function ActionForm<T>({
  action,
  children,
  className,
  resetOnSuccess = false,
  renderResult,
}: {
  action: FormAction<T>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  renderResult?: (result: ActionResult<T>) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialResult as ActionResult<T>);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.message ? (
        <div className="mt-3">
          <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>
        </div>
      ) : null}
      {renderResult && state.ok ? renderResult(state) : null}
    </form>
  );
}
