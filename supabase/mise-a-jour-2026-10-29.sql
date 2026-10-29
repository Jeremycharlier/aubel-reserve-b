-- Aubel Réserve B : MISE À JOUR du 29/10/2026 (base déjà en service).
-- À coller en une fois dans Supabase > SQL Editor, puis « Run ». À exécuter une seule fois.
-- Aucune donnée existante n'est supprimée.

-- =====================================================================
-- Aubel Réserve B — 5 : améliorations d'octobre 2026
-- =====================================================================
--  * Surnom (affiché à la place du nom si choisi), date de naissance
--  * Statuts joueur / délégué / supporter (par défaut et par match)
--  * Statistiques de match (buts, passes, cartons) et score
--  * Suppression d'un match même avec votes (copie complète au journal)
--  * Import de calendrier
--  * Notifications push (abonnements, journal d'envoi, planification)
-- Conçue pour s'appliquer sur une base déjà en service : aucune donnée
-- existante n'est perdue. Exécutable une seule fois.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Joueurs : nom complet, surnom, naissance, statut par défaut
-- ---------------------------------------------------------------------
create type public.player_role as enum ('joueur', 'delegue', 'supporter');

alter table public.players
  add column full_name text,
  add column nickname text check (nickname is null or char_length(btrim(nickname)) between 1 and 30),
  add column use_nickname boolean not null default false,
  add column birth_date date check (birth_date is null or birth_date between '1920-01-01' and '2025-12-31'),
  add column default_role public.player_role not null default 'joueur';

update public.players set full_name = display_name where full_name is null;
alter table public.players alter column full_name set not null;
alter table public.players add constraint players_full_name_len check (char_length(btrim(full_name)) between 1 and 60);
create unique index players_full_name_unique on public.players (lower(btrim(full_name)));
-- display_name (nom affiché) reste unique : un surnom ne peut pas reprendre le nom d'un autre.

comment on column public.players.display_name is
  'Nom affiché partout, calculé : surnom si use_nickname, sinon full_name.';

-- Calcule le nom affiché. Compatibilité : un ancien appel qui modifie
-- display_name renomme le joueur (full_name).
create or replace function public.tg_player_names() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.full_name := coalesce(nullif(btrim(new.full_name), ''), btrim(new.display_name));
  elsif new.display_name is distinct from old.display_name and new.full_name is not distinct from old.full_name then
    new.full_name := btrim(new.display_name);
  end if;
  new.full_name := btrim(new.full_name);
  new.nickname := nullif(btrim(coalesce(new.nickname, '')), '');
  if new.nickname is null then
    new.use_nickname := false;
  end if;
  new.display_name := case when new.use_nickname then new.nickname else new.full_name end;
  return new;
end $$;

create trigger players_names before insert or update on public.players
  for each row execute function public.tg_player_names();

-- ---------------------------------------------------------------------
-- 2. Statut sur la feuille de match
--    joueur / délégué : votent et peuvent recevoir des voix
--    supporter        : vote, mais ne peut pas être choisi
-- ---------------------------------------------------------------------
alter table public.match_players add column role public.player_role;
update public.match_players set role = 'joueur' where role is null;
alter table public.match_players alter column role set not null;

create or replace function public.tg_match_player_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role is null then
    select p.default_role into new.role from public.players p where p.id = new.player_id;
  end if;
  return new;
end $$;

create trigger match_players_role before insert on public.match_players
  for each row execute function public.tg_match_player_role();

-- Un supporter ne peut jamais être sélectionné (vote joueur ou correction)
create or replace function public.tg_selection_not_supporter() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.ballots b
    join public.match_players mp on mp.match_id = b.match_id and mp.player_id = new.selected_player_id
    where b.id = new.ballot_id and mp.role = 'supporter'
  ) then
    raise exception 'SUPPORTER_SELECTED' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger ballot_selections_not_supporter
  before insert or update on public.ballot_selections
  for each row execute function public.tg_selection_not_supporter();

-- ---------------------------------------------------------------------
-- 3. Score et statistiques de match
-- ---------------------------------------------------------------------
alter table public.matches
  add column score_for smallint check (score_for between 0 and 99),
  add column score_against smallint check (score_against between 0 and 99);

create table public.match_stats (
  match_id uuid not null,
  player_id uuid not null,
  goals smallint not null default 0 check (goals between 0 and 20),
  assists smallint not null default 0 check (assists between 0 and 20),
  yellow_cards smallint not null default 0 check (yellow_cards between 0 and 2),
  red_cards smallint not null default 0 check (red_cards between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id),
  foreign key (match_id, player_id) references public.match_players (match_id, player_id) on delete cascade
);
create index match_stats_player_idx on public.match_stats (player_id);

-- ---------------------------------------------------------------------
-- 4. Réglages de notifications, secrets serveur, abonnements push
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column notify_on_open boolean not null default true,
  add column reminder_hours integer not null default 3 check (reminder_hours between 0 and 72);

-- Secrets générés et lus uniquement côté serveur (jamais exposés aux clients)
create table public.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
insert into public.app_secrets (key, value)
values ('cron_token', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict do nothing;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https?://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_log (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('ouverture', 'rappel')),
  sent_at timestamptz not null default now(),
  primary key (match_id, user_id, kind)
);

-- ---------------------------------------------------------------------
-- 5. Fonctions
-- ---------------------------------------------------------------------

-- Le joueur modifie son propre profil (surnom, choix d'affichage, naissance)
create or replace function public.update_my_profile(p_nickname text, p_use_nickname boolean, p_birth_date date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid := public.my_player_id();
  v_before public.players;
  v_after public.players;
begin
  if v_player is null then perform public.err('NO_PLAYER'); end if;
  select * into v_before from public.players where id = v_player for update;
  update public.players
     set nickname = p_nickname, use_nickname = coalesce(p_use_nickname, false), birth_date = p_birth_date
   where id = v_player
  returning * into v_after;
  perform public.audit('joueur.profil', 'player', v_player::text,
    jsonb_build_object('nickname', v_before.nickname, 'use_nickname', v_before.use_nickname, 'birth_date', v_before.birth_date),
    jsonb_build_object('nickname', v_after.nickname, 'use_nickname', v_after.use_nickname, 'birth_date', v_after.birth_date));
end $$;

-- Fiche joueur complète par le maître
create or replace function public.admin_save_player_full(
  p_id uuid, p_full_name text, p_nickname text, p_use_nickname boolean,
  p_birth_date date, p_shirt_number smallint, p_default_role public.player_role, p_active boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.players;
  v_after public.players;
begin
  if coalesce(btrim(p_full_name), '') = '' then perform public.err('NAME_REQUIRED'); end if;
  if p_id is null then
    insert into public.players (display_name, full_name, nickname, use_nickname, birth_date, shirt_number, default_role, active)
    values (btrim(p_full_name), btrim(p_full_name), p_nickname, coalesce(p_use_nickname, false), p_birth_date,
            p_shirt_number, coalesce(p_default_role, 'joueur'), coalesce(p_active, true))
    returning * into v_after;
  else
    select * into v_before from public.players where id = p_id for update;
    if not found then perform public.err('NOT_FOUND'); end if;
    update public.players
       set full_name = btrim(p_full_name), nickname = p_nickname, use_nickname = coalesce(p_use_nickname, false),
           birth_date = p_birth_date, shirt_number = p_shirt_number,
           default_role = coalesce(p_default_role, default_role), active = coalesce(p_active, active)
     where id = p_id
    returning * into v_after;
  end if;
  perform public.audit(case when p_id is null then 'joueur.creation' else 'joueur.modification' end,
                       'player', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
end $$;

-- Feuille de match avec statut par joueur (remplacement complet)
create or replace function public.admin_set_match_sheet(p_match_id uuid, p_player_ids uuid[], p_roles text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before jsonb;
  v_ids uuid[] := coalesce(p_player_ids, '{}');
  v_roles text[] := coalesce(p_roles, '{}');
begin
  if coalesce(array_length(v_ids, 1), 0) <> coalesce(array_length(v_roles, 1), 0) then
    perform public.err('INVALID_SHEET');
  end if;
  if exists (select 1 from unnest(v_roles) r where r not in ('joueur', 'delegue', 'supporter')) then
    perform public.err('INVALID_SHEET');
  end if;
  perform 1 from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  select coalesce(jsonb_object_agg(player_id, role), '{}') into v_before
    from public.match_players where match_id = p_match_id;

  -- On ne retire pas un joueur ayant voté, reçu des voix ou des statistiques
  if exists (
    select 1 from public.match_players mp
    where mp.match_id = p_match_id and not (mp.player_id = any (v_ids))
      and (exists (select 1 from public.ballots b where b.match_id = p_match_id and b.voter_player_id = mp.player_id)
           or exists (select 1 from public.ballot_selections s join public.ballots b on b.id = s.ballot_id
                      where b.match_id = p_match_id and s.selected_player_id = mp.player_id)
           or exists (select 1 from public.match_stats st where st.match_id = p_match_id and st.player_id = mp.player_id
                      and (st.goals + st.assists + st.yellow_cards + st.red_cards) > 0))
  ) then
    perform public.err('PLAYER_HAS_VOTES');
  end if;

  -- Un joueur ayant déjà reçu des voix ne peut pas devenir supporter
  if exists (
    select 1 from unnest(v_ids, v_roles) as x(pid, r)
    where r = 'supporter' and exists (
      select 1 from public.ballot_selections s join public.ballots b on b.id = s.ballot_id
      where b.match_id = p_match_id and s.selected_player_id = x.pid)
  ) then
    perform public.err('SUPPORTER_HAS_VOTES');
  end if;

  delete from public.match_players where match_id = p_match_id and not (player_id = any (v_ids));
  insert into public.match_players (match_id, player_id, role)
  select p_match_id, x.pid, x.r::public.player_role
  from unnest(v_ids, v_roles) as x(pid, r)
  join public.players pl on pl.id = x.pid
  on conflict (match_id, player_id) do update set role = excluded.role;

  perform public.audit('match.feuille', 'match', p_match_id::text, jsonb_build_object('feuille', v_before),
    jsonb_build_object('feuille', (select coalesce(jsonb_object_agg(player_id, role), '{}')
                                   from public.match_players where match_id = p_match_id)));
  return (select count(*) from public.match_players where match_id = p_match_id);
end $$;

-- Score et statistiques : p_rows = [{player_id, goals, assists, yellow, red}]
create or replace function public.admin_save_match_stats(
  p_match_id uuid, p_score_for smallint, p_score_against smallint, p_rows jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before jsonb;
begin
  perform 1 from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  select jsonb_build_object(
           'score', (select jsonb_build_array(score_for, score_against) from public.matches where id = p_match_id),
           'stats', coalesce(jsonb_agg(to_jsonb(s) - 'match_id' - 'updated_at'), '[]'))
    into v_before from public.match_stats s where s.match_id = p_match_id;

  update public.matches set score_for = p_score_for, score_against = p_score_against where id = p_match_id;

  delete from public.match_stats where match_id = p_match_id;
  insert into public.match_stats (match_id, player_id, goals, assists, yellow_cards, red_cards)
  select p_match_id, (r->>'player_id')::uuid,
         coalesce((r->>'goals')::smallint, 0), coalesce((r->>'assists')::smallint, 0),
         coalesce((r->>'yellow')::smallint, 0), coalesce((r->>'red')::smallint, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]')) r
  where coalesce((r->>'goals')::int, 0) + coalesce((r->>'assists')::int, 0)
      + coalesce((r->>'yellow')::int, 0) + coalesce((r->>'red')::int, 0) > 0;

  perform public.audit('match.statistiques', 'match', p_match_id::text, v_before,
    jsonb_build_object('score', jsonb_build_array(p_score_for, p_score_against),
                       'stats', (select coalesce(jsonb_agg(to_jsonb(s) - 'match_id' - 'updated_at'), '[]')
                                 from public.match_stats s where s.match_id = p_match_id)));
exception
  when foreign_key_violation then perform public.err('STATS_NOT_IN_SQUAD');
  when check_violation then perform public.err('STATS_INVALID');
end $$;

-- Suppression d'un match, même avec votes (confirmation « SUPPRIMER »).
-- Une copie complète de ce qui est effacé est conservée au journal.
drop function if exists public.admin_delete_match(uuid);
create or replace function public.admin_delete_match(p_match_id uuid, p_confirm text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_match public.matches;
  v_has_data boolean;
  v_snapshot jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  v_has_data := exists (select 1 from public.ballots where match_id = p_match_id)
             or exists (select 1 from public.penalties where match_id = p_match_id)
             or exists (select 1 from public.match_stats where match_id = p_match_id);
  if v_has_data and coalesce(p_confirm, '') <> 'SUPPRIMER' then
    perform public.err('CONFIRM_REQUIRED');
  end if;

  v_snapshot := jsonb_build_object(
    'match', to_jsonb(v_match),
    'feuille', (select coalesce(jsonb_agg(jsonb_build_object('joueur', pl.full_name, 'player_id', mp.player_id, 'statut', mp.role)), '[]')
                from public.match_players mp join public.players pl on pl.id = mp.player_id where mp.match_id = p_match_id),
    'bulletins', (select coalesce(jsonb_agg(jsonb_build_object(
                     'votant', pv.full_name, 'voter_player_id', b.voter_player_id, 'retard', b.is_late,
                     'statut', b.status, 'soumis', b.first_submitted_at, 'modifie', b.last_modified_at,
                     'choix', (select jsonb_agg(jsonb_build_object('rang', s.rank, 'points', s.points,
                                                                   'joueur', ps.full_name, 'player_id', s.selected_player_id)
                                                order by s.rank)
                               from public.ballot_selections s join public.players ps on ps.id = s.selected_player_id
                               where s.ballot_id = b.id))), '[]')
                  from public.ballots b join public.players pv on pv.id = b.voter_player_id where b.match_id = p_match_id),
    'malus', (select coalesce(jsonb_agg(to_jsonb(pe)), '[]') from public.penalties pe where pe.match_id = p_match_id),
    'statistiques', (select coalesce(jsonb_agg(to_jsonb(st)), '[]') from public.match_stats st where st.match_id = p_match_id)
  );

  delete from public.ballots where match_id = p_match_id;      -- sélections et versions en cascade
  delete from public.penalties where match_id = p_match_id;
  delete from public.matches where id = p_match_id;            -- feuille, stats, notifications en cascade
  perform public.audit('match.suppression', 'match', p_match_id::text, v_snapshot, null);
end $$;

-- Import d'un calendrier : p_rows = [{opponent, kickoff, location, opens, deadline, closes, counts}]
-- (dates en heure locale belge « YYYY-MM-DDTHH:MI:SS »). Tout ou rien.
create or replace function public.admin_import_matches(p_season_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  r jsonb;
  v_created integer := 0;
  v_skipped integer := 0;
begin
  if not exists (select 1 from public.seasons where id = p_season_id) then perform public.err('NOT_FOUND'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then perform public.err('IMPORT_EMPTY'); end if;
  if jsonb_array_length(p_rows) > 200 then perform public.err('IMPORT_TOO_MANY'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if exists (
      select 1 from public.matches m
      where m.season_id = p_season_id
        and m.kickoff_at = public.brussels((r->>'kickoff')::timestamp)
        and lower(m.opponent) = lower(btrim(r->>'opponent'))
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform public.admin_save_match(
      null, p_season_id, r->>'opponent', (r->>'kickoff')::timestamp, r->>'location',
      nullif(r->>'opens', '')::timestamp, nullif(r->>'closes', '')::timestamp,
      (r->>'deadline')::timestamp, coalesce((r->>'counts')::boolean, true));
    v_created := v_created + 1;
  end loop;
  perform public.audit('calendrier.import', 'season', p_season_id::text, null,
                       jsonb_build_object('crees', v_created, 'ignores_doublons', v_skipped));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

create or replace function public.admin_save_notification_settings(p_notify_on_open boolean, p_reminder_hours integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.app_settings;
begin
  if p_reminder_hours is null or p_reminder_hours not between 0 and 72 then perform public.err('INVALID_REMINDER'); end if;
  select * into v_before from public.app_settings where id = 1 for update;
  update public.app_settings
     set notify_on_open = coalesce(p_notify_on_open, true), reminder_hours = p_reminder_hours,
         updated_at = now(), updated_by = v_actor
   where id = 1;
  perform public.audit('config.notifications', 'app_settings', '1',
    jsonb_build_object('notify_on_open', v_before.notify_on_open, 'reminder_hours', v_before.reminder_hours),
    jsonb_build_object('notify_on_open', p_notify_on_open, 'reminder_hours', p_reminder_hours));
end $$;

-- Abonnements push de l'utilisateur connecté
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform public.err('AUTH_REQUIRED'); end if;
  if p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    perform public.err('INVALID_SUBSCRIPTION');
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Notifications à envoyer maintenant (serveur uniquement)
create or replace function public.svc_pending_notifications()
returns table (user_id uuid, match_id uuid, kind text, opponent text, vote_deadline timestamptz)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.app_settings where id = 1),
  open_matches as (
    select m.id, m.opponent, m.vote_deadline,
           case when s.reminder_hours > 0 and now() >= m.vote_deadline - make_interval(hours => s.reminder_hours)
                then 'rappel' else 'ouverture' end as kind
    from public.matches m cross join s
    where public.match_effective_state(m, now()) = 'ouvert'
      and now() < m.vote_deadline
  )
  select pr.user_id, om.id, om.kind, om.opponent, om.vote_deadline
  from open_matches om
  cross join s
  join public.match_players mp on mp.match_id = om.id
  join public.profiles pr on pr.player_id = mp.player_id and pr.active
  where (om.kind = 'rappel' or s.notify_on_open)
    and not exists (select 1 from public.ballots b where b.match_id = om.id and b.voter_player_id = mp.player_id)
    and not exists (select 1 from public.notification_log nl
                    where nl.match_id = om.id and nl.user_id = pr.user_id and nl.kind = om.kind)
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = pr.user_id)
$$;

create or replace function public.svc_mark_notified(p_user_ids uuid[], p_match_ids uuid[], p_kinds text[])
returns void
language sql security definer set search_path = '' as $$
  insert into public.notification_log (user_id, match_id, kind)
  select * from unnest(p_user_ids, p_match_ids, p_kinds)
  on conflict do nothing;
$$;

create or replace function public.svc_get_secret(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from public.app_secrets where key = p_key
$$;

create or replace function public.svc_set_secret(p_key text, p_value text, p_overwrite boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_overwrite then
    insert into public.app_secrets (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  else
    insert into public.app_secrets (key, value) values (p_key, p_value) on conflict do nothing;
  end if;
  return (select value from public.app_secrets where key = p_key);
end $$;

-- Appelée par pg_cron toutes les 10 minutes : réveille l'application
-- uniquement s'il y a des notifications à envoyer (via pg_net).
create or replace function public.dispatch_push_cron() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select value from public.app_secrets where key = 'site_url');
  v_token text := (select value from public.app_secrets where key = 'cron_token');
begin
  if v_url is null or v_token is null or to_regnamespace('net') is null then
    return;
  end if;
  if not exists (select 1 from public.svc_pending_notifications()) then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 30000)'
    using v_url || '/api/cron/notifications',
          jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json');
end $$;

-- Classement : les supporters (statut par défaut) sans points n'y figurent pas
create or replace function public.admin_season_standings(p_season_id uuid)
returns table (
  rank integer, player_id uuid, display_name text, active boolean,
  gross_points integer, penalty_points integer, net_points integer,
  matches_counted integer, late_count integer, nonvote_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_maitre();
  return query
  with m as (
    select id from public.matches
    where season_id = p_season_id and counts_for_ranking
  ),
  gross as (
    select s.selected_player_id as pid, sum(s.points)::integer as pts
    from public.ballot_selections s
    join public.ballots b on b.id = s.ballot_id and b.status = 'valide'
    join m on m.id = b.match_id
    group by 1
  ),
  pen as (
    select pe.player_id as pid, sum(pe.points)::integer as pts,
           count(*) filter (where pe.kind = 'non_vote')::integer as nonvote
    from public.penalties pe join m on m.id = pe.match_id
    where pe.status = 'active'
    group by 1
  ),
  lates as (
    select b.voter_player_id as pid, count(*)::integer as n
    from public.ballots b join m on m.id = b.match_id
    where b.is_late and b.status = 'valide'
    group by 1
  ),
  apps as (
    select mp.player_id as pid, count(*)::integer as n
    from public.match_players mp join m on m.id = mp.match_id
    where mp.role <> 'supporter'
    group by 1
  ),
  roster as (
    select pl0.id as pid from public.players pl0 where pl0.active and pl0.default_role <> 'supporter'
    union select pid from gross union select pid from apps
  ),
  t as (
    select r.pid, pl.display_name, pl.active,
           coalesce(g.pts, 0) as gross, coalesce(p.pts, 0) as pens,
           greatest(0, coalesce(g.pts, 0) - coalesce(p.pts, 0)) as net,
           coalesce(a.n, 0) as apps, coalesce(l.n, 0) as lates, coalesce(p.nonvote, 0) as nonvote
    from roster r
    join public.players pl on pl.id = r.pid
    left join gross g on g.pid = r.pid
    left join pen p on p.pid = r.pid
    left join lates l on l.pid = r.pid
    left join apps a on a.pid = r.pid
  )
  select (rank() over (order by t.net desc, t.gross desc))::integer,
         t.pid, t.display_name, t.active, t.gross, t.pens, t.net, t.apps, t.lates, t.nonvote
  from t
  order by t.net desc, t.gross desc, t.display_name;
end $$;

-- ---------------------------------------------------------------------
-- 6. Sécurité
-- ---------------------------------------------------------------------
alter table public.match_stats        enable row level security;
alter table public.app_secrets        enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security;

revoke all on public.match_stats, public.app_secrets, public.push_subscriptions, public.notification_log
  from anon, authenticated;
grant select on public.match_stats, public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.app_secrets, public.push_subscriptions, public.notification_log
  to service_role;

-- Statistiques visibles de tous les joueurs connectés (matchs non archivés)
create policy match_stats_read on public.match_stats for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id
                 and (not m.archived or (select public.is_maitre()))));
-- Chacun ne voit que ses propres abonnements
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
-- app_secrets et notification_log : aucune politique => aucun accès client.

-- La vue calendrier expose aussi le score
drop view if exists public.v_matches;
create view public.v_matches with (security_invoker = true) as
  select m.id, m.season_id, m.opponent, m.kickoff_at, m.location,
         m.vote_opens_at, m.vote_closes_at, m.vote_deadline,
         m.counts_for_ranking, m.archived, m.manual_state, m.manual_at,
         m.score_for, m.score_against,
         public.match_effective_state(m, now()) as effective_state
  from public.matches m;
grant select on public.v_matches to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.update_my_profile(text, boolean, date) to authenticated;
grant execute on function public.admin_save_player_full(uuid, text, text, boolean, date, smallint, public.player_role, boolean) to authenticated;
grant execute on function public.admin_set_match_sheet(uuid, uuid[], text[]) to authenticated;
grant execute on function public.admin_save_match_stats(uuid, smallint, smallint, jsonb) to authenticated;
grant execute on function public.admin_delete_match(uuid, text) to authenticated;
grant execute on function public.admin_import_matches(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_notification_settings(boolean, integer) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.admin_season_standings(uuid) to authenticated;
revoke execute on function public.svc_pending_notifications(), public.svc_mark_notified(uuid[], uuid[], text[]),
  public.svc_get_secret(text), public.svc_set_secret(text, text, boolean), public.dispatch_push_cron(),
  public.tg_player_names(), public.tg_match_player_role(), public.tg_selection_not_supporter()
  from authenticated;
grant execute on function public.svc_pending_notifications() to service_role;
grant execute on function public.svc_mark_notified(uuid[], uuid[], text[]) to service_role;
grant execute on function public.svc_get_secret(text) to service_role;
grant execute on function public.svc_set_secret(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------
-- 7. Planification des notifications (Supabase : pg_cron + pg_net)
-- ---------------------------------------------------------------------
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'aubel-push') then
      perform cron.unschedule('aubel-push');
    end if;
    perform cron.schedule('aubel-push', '*/10 * * * *', 'select public.dispatch_push_cron()');
  else
    raise notice 'pg_cron indisponible : rappels automatiques à configurer manuellement.';
  end if;
end
$outer$;
