"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-bold text-pitch">Le chargement a échoué</h1>
      <p className="mt-2 text-muted">Vérifiez votre connexion puis réessayez. Si le problème persiste, prévenez le maître.</p>
      <button onClick={reset} className="mt-6 min-h-12 rounded-lg bg-pitch px-5 font-semibold text-chalk">
        Réessayer
      </button>
    </main>
  );
}
