"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rafraîchit la page (données serveur) à intervalle régulier, onglet visible uniquement. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
