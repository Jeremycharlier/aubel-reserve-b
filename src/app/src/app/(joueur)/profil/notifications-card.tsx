"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { subscribePushAction, testPushAction, unsubscribePushAction } from "./push-actions";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function NotificationsCard({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registration();
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
        const res = await subscribePushAction(sub.toJSON());
        setMessage({ ok: res.ok, text: res.message });
        setState(res.ok ? "on" : "off");
      } catch {
        setMessage({ ok: false, text: "Activation impossible sur ce navigateur." });
      }
    });

  const disable = () =>
    startTransition(async () => {
      setMessage(null);
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMessage({ ok: true, text: "Notifications désactivées sur cet appareil." });
    });

  const test = () =>
    startTransition(async () => {
      const res = await testPushAction();
      setMessage({ ok: res.ok, text: res.message });
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Recevez une notification à l&apos;ouverture du vote et un rappel avant l&apos;heure limite si vous n&apos;avez pas
        encore voté. À activer sur chaque téléphone.
      </p>
      {state === "loading" ? <p className="text-sm text-muted">Vérification…</p> : null}
      {state === "ios-install" ? (
        <Notice tone="warn">
          Sur iPhone, installez d&apos;abord l&apos;application : dans Safari, bouton Partager puis « Sur l&apos;écran
          d&apos;accueil ». Ouvrez-la depuis l&apos;icône puis revenez ici (iOS 16.4 ou plus récent).
        </Notice>
      ) : null}
      {state === "unsupported" ? <Notice tone="warn">Ce navigateur ne gère pas les notifications.</Notice> : null}
      {state === "denied" ? (
        <Notice tone="warn">
          Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de
          l&apos;adresse, ou Réglages du téléphone), puis rechargez la page.
        </Notice>
      ) : null}
      {state === "off" ? (
        <Button onClick={enable} disabled={pending} className="w-full sm:w-auto">
          <Bell size={18} aria-hidden /> {pending ? "Activation…" : "Activer les notifications"}
        </Button>
      ) : null}
      {state === "on" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={test} disabled={pending}>
            <Bell size={18} aria-hidden /> Envoyer un test
          </Button>
          <Button variant="ghost" onClick={disable} disabled={pending}>
            <BellOff size={18} aria-hidden /> Désactiver
          </Button>
        </div>
      ) : null}
      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}
    </div>
  );
}
