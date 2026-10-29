import { requireMaitre } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { PageTitle, Panel, SectionTitle, Tag } from "@/components/ui";
import { RoleTag } from "@/components/stats";
import { PLAYER_COLUMNS, ageOn, type PlayerRow } from "@/lib/data";
import { AccountActions, EditPlayerForm, NewPlayerForm, PlayerOnlyForm } from "./forms";

export const metadata = { title: "Équipe et comptes" };

type Player = PlayerRow;
type Profile = { user_id: string; username: string; role: string; player_id: string | null; active: boolean; must_change_password: boolean; created_at: string };

export default async function TeamPage() {
  const viewer = await requireMaitre();
  const supabase = await createUserClient();
  const [{ data: players }, { data: profiles }] = await Promise.all([
    supabase.from("players").select(PLAYER_COLUMNS).order("display_name"),
    supabase.from("profiles").select("user_id, username, role, player_id, active, must_change_password, created_at"),
  ]);
  const byPlayer = new Map(((profiles ?? []) as Profile[]).filter((p) => p.player_id).map((p) => [p.player_id!, p]));
  const list = (players ?? []) as Player[];
  const active = list.filter((p) => p.active);
  const inactive = list.filter((p) => !p.active);
  const unlinked = active.filter((p) => !byPlayer.has(p.id)).map((p) => ({ id: p.id, name: p.display_name }));

  const renderPlayer = (p: Player) => {
    const acc = byPlayer.get(p.id);
    return (
      <li key={p.id} className="rounded-xl bg-chalk">
        <details>
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3">
            <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-soft font-display text-lg font-bold text-pitch">
              {p.shirt_number ?? "–"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {p.display_name}
                {p.use_nickname ? <span className="font-normal text-muted"> ({p.full_name})</span> : null}
              </span>
              <span className="block text-sm text-muted">
                {[acc ? `Identifiant : ${acc.username}` : "Sans compte", ageOn(p.birth_date) !== null ? `${ageOn(p.birth_date)} ans` : null]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              <RoleTag role={p.default_role} />
              {acc?.role === "maitre" ? <Tag tone="ok">Maître</Tag> : null}
              {acc && acc.active && acc.must_change_password ? <Tag tone="warn">Mot de passe temporaire</Tag> : null}
              {acc && !acc.active ? <Tag tone="late">Compte désactivé</Tag> : null}
              {!p.active && !acc ? <Tag tone="muted">Inactif</Tag> : null}
            </span>
          </summary>
          <div className="space-y-4 border-t border-line px-4 py-4">
            <EditPlayerForm player={p} hasAccount={!!acc} />
            {acc ? (
              <AccountActions
                userId={acc.user_id}
                username={acc.username}
                displayName={p.display_name}
                active={acc.active}
                isSelf={acc.user_id === viewer.userId}
              />
            ) : (
              <p className="text-sm text-muted">
                Pour donner un accès à ce joueur, utilisez « Créer un compte » ci-dessus et choisissez « Joueur déjà dans
                l&apos;effectif ».
              </p>
            )}
          </div>
        </details>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageTitle
        action={
          <a href="/api/joueurs/csv" className="font-semibold text-pitch" download>
            Exporter la liste (CSV)
          </a>
        }
        title="Équipe et comptes" subtitle={`${active.length} joueur${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}`} />

      <Panel>
        <SectionTitle>Créer un compte joueur</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Un mot de passe temporaire est généré : remettez-le au joueur, qui choisira le sien à la première connexion.
        </p>
        <NewPlayerForm unlinked={unlinked} />
      </Panel>

      <section>
        <SectionTitle>Effectif</SectionTitle>
        <ul className="space-y-2">{active.map(renderPlayer)}</ul>
      </section>

      {inactive.length > 0 ? (
        <section>
          <SectionTitle>Joueurs désactivés (historique conservé)</SectionTitle>
          <ul className="space-y-2">{inactive.map(renderPlayer)}</ul>
        </section>
      ) : null}

      <Panel>
        <SectionTitle>Ajouter un joueur sans compte</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Pour un joueur qui ne vote pas (ou pas encore) : il peut figurer sur les feuilles de match et recevoir des voix.
        </p>
        <PlayerOnlyForm />
      </Panel>
    </div>
  );
}
