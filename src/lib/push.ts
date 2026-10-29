import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDateTime } from "@/lib/time";

// Notifications push (norme Web Push). Les clés VAPID sont générées une
// seule fois et conservées dans la base (table app_secrets, service seul) :
// aucune variable d'environnement supplémentaire n'est nécessaire.

export type VapidKeys = { publicKey: string; privateKey: string };

export async function getVapidKeys(admin: SupabaseClient): Promise<VapidKeys> {
  const read = async () => {
    const [pub, priv] = await Promise.all([
      admin.rpc("svc_get_secret", { p_key: "vapid_public" }),
      admin.rpc("svc_get_secret", { p_key: "vapid_private" }),
    ]);
    return pub.data && priv.data ? { publicKey: pub.data as string, privateKey: priv.data as string } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = webpush.generateVAPIDKeys();
  // Écriture « si absent » : en cas d'appels simultanés, la première paire gagne.
  await admin.rpc("svc_set_secret", { p_key: "vapid_private", p_value: fresh.privateKey, p_overwrite: false });
  await admin.rpc("svc_set_secret", { p_key: "vapid_public", p_value: fresh.publicKey, p_overwrite: false });
  const stored = await read();
  if (!stored) throw new Error("Clés de notification indisponibles.");
  return stored;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; failures: number };

export type SendReport = { sent: number; failed: number; removed: number };

async function sendToSubscriptions(
  admin: SupabaseClient,
  subs: Subscription[],
  messageFor: (s: Subscription) => PushMessage,
  origin: string,
): Promise<{ report: SendReport; deliveredUsers: Set<string> }> {
  const keys = await getVapidKeys(admin);
  const report: SendReport = { sent: 0, failed: 0, removed: 0 };
  const deliveredUsers = new Set<string>();
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(messageFor(s)),
          {
            vapidDetails: { subject: process.env.VAPID_SUBJECT || origin, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: 6 * 3600,
            urgency: "normal",
            timeout: 10_000,
          },
        );
        report.sent += 1;
        deliveredUsers.add(s.user_id);
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        report.failed += 1;
        // 404 / 410 : abonnement expiré ou révoqué ; trop d'échecs : abandon
        if (status === 404 || status === 410 || s.failures >= 4) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
          report.removed += 1;
        } else {
          await admin.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
        }
      }
    }),
  );
  return { report, deliveredUsers };
}

type Pending = { user_id: string; match_id: string; kind: "ouverture" | "rappel"; opponent: string; vote_deadline: string };

/** Envoie les notifications d'ouverture et de rappel dues maintenant. */
export async function sendPendingNotifications(admin: SupabaseClient, origin: string): Promise<SendReport & { pending: number }> {
  const { data, error } = await admin.rpc("svc_pending_notifications");
  if (error) throw new Error(error.message);
  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) return { sent: 0, failed: 0, removed: 0, pending: 0 };

  const userIds = [...new Set(pending.map((p) => p.user_id))];
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, failures")
    .in("user_id", userIds);

  // Un message par utilisateur (le plus urgent si plusieurs matchs)
  const byUser = new Map<string, Pending>();
  for (const p of pending) {
    const cur = byUser.get(p.user_id);
    if (!cur || (p.kind === "rappel" && cur.kind !== "rappel")) byUser.set(p.user_id, p);
  }
  const { report } = await sendToSubscriptions(
    admin,
    (subs ?? []) as Subscription[],
    (s) => {
      const p = byUser.get(s.user_id)!;
      return p.kind === "rappel"
        ? {
            title: "N'oublie pas de voter",
            body: `Aubel B – ${p.opponent} : heure limite ${fmtDateTime(p.vote_deadline)}. Ensuite, ton vote sera compté en retard.`,
            url: `/vote/${p.match_id}`,
            tag: `rappel-${p.match_id}`,
          }
        : {
            title: "Le vote est ouvert",
            body: `Aubel B – ${p.opponent} : désigne tes 3 meilleurs coéquipiers avant ${fmtDateTime(p.vote_deadline)}.`,
            url: `/vote/${p.match_id}`,
            tag: `vote-${p.match_id}`,
          };
    },
    origin,
  );
  // Marqués comme traités même si l'envoi a échoué, pour ne pas insister
  await admin.rpc("svc_mark_notified", {
    p_user_ids: pending.map((p) => p.user_id),
    p_match_ids: pending.map((p) => p.match_id),
    p_kinds: pending.map((p) => p.kind),
  });
  return { ...report, pending: pending.length };
}

/** Notification de test vers les appareils d'un utilisateur. */
export async function sendTestNotification(admin: SupabaseClient, userId: string, origin: string): Promise<SendReport> {
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, failures")
    .eq("user_id", userId);
  const { report } = await sendToSubscriptions(
    admin,
    (subs ?? []) as Subscription[],
    () => ({ title: "Réserve B", body: "Les notifications fonctionnent sur cet appareil.", url: "/profil", tag: "test" }),
    origin,
  );
  return report;
}
