export type ActionResult<T = undefined> = {
  ok: boolean;
  message: string;
  data?: T;
  /** Change à chaque réponse pour forcer l'affichage du message. */
  at?: number;
};

export const initialResult: ActionResult = { ok: false, message: "" };

export function success<T>(message: string, data?: T): ActionResult<T> {
  return { ok: true, message, data, at: Date.now() };
}

export function failure(message: string): ActionResult<never> {
  return { ok: false, message, at: Date.now() };
}
