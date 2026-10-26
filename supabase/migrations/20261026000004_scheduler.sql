-- =====================================================================
-- Aubel Réserve B — 4/4 : planificateur des ouvertures/fermetures
-- =====================================================================
-- Sur Supabase, pg_cron exécute process_vote_schedule() chaque minute.
-- Même si le planificateur prenait du retard, aucun vote ne peut être
-- accepté hors fenêtre : submit_ballot() recalcule l'état au moment exact
-- de la réception. Le planificateur sert à matérialiser l'état et à
-- appliquer les malus de non-vote à la clôture.
-- Si pg_cron n'est pas disponible (banc de test local), la migration
-- l'ignore ; un appel de secours existe via /api/cron/votes.
-- =====================================================================

do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'aubel-vote-schedule') then
      perform cron.unschedule('aubel-vote-schedule');
    end if;
    perform cron.schedule('aubel-vote-schedule', '* * * * *',
                          'select public.process_vote_schedule()');
  else
    raise notice 'pg_cron indisponible : planification à configurer manuellement.';
  end if;
end
$outer$;
