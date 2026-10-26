import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { PasswordForm } from "@/components/password-form";
import { logoutAction } from "@/app/connexion/actions";

export const metadata = { title: "Choisir un mot de passe" };

export default async function FirstLoginPage() {
  const viewer = await requireViewer({ allowPasswordChange: true });
  if (!viewer.mustChangePassword) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="font-display text-4xl font-bold text-pitch">Bienvenue, {viewer.displayName}</h1>
      <p className="mt-2 text-muted">
        Vous utilisez un mot de passe temporaire. Choisissez le vôtre pour continuer : personne d&apos;autre, pas même
        le maître, ne le connaîtra.
      </p>
      <div className="mt-6 rounded-2xl bg-chalk p-5 shadow-sm">
        <PasswordForm requireCurrent={false} />
      </div>
      <form action={logoutAction} className="mt-4 text-center">
        <button className="min-h-12 text-sm font-semibold text-muted underline-offset-4 hover:underline">Se déconnecter</button>
      </form>
    </main>
  );
}
