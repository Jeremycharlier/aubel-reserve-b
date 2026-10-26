import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-4xl font-bold text-pitch">Page introuvable</h1>
      <p className="mt-2 text-muted">Cette page n&apos;existe pas ou ne vous est pas accessible.</p>
      <Link href="/" className="mt-6 inline-flex min-h-12 items-center font-semibold text-pitch">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
