export const metadata = { title: "Hors ligne" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-4xl font-bold text-pitch">Pas de connexion</h1>
      <p className="mt-3 text-muted">
        Votre téléphone est hors ligne. Le vote nécessite une connexion : réessayez dès que le réseau revient.
      </p>
    </main>
  );
}
