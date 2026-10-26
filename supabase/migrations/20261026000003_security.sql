-- =====================================================================
-- Aubel Réserve B — 3/4 : Row Level Security, privilèges et vues
-- =====================================================================
-- Principe : refus par défaut.
--  * anon (non connecté) : aucun accès aux tables ni aux fonctions.
--  * authenticated : lecture filtrée par RLS, AUCUNE écriture directe.
--    Les écritures passent par des fonctions contrôlées.
--  * service_role : utilisé uniquement côté serveur (jamais dans le navigateur).
-- =====================================================================

-- 1. On retire tous les droits accordés par défaut par Supabase
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 2. RLS activée (et forcée) sur toutes les tables
alter table public.app_settings      enable row level security;
alter table public.seasons           enable row level security;
alter table public.players           enable row level security;
alter table public.profiles          enable row level security;
alter table public.matches           enable row level security;
alter table public.match_players     enable row level security;
alter table public.ballots           enable row level security;
alter table public.ballot_selections enable row level security;
alter table public.ballot_versions   enable row level security;
alter table public.penalties         enable row level security;
alter table public.audit_log         enable row level security;
alter table public.login_attempts    enable row level security;

-- 3. Lecture seule pour les utilisateurs connectés (filtrée par RLS)
grant select on public.app_settings, public.seasons, public.players, public.profiles,
                public.matches, public.match_players, public.ballots, public.ballot_selections,
                public.ballot_versions, public.penalties, public.audit_log
  to authenticated;
-- login_attempts : aucun accès client.

-- Configuration : visible par tous les connectés (règles du jeu)
create policy settings_read on public.app_settings for select to authenticated using (true);

-- Saisons : visibles par tous les connectés
create policy seasons_read on public.seasons for select to authenticated using (true);

-- Effectif : noms et numéros visibles par les connectés (nécessaire pour voter)
create policy players_read on public.players for select to authenticated using (true);

-- Profils : chacun voit le sien ; le maître voit tout
create policy profiles_read_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_maitre()));

-- Matchs : les joueurs voient les matchs non archivés ; le maître voit tout
create policy matches_read on public.matches for select to authenticated
  using (not archived or (select public.is_maitre()));

-- Feuilles de match : visibles (savoir qui est sélectionnable)
create policy match_players_read on public.match_players for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id
                 and (not m.archived or (select public.is_maitre()))));

-- BULLETINS : uniquement les siens ; le maître voit tout
create policy ballots_read on public.ballots for select to authenticated
  using (voter_player_id = (select public.my_player_id()) or (select public.is_maitre()));

create policy selections_read on public.ballot_selections for select to authenticated
  using (
    (select public.is_maitre())
    or exists (select 1 from public.ballots b
               where b.id = ballot_id and b.voter_player_id = (select public.my_player_id()))
  );

-- Historique des versions, malus, journal : maître uniquement
create policy ballot_versions_read on public.ballot_versions for select to authenticated
  using ((select public.is_maitre()));
create policy penalties_read on public.penalties for select to authenticated
  using ((select public.is_maitre()));
create policy audit_read on public.audit_log for select to authenticated
  using ((select public.is_maitre()));

-- Aucune politique INSERT/UPDATE/DELETE : toute écriture directe est refusée.

-- 4. Vue calendrier avec l'état effectif (respecte la RLS de matches)
create view public.v_matches with (security_invoker = true) as
  select m.id, m.season_id, m.opponent, m.kickoff_at, m.location,
         m.vote_opens_at, m.vote_closes_at, m.vote_deadline,
         m.counts_for_ranking, m.archived, m.manual_state, m.manual_at,
         public.match_effective_state(m, now()) as effective_state
  from public.matches m;
grant select on public.v_matches to authenticated;

-- 5. Droits d'exécution des fonctions
-- Aides utilisées par la RLS et l'application
grant execute on function public.is_maitre() to authenticated;
grant execute on function public.my_player_id() to authenticated;
grant execute on function public.match_effective_state(public.matches, timestamptz) to authenticated;
grant execute on function public.compute_vote_state(timestamptz, timestamptz, public.vote_state, timestamptz, timestamptz) to authenticated;

-- Joueur
grant execute on function public.submit_ballot(uuid, uuid[]) to authenticated;

-- Maître (chaque fonction vérifie elle-même le rôle)
grant execute on function public.admin_save_settings(boolean, integer, boolean, integer) to authenticated;
grant execute on function public.admin_save_season(uuid, text, date, date, boolean) to authenticated;
grant execute on function public.admin_save_player(uuid, text, smallint, boolean) to authenticated;
grant execute on function public.admin_save_match(uuid, uuid, text, timestamp, text, timestamp, timestamp, timestamp, boolean) to authenticated;
grant execute on function public.admin_set_vote_state(uuid, public.vote_state) to authenticated;
grant execute on function public.admin_set_archived(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_match(uuid) to authenticated;
grant execute on function public.admin_set_match_players(uuid, uuid[]) to authenticated;
grant execute on function public.admin_correct_ballot(uuid, uuid, uuid[], boolean, text) to authenticated;
grant execute on function public.admin_set_ballot_status(uuid, text, text) to authenticated;
grant execute on function public.admin_set_penalty(uuid, uuid, public.penalty_kind, integer, text, text) to authenticated;
grant execute on function public.admin_season_standings(uuid) to authenticated;
grant execute on function public.admin_match_summary(uuid) to authenticated;

-- Serveur uniquement (clé service)
grant execute on function public.svc_create_account(uuid, uuid, text, public.app_role, uuid, text, smallint) to service_role;
grant execute on function public.svc_bootstrap_maitre(uuid, text, text, smallint) to service_role;
grant execute on function public.svc_set_account_active(uuid, uuid, boolean) to service_role;
grant execute on function public.svc_mark_password_reset(uuid, uuid) to service_role;
grant execute on function public.svc_password_changed(uuid) to service_role;
grant execute on function public.svc_login_allowed(text, text) to service_role;
grant execute on function public.svc_login_record(text, text, boolean) to service_role;
grant execute on function public.process_vote_schedule() to service_role;
grant execute on function public.svc_require_maitre(uuid) to service_role;
