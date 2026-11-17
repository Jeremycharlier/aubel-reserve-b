"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { translateError } from "@/lib/errors";
import { requestOrigin } from "@/lib/origin";
import { sendTestNotification } from "@/lib/push";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

const subSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export async function subscribePushAction(subscription: unknown): Promise<ActionResult> {
  await requireViewer();
  const parsed = subSchema.safeParse(subscription);
  if (!parsed.success) return failure("Abonnement refusé par le navigateur.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: (await headers()).get("user-agent") ?? null,
  });
  if (error) return failure(translateError(error));
  return success("Notifications activées sur cet appareil.");
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  await requireViewer();
  const supabase = await createUserClient();
  await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  return success("Notifications désactivées sur cet appareil.");
}

export async function testPushAction(): Promise<ActionResult> {
  const viewer = await requireViewer();
  const report = await sendTestNotification(createServiceClient(), viewer.userId, await requestOrigin());
  if (report.sent === 0) return failure("Aucun appareil n'a reçu la notification. Réactivez les notifications.");
  return success(`Notification envoyée à ${report.sent} appareil${report.sent > 1 ? "s" : ""}.`);
}
