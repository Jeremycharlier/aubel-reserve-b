import { requireViewer } from "@/lib/auth";
import { logoutAction } from "@/app/connexion/actions";
import { PasswordForm } from "@/components/password-form";
import { Button, PageTitle, Panel, SectionTitle } from "@/components/ui";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { PLAYER_COLUMNS, ROLE_LABEL, type PlayerRow } from "@/lib/data";
import { getVapidKeys } from "@/lib/push";
import { ProfileForm } from "./profile-form";
import { NotificationsCard } from "./notifications-card";

export const metadata = { title: "Profil" };

export default async function ProfilePage() {
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const [{ data: player }, vapid] = await Promise.all([
    viewer.playerId
      ? supabase.from("players").select(PLAYER_COLUMNS).eq("id", viewer.playerId).maybeSingle()
      : Promise.resolve({ data: null }),
    getVapidKeys(createServiceClient()).catch(() => null),
  ]);
  const p = player as PlayerRow | null;

  return (
    <div className="space-y-4">
      <PageTitle title="Profil" />
      <Panel>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">Nom</dt>
          <dd className="font-semibold">{p?.full_name ?? viewer.displayName}</dd>
          <dt className="text-muted">Identifiant</dt>
          <dd className="font-semibold">{viewer.username}</dd>
          <dt className="text-muted">Statut</dt>
          <dd className="font-semibold">
            {p ? ROLE_LABEL[p.default_role] : "Joueur"}
            {viewer.role === "maitre" ? ", maître" : ""}
          </dd>
          {p?.shirt_number ? (
            <>
              <dt className="text-muted">Numéro</dt>
              <dd className="num font-semibold">{p.shirt_number}</dd>
            </>
          ) : null}
        </dl>
      </Panel>
      {p ? (
        <Panel>
          <SectionTitle>Surnom et date de naissance</SectionTitle>
          <ProfileForm fullName={p.full_name} nickname={p.nickname} useNickname={p.use_nickname} birthDate={p.birth_date} />
        </Panel>
      ) : null}
      <Panel>
        <SectionTitle>Notifications</SectionTitle>
        {vapid ? (
          <NotificationsCard vapidPublicKey={vapid.publicKey} />
        ) : (
          <p className="text-sm text-muted">Notifications indisponibles pour le moment.</p>
        )}
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
