import { requireMaitre } from "@/lib/auth";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { getCurrentSeason, getSeasonMatches, matchTitle } from "@/lib/data";
import { rememberSiteUrl } from "@/lib/origin";
import { fmtDateTime, fmtPrecise } from "@/lib/time";
import { PageTitle, Panel, SectionTitle, Tag, cx } from "@/components/ui";
import { CancelButton, ComposeForm, DispatchNow, PrefsForm } from "./forms";

export const metadata = { title: "Notifications" };

type Diag = {
  site_url: string | null;
  cron_token: boolean;
  vapid: boolean;
  abonnes: number;
  appareils: number;
  en_attente: number;
  programmees: number;
  pg_cron: boolean;
  pg_net: boolean;
  tache?: { present: boolean; actif: boolean; planning: string | null };
  executions?: { status: string; return_message: string | null; start_time: string }[];
  appels?: { status_code: number | null; timed_out: boolean | null; error_msg: string | null; created: string }[];
};

type Scheduled = {
  id: string;
  title: string;
  body: string;
  audience: "tous" | "feuille" | "moi";
  send_at: string;
  claimed_at: string | null;
  sent_count: number | null;
  failed_count: number | null;
  cancelled: boolean;
};

function Check({ ok, label, help }: { ok: boolean; label: string; help?: string }) {
  return (
    <li className="flex gap-3 py-2">
      <span
        className={cx(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          ok ? "bg-pitch text-chalk" : "bg-late text-chalk",
        )}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <span>
        <span className="font-semibold">{label}</span>
        {!ok && help ? <span className="block text-sm text-muted">{help}</span> : null}
      </span>
    </li>
  );
}

export default async function NotificationsPage() {
  await requireMaitre();
  const supabase = await createUserClient();
  const admin = createServiceClient();
  await rememberSiteUrl(admin).catch(() => null);
  const [{ data: diagData }, { data: settings }, { data: list }, season] = await Promise.all([
    admin.rpc("svc_notification_diagnostics"),
    supabase.from("app_settings").select("*").eq("id", 1).single(),
    supabase.from("scheduled_notifications").select("*").order("send_at", { ascending: false }).limit(20),
    getCurrentSeason(supabase),
  ]);
  const d = (diagData ?? {}) as Diag;
  const matches = season ? await getSeasonMatches(supabase, season.id) : [];
  const now = new Date().getTime();
  const options = matches
    .filter((m) => Date.parse(m.kickoff_at) > now - 7 * 86400000)
    .map((m) => ({ id: m.id, label: `${matchTitle(m)} (${fmtDateTime(m.kickoff_at)})` }));
  const lastCall = d.appels?.[0];
  const lastRun = d.executions?.[0];
  const cronOk = Boolean(d.pg_cron && d.tache?.present && d.tache?.actif);
  const callsOk = !lastCall || (lastCall.status_code !== null && lastCall.status_code < 300);

  return (
    <div className="space-y-5">
      <PageTitle title="Notifications" />

      <Panel>
        <SectionTitle>Ce que les joueurs reçoivent</SectionTitle>
        <ol className="space-y-2 text-sm">
          <li>
            <strong>1. Inscriptions ouvertes</strong> : le lundi à 9 h de la semaine du match, à ceux qui n&apos;ont pas encore
            indiqué leur disponibilité.
          </li>
          <li>
            <strong>2. Convocation</strong> : dès que l&apos;entraîneur valide la feuille de match, aux joueurs retenus.
          </li>
          <li>
            <strong>3. Vote ouvert</strong> : à l&apos;ouverture du vote, aux joueurs de la feuille qui n&apos;ont pas voté.
          </li>
          <li>
            <strong>4. Rappel de vote</strong> : {settings?.reminder_hours ?? 3} h avant l&apos;heure limite, à ceux qui n&apos;ont
            toujours pas voté.
          </li>
          <li>
            <strong>5. Messages libres</strong> : ceux que vous envoyez ou programmez ci-dessous.
          </li>
        </ol>
        <p className="mt-3 text-sm text-muted">
          Chaque notification n&apos;est envoyée qu&apos;une fois par joueur et par match. Seuls les membres ayant activé les
          notifications dans leur Profil (sur chaque téléphone) les reçoivent. Sur iPhone, l&apos;application doit être installée
          sur l&apos;écran d&apos;accueil.
        </p>
      </Panel>

      <Panel>
        <SectionTitle>Envoyer ou programmer un message</SectionTitle>
        <ComposeForm matches={options} />
      </Panel>

      <Panel>
        <SectionTitle>Messages programmés et envoyés</SectionTitle>
        {(list ?? []).length === 0 ? (
          <p className="text-sm text-muted">Aucun message pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-line">
            {((list ?? []) as Scheduled[]).map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {n.audience === "tous" ? "Toute l'équipe" : n.audience === "moi" ? "Moi seulement" : "Joueurs de la feuille"},{" "}
                    {n.claimed_at ? `envoyé le ${fmtPrecise(n.claimed_at)}` : `prévu le ${fmtDateTime(n.send_at)}`}
                  </p>
                </div>
                {n.cancelled ? (
                  <Tag tone="muted">Annulé</Tag>
                ) : n.claimed_at ? (
                  <Tag tone={n.sent_count ? "ok" : "late"}>
                    {n.sent_count ?? 0} reçu{(n.sent_count ?? 0) > 1 ? "s" : ""}
                    {n.failed_count ? `, ${n.failed_count} échec${n.failed_count > 1 ? "s" : ""}` : ""}
                  </Tag>
                ) : (
                  <span className="flex items-center gap-2">
                    <Tag tone="warn">Programmé</Tag>
                    <CancelButton id={n.id} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Notifications automatiques</SectionTitle>
        <PrefsForm
          notifyOnOpen={settings?.notify_on_open ?? true}
          reminderHours={settings?.reminder_hours ?? 3}
          notifyAvailability={settings?.notify_availability ?? true}
          notifyConvocation={settings?.notify_convocation ?? true}
        />
      </Panel>

      <Panel>
        <SectionTitle>État du système</SectionTitle>
        <ul className="divide-y divide-line">
          <Check ok={d.appareils > 0} label={`${d.abonnes ?? 0} membre(s) abonné(s), ${d.appareils ?? 0} appareil(s)`} help="Chaque joueur doit activer les notifications dans son Profil." />
          <Check ok={Boolean(d.vapid)} label="Clés de chiffrement créées" help="Elles se créent à la première ouverture d'un Profil." />
          <Check ok={Boolean(d.site_url)} label={d.site_url ? `Adresse du site connue : ${d.site_url}` : "Adresse du site inconnue"} help="Ouvrez une fois l'administration depuis l'adresse officielle (https)." />
          <Check ok={Boolean(d.pg_net)} label="Extension pg_net (appels vers le site)" help="Supabase > Database > Extensions : activez pg_net, puis réexécutez le script de mise à jour." />
          <Check
            ok={cronOk}
            label={cronOk ? `Planificateur actif (${d.tache?.planning})` : "Planificateur absent ou inactif"}
            help="Supabase > Integrations > Cron : la tâche aubel-push doit exister et être active."
          />
          {lastRun ? (
            <Check
              ok={lastRun.status === "succeeded"}
              label={`Dernière vérification : ${fmtPrecise(lastRun.start_time)} (${lastRun.status === "succeeded" ? "réussie" : "échec"})`}
              help={lastRun.return_message ?? undefined}
            />
          ) : null}
          {lastCall ? (
            <Check
              ok={callsOk}
              label={`Dernier appel du site : ${fmtPrecise(lastCall.created)} (code ${lastCall.status_code ?? "aucun"})`}
              help={
                lastCall.error_msg ??
                (lastCall.status_code === 401
                  ? "Jeton refusé : réexécutez le script de mise à jour."
                  : "Le site n'a pas répondu correctement : vérifiez qu'il est en ligne (Vercel).")
              }
            />
          ) : (
            <li className="py-2 text-sm text-muted">Aucun appel automatique pour l&apos;instant (normal tant que rien n&apos;est dû).</li>
          )}
        </ul>
        <p className="mt-3 text-sm text-muted">
          En attente maintenant : {d.en_attente ?? 0} notification(s) automatique(s), {d.programmees ?? 0} message(s) programmé(s).
        </p>
        <div className="mt-3">
          <DispatchNow />
        </div>
      </Panel>
    </div>
  );
}
