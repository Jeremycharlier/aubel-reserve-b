"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { translateError } from "@/lib/errors";
import { createUserClient } from "@/lib/supabase/server";

const schema = z.object({
  matchId: z.uuid(),
  selection: z.array(z.uuid()).length(3),
});

export type BallotReceipt = { is_late: boolean; version: number; last_modified_at: string; first_submitted_at: string };

/**
 * Enregistre le bulletin. Toutes les règles (vote ouvert, feuille de match,
 * doublons, auto-vote, heure limite, malus) sont vérifiées par la base dans
 * une transaction unique ; l'horodatage est celui du serveur.
 */
export async function submitBallotAction(matchId: string, selection: string[]): Promise<ActionResult<BallotReceipt>> {
  await requireViewer();
  const parsed = schema.safeParse({ matchId, selection });
  if (!parsed.success) return failure("Sélectionnez exactement trois coéquipiers.");
  if (new Set(parsed.data.selection).size !== 3) return failure(translateError("DUPLICATE_SELECTION"));

  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("submit_ballot", {
    p_match_id: parsed.data.matchId,
    p_selections: parsed.data.selection,
  });
  if (error) return failure(translateError(error));
  revalidatePath("/", "layout");
  const receipt = data as BallotReceipt;
  return success(receipt.version > 1 ? "Vote modifié." : "Vote enregistré.", receipt);
}
