import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion" };

export default async function LoginPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.mustChangePassword ? "/premiere-connexion" : "/");

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-pitch text-chalk">
      {/* Lignes de terrain à la craie */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.14]"
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" stroke="currentColor" strokeWidth="3">
          <rect x="20" y="20" width="360" height="760" />
          <line x1="20" y1="400" x2="380" y2="400" />
          <circle cx="200" cy="400" r="70" />
          <rect x="100" y="20" width="200" height="110" />
          <rect x="150" y="20" width="100" height="40" />
          <rect x="100" y="670" width="200" height="110" />
          <rect x="150" y="740" width="100" height="40" />
        </g>
        <circle cx="200" cy="400" r="5" fill="currentColor" />
      </svg>

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-10">
        <p className="font-display text-lg font-semibold text-gold">Aubel</p>
        <h1 className="font-display text-6xl font-bold leading-[0.9]">Réserve B</h1>
        <p className="mt-4 max-w-xs text-chalk/80">
          Après chaque match, désignez vos trois meilleurs coéquipiers.
        </p>

        <div className="mt-8 rounded-2xl bg-chalk p-5 text-ink shadow-xl">
          <LoginForm />
        </div>
        <p className="mt-6 text-sm text-chalk/70">
          Pas encore d&apos;accès ? Vos identifiants vous sont remis par le maître de l&apos;équipe.
        </p>
      </div>
    </main>
  );
}
