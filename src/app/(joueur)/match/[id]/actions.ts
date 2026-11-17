"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { translateError } from "@/lib/errors";
import { createUserClient } from "@/lib/supabase/server";

const STATUSES = ["present", "absent", "incertain"] as const;

export async function setAvailabilityAction(matchId: string, status: string, comment: string): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(matchId).success || !(STATUSES as readonly string[]).includes(status)) {
    return failure("Requête invalide.");
  }
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("set_my_availability", {
    p_match_id: matchId,
    p_status: status,
    p_comment: comment.slice(0, 140) || null,
  });
  if (error) return failure(translateError(error));
  revalidatePath("/", "layout");
  return success(
    status === "present" ? "Noté : vous êtes disponible." : status === "absent" ? "Noté : vous êtes absent." : "Noté : réponse incertaine.",
  );
}

// ---------------------------------------------------------------- Direct
const KINDS = ["but", "but_adverse", "jaune", "rouge"] as const;

export async function liveControlAction(matchId: string, action: string): Promise<ActionResult<string | null>> {
  await requireViewer();
  if (!z.uuid().safeParse(matchId).success) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("live_control", { p_match_id: matchId, p_action: action });
  if (error) return failure(translateError(error));
  revalidatePath(`/match/${matchId}`);
  return success("", data as string | null);
}

export async function addEventAction(
  matchId: string,
  kind: string,
  playerId: string | null,
  assistId: string | null,
  minute: number | null,
): Promise<ActionResult> {
  await requireViewer();
  const uuidOrNull = z.uuid().nullable();
  if (
    !z.uuid().safeParse(matchId).success ||
    !(KINDS as readonly string[]).includes(kind) ||
    !uuidOrNull.safeParse(playerId).success ||
    !uuidOrNull.safeParse(assistId).success ||
    (minute !== null && !(Number.isInteger(minute) && minute >= 0 && minute <= 150))
  ) {
    return failure("Requête invalide.");
  }
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("add_match_event", {
    p_match_id: matchId,
    p_kind: kind,
    p_player_id: playerId,
    p_assist_player_id: assistId,
    p_minute: minute,
  });
  if (error) return failure(translateError(error));
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/joueurs");
  return success("Enregistré.");
}

export async function deleteEventAction(eventId: string, matchId: string): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(eventId).success) return failure("Requête invalide.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("delete_match_event", { p_event_id: eventId });
  if (error) return failure(translateError(error));
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/joueurs");
  return success("Supprimé.");
}

export async function updateEventMinuteAction(eventId: string, matchId: string, minute: number | null): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(eventId).success || (minute !== null && !(Number.isInteger(minute) && minute >= 0 && minute <= 150))) {
    return failure("Minute invalide.");
  }
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("update_match_event_minute", { p_event_id: eventId, p_minute: minute });
  if (error) return failure(translateError(error));
  revalidatePath(`/match/${matchId}`);
  return success("Minute corrigée.");
}
