import { requireViewer } from "@/lib/auth";
import { logoutAction } from "@/app/connexion/actions";
import { PasswordForm } from "@/components/password-form";
import { Button, PageTitle, Panel, SectionTitle } from "@/components/ui";

export const metadata = { title: "Profil" };

export default async function ProfilePage() {
  const viewer = await requireViewer();
  return (
    <div className="space-y-4">
      <PageTitle title="Profil" />
      <Panel>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">Nom</dt>
          <dd className="font-semibold">{viewer.displayName}</dd>
          <dt className="text-muted">Identifiant</dt>
          <dd className="font-semibold">{viewer.username}</dd>
          <dt className="text-muted">Rôle</dt>
          <dd className="font-semibold">{viewer.role === "maitre" ? "Maître (et joueur)" : "Joueur"}</dd>
        </dl>
      </Panel>
      <Panel>
        <SectionTitle>Changer de mot de passe</SectionTitle>
        <PasswordForm requireCurrent />
      </Panel>
      <Panel>
        <SectionTitle>Installer l&apos;application</SectionTitle>
        <p className="text-sm text-muted">
          iPhone : dans Safari, touchez Partager puis « Sur l&apos;écran d&apos;accueil ». Android : dans Chrome, ouvrez le
          menu ⋮ puis « Installer l&apos;application ».
        </p>
      </Panel>
      <form action={logoutAction}>
        <Button variant="secondary" className="w-full">
          Se déconnecter
        </Button>
      </form>
    </div>
  );
}
