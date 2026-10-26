import Link from "next/link";
import { installationOpen } from "./actions";
import { InstallForm } from "./install-form";

export const metadata = { title: "Installation" };
// Toujours recalculée : l'état dépend de la base, pas du moment de la compilation.
export const dynamic = "force-dynamic";

export default async function InstallationPage() {
  let open: boolean;
  let problem: string | null = null;
  try {
    open = await installationOpen();
  } catch (e) {
    open = false;
    problem = e instanceof Error ? e.message : "Configuration incomplète.";
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <h1 className="font-display text-4xl font-bold text-pitch">Installation</h1>
      {problem ? (
        <p className="mt-3 rounded-lg bg-late-soft px-4 py-3 text-late">{problem}</p>
      ) : open ? (
        <>
          <p className="mt-2 text-muted">
            Créez le compte du maître. Cette page ne fonctionne qu&apos;une seule fois et exige le code
            d&apos;installation (variable SETUP_TOKEN de Vercel).
          </p>
          <div className="mt-6 rounded-2xl bg-chalk p-5 shadow-sm">
            <InstallForm />
          </div>
        </>
      ) : (
        <p className="mt-3 text-muted">
          L&apos;installation est terminée : le compte maître existe.{" "}
          <Link href="/connexion" className="font-semibold text-pitch">Se connecter</Link>
        </p>
      )}
    </main>
  );
}
