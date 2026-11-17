-- Aubel Réserve B : MISE À JOUR du 17/11/2026 (base déjà en service, après celle du 29/10/2026).
-- À coller en une fois dans Supabase > SQL Editor, puis « Run ». À exécuter une seule fois,
-- AVANT de déposer le nouveau code sur GitHub. Aucune donnée existante n'est supprimée
-- (les buts, passes et cartons déjà encodés sont convertis en faits de match).

-- =====================================================================
-- Aubel Réserve B — 6 : améliorations du 17 novembre 2026
-- =====================================================================
--  * Rôle « entraîneur » : gestion des matchs sans accès aux votes
--  * Domicile / extérieur
--  * Disponibilités des joueurs et convocations (feuille validée)
--  * Faits de match en direct (buts, passes, cartons avec minute)
--  * Notifications : disponibilités, convocation, envoi programmé, diagnostic
-- S'applique sur une base en service, sans perte de données.
-- NB : la nouvelle valeur d'énumération « entraineur » n'est comparée que
-- sous forme de texte dans ce script (contrainte PostgreSQL).
-- =====================================================================

alter type public.app_role add value if not exists 'entraineur';

-- ---------------------------------------------------------------------
-- 1. Rôles : administrateur (maitre) et entraîneur
-- ---------------------------------------------------------------------
create or replace function public.is_staff() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active and p.role::text in ('maitre', 'entraineur')
  );
end $$;

create or replace function public.require_staff() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    perform public.err('FORBIDDEN');
  end if;
  return auth.uid();
end $$;

-- Les fonctions de gestion des matchs deviennent accessibles à l'entraîneur.
-- (On réécrit leur définition existante en remplaçant le contrôle de rôle.)
do $$
declare
  f text;
  def text;
begin
  foreach f in array array['admin_save_match', 'admin_set_vote_state', 'admin_set_archived',
                           'admin_set_match_players', 'admin_set_match_sheet']
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace;
    if def is null then
      raise exception 'Fonction % introuvable : appliquez d''abord les migrations précédentes.', f;
    end if;
    execute replace(def, 'public.require_maitre()', 'public.require_staff()');
  end loop;
end $$;

-- Changement de rôle d'un compte (administrateur uniquement, via le serveur)
create or replace function public.svc_set_account_role(p_actor uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform public.svc_require_maitre(p_actor);
  if p_role not in ('joueur', 'entraineur') then perform public.err('INVALID_ROLE'); end if;
  if p_actor = p_user_id then perform public.err('CANNOT_CHANGE_SELF'); end if;
  select role::text into v_before from public.profiles where user_id = p_user_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  if v_before = 'maitre' then perform public.err('CANNOT_CHANGE_ADMIN'); end if;
  update public.profiles set role = p_role::public.app_role where user_id = p_user_id;
  perform public.audit('compte.role', 'profile', p_user_id::text,
                       jsonb_build_object('role', v_before), jsonb_build_object('role', p_role), p_actor);
end $$;

-- ---------------------------------------------------------------------
-- 2. Domicile / extérieur, nom du club, réglages de notifications
-- ---------------------------------------------------------------------
alter table public.matches add column is_home boolean not null default true;
update public.matches
   set is_home = (location is null or location ilike '%aubel%');

alter table public.app_settings
  add column club_name text not null default 'Aubel' check (char_length(btrim(club_name)) between 1 and 30),
  add column notify_availability boolean not null default true,
  add column notify_convocation boolean not null default true;

create or replace function public.admin_set_match_home(p_match_id uuid, p_is_home boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_staff();
  v_before boolean;
begin
  select is_home into v_before from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  update public.matches set is_home = coalesce(p_is_home, true) where id = p_match_id;
  if v_before is distinct from coalesce(p_is_home, true) then
    perform public.audit('match.domicile', 'match', p_match_id::text,
                         jsonb_build_object('domicile', v_before), jsonb_build_object('domicile', p_is_home));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Disponibilités et convocations
-- ---------------------------------------------------------------------
create type public.availability_status as enum ('present', 'absent', 'incertain');

alter table public.matches
  add column sheet_validated_at timestamptz,
  add column sheet_validated_by uuid;

create table public.match_availability (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  status public.availability_status not null,
  comment text check (comment is null or char_length(comment) <= 140),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (match_id, player_id)
);
create index match_availability_player_idx on public.match_availability (player_id);

-- Ouverture des disponibilités : le lundi 9 h (heure belge) de la semaine
-- du match (pour un match le lundi : le lundi précédent).
create or replace function public.availability_opens_at(p_kickoff timestamptz) returns timestamptz
language sql immutable set search_path = '' as $$
  select (date_trunc('week', (p_kickoff at time zone 'Europe/Brussels') - interval '1 day') + interval '9 hours')
         at time zone 'Europe/Brussels'
$$;

create or replace function public.availability_state(p_match public.matches, p_at timestamptz default now())
returns text
language sql stable set search_path = '' as $$
  select case
    when p_match.archived then 'fermee'
    when p_match.sheet_validated_at is not null then 'validee'
    when p_at >= p_match.kickoff_at then 'fermee'
    when p_at < public.availability_opens_at(p_match.kickoff_at) then 'a_venir'
    else 'ouverte'
  end
$$;

create or replace function public.set_my_availability(p_match_id uuid, p_status text, p_comment text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid := public.my_player_id();
  v_match public.matches;
begin
  if v_player is null then perform public.err('NO_PLAYER'); end if;
  if p_status not in ('present', 'absent', 'incertain') then perform public.err('INVALID_STATUS'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then perform public.err('MATCH_NOT_FOUND'); end if;
  case public.availability_state(v_match, now())
    when 'a_venir' then perform public.err('AVAILABILITY_NOT_OPEN');
    when 'validee' then perform public.err('SHEET_VALIDATED');
    when 'fermee' then perform public.err('AVAILABILITY_CLOSED');
    else null;
  end case;
  insert into public.match_availability (match_id, player_id, status, comment, updated_at, updated_by)
  values (p_match_id, v_player, p_status::public.availability_status, nullif(btrim(coalesce(p_comment, '')), ''), now(), auth.uid())
  on conflict (match_id, player_id) do update
    set status = excluded.status, comment = excluded.comment, updated_at = now(), updated_by = auth.uid();
end $$;

-- L'entraîneur / l'administrateur peut noter la réponse d'un joueur
create or replace function public.admin_set_availability(p_match_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_staff();
begin
  if p_status is null then
    delete from public.match_availability where match_id = p_match_id and player_id = p_player_id;
    return;
  end if;
  if p_status not in ('present', 'absent', 'incertain') then perform public.err('INVALID_STATUS'); end if;
  insert into public.match_availability (match_id, player_id, status, updated_at, updated_by)
  values (p_match_id, p_player_id, p_status::public.availability_status, now(), v_actor)
  on conflict (match_id, player_id) do update
    set status = excluded.status, updated_at = now(), updated_by = v_actor;
end $$;

-- Valider (convoquer) ou rouvrir la feuille de match
create or replace function public.admin_validate_sheet(p_match_id uuid, p_validated boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_staff();
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  if p_validated and not exists (select 1 from public.match_players where match_id = p_match_id) then
    perform public.err('SHEET_EMPTY');
  end if;
  update public.matches
     set sheet_validated_at = case when p_validated then now() end,
         sheet_validated_by = case when p_validated then v_actor end
   where id = p_match_id;
  perform public.audit(case when p_validated then 'match.convocation' else 'match.convocation_annulee' end,
                       'match', p_match_id::text,
                       jsonb_build_object('validee', v_match.sheet_validated_at is not null),
                       jsonb_build_object('validee', p_validated,
                         'convoques', (select count(*) from public.match_players where match_id = p_match_id)));
end $$;

-- Indique seulement s'il existe des votes (sans rien en révéler) :
-- utile à l'entraîneur pour savoir si un match peut être supprimé.
create or replace function public.match_has_votes(p_match_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return exists (select 1 from public.ballots where match_id = p_match_id)
      or exists (select 1 from public.penalties where match_id = p_match_id);
end $$;

-- ---------------------------------------------------------------------
-- 4. Faits de match en direct
-- ---------------------------------------------------------------------
alter table public.matches
  add column live_status text check (live_status in ('premiere', 'mi_temps', 'seconde', 'termine')),
  add column live_started_at timestamptz,
  add column first_half_ended_at timestamptz,
  add column second_half_started_at timestamptz,
  add column live_ended_at timestamptz;

create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  -- but / but_adverse / jaune / rouge ; « passe » = passe décisive isolée (données antérieures)
  kind text not null check (kind in ('but', 'but_adverse', 'jaune', 'rouge', 'passe')),
  player_id uuid references public.players (id) on delete restrict,
  assist_player_id uuid references public.players (id) on delete restrict,
  minute smallint check (minute between 0 and 150),
  period smallint check (period in (1, 2)),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint match_events_assist check (assist_player_id is null or (kind = 'but' and assist_player_id is distinct from player_id)),
  constraint match_events_player check (kind in ('but', 'but_adverse') or player_id is not null),
  constraint match_events_adverse check (kind <> 'but_adverse' or (player_id is null and assist_player_id is null))
);
create index match_events_match_idx on public.match_events (match_id, minute);

-- Reconstruit les statistiques et le score d'un match à partir des faits
create or replace function public.recompute_match_facts(p_match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_has boolean;
begin
  delete from public.match_stats where match_id = p_match_id;
  insert into public.match_stats (match_id, player_id, goals, assists, yellow_cards, red_cards)
  select p_match_id, x.pid, sum(x.g), sum(x.a), least(sum(x.y), 2), least(sum(x.r), 1)
  from (
    select e.player_id as pid, (e.kind = 'but')::int as g, (e.kind = 'passe')::int as a,
           (e.kind = 'jaune')::int as y, (e.kind = 'rouge')::int as r
    from public.match_events e where e.match_id = p_match_id and e.player_id is not null
    union all
    select e.assist_player_id, 0, 1, 0, 0
    from public.match_events e where e.match_id = p_match_id and e.assist_player_id is not null
  ) x
  join public.match_players mp on mp.match_id = p_match_id and mp.player_id = x.pid
  group by x.pid
  having sum(x.g) + sum(x.a) + sum(x.y) + sum(x.r) > 0;

  select exists (select 1 from public.match_events where match_id = p_match_id) into v_has;
  update public.matches m
     set score_for = case when v_has or m.live_status is not null
                          then (select count(*) from public.match_events e where e.match_id = m.id and e.kind = 'but') end,
         score_against = case when v_has or m.live_status is not null
                          then (select count(*) from public.match_events e where e.match_id = m.id and e.kind = 'but_adverse') end
   where m.id = p_match_id;
end $$;

-- Reprise des statistiques déjà saisies (migration 5) sous forme de faits
insert into public.match_events (match_id, kind, player_id)
select s.match_id, k.kind, s.player_id
from public.match_stats s
cross join lateral (
  select 'but' as kind, generate_series(1, s.goals) as n
  union all select 'passe', generate_series(1, s.assists)
  union all select 'jaune', generate_series(1, s.yellow_cards)
  union all select 'rouge', generate_series(1, s.red_cards)
) k;
-- Buts sans buteur connu et buts adverses pour retrouver le score saisi
insert into public.match_events (match_id, kind)
select m.id, 'but' from public.matches m
cross join lateral generate_series(1, greatest(0, coalesce(m.score_for, 0)
  - (select count(*) from public.match_events e where e.match_id = m.id and e.kind = 'but')::int));
insert into public.match_events (match_id, kind)
select m.id, 'but_adverse' from public.matches m
cross join lateral generate_series(1, coalesce(m.score_against, 0));
update public.matches set live_status = 'termine' where score_for is not null or score_against is not null;

do $$
declare r record;
begin
  for r in select distinct match_id from public.match_events loop
    perform public.recompute_match_facts(r.match_id);
  end loop;
end $$;

create or replace function public.tg_match_events_recompute() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_match_facts(coalesce(new.match_id, old.match_id));
  return null;
end $$;

create trigger match_events_recompute
  after insert or update or delete on public.match_events
  for each row execute function public.tg_match_events_recompute();

-- Qui peut encoder les faits : administrateur, entraîneur, délégué
-- (statut par défaut ou statut sur la feuille de ce match)
create or replace function public.can_record_facts(p_match_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.is_staff() or exists (
    select 1 from public.profiles pr
    join public.players pl on pl.id = pr.player_id
    where pr.user_id = auth.uid() and pr.active
      and (pl.default_role = 'delegue'
           or exists (select 1 from public.match_players mp
                      where mp.match_id = p_match_id and mp.player_id = pl.id and mp.role = 'delegue'))
  );
end $$;

-- Chrono du match : start / halftime / second_half / end / reset
create or replace function public.live_control(p_match_id uuid, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_status text;
begin
  if not public.can_record_facts(p_match_id) then perform public.err('FORBIDDEN'); end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  v_status := v_match.live_status;
  case p_action
    when 'start' then
      if v_status is not null then perform public.err('LIVE_INVALID'); end if;
      update public.matches set live_status = 'premiere', live_started_at = now() where id = p_match_id;
    when 'halftime' then
      if v_status is distinct from 'premiere' then perform public.err('LIVE_INVALID'); end if;
      update public.matches set live_status = 'mi_temps', first_half_ended_at = now() where id = p_match_id;
    when 'second_half' then
      if v_status is distinct from 'mi_temps' then perform public.err('LIVE_INVALID'); end if;
      update public.matches set live_status = 'seconde', second_half_started_at = now() where id = p_match_id;
    when 'end' then
      if v_status not in ('premiere', 'mi_temps', 'seconde') then perform public.err('LIVE_INVALID'); end if;
      update public.matches set live_status = 'termine', live_ended_at = now() where id = p_match_id;
    when 'resume' then
      -- Fin déclarée par erreur : reprise de la seconde mi-temps
      if v_status is distinct from 'termine' or v_match.second_half_started_at is null then perform public.err('LIVE_INVALID'); end if;
      update public.matches set live_status = 'seconde', live_ended_at = null where id = p_match_id;
    when 'reset' then
      if exists (select 1 from public.match_events where match_id = p_match_id) then perform public.err('LIVE_HAS_EVENTS'); end if;
      update public.matches
         set live_status = null, live_started_at = null, first_half_ended_at = null,
             second_half_started_at = null, live_ended_at = null
       where id = p_match_id;
    else perform public.err('LIVE_INVALID');
  end case;
  perform public.recompute_match_facts(p_match_id);
  perform public.audit('match.direct.' || p_action, 'match', p_match_id::text,
                       jsonb_build_object('statut', v_status), null);
  return (select live_status from public.matches where id = p_match_id);
end $$;

-- Ajout d'un fait. Minute calculée par le serveur si non fournie (match en cours).
create or replace function public.add_match_event(
  p_match_id uuid, p_kind text, p_player_id uuid, p_assist_player_id uuid, p_minute integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_minute integer := p_minute;
  v_period smallint;
  v_id uuid;
begin
  if not public.can_record_facts(p_match_id) then perform public.err('FORBIDDEN'); end if;
  if p_kind not in ('but', 'but_adverse', 'jaune', 'rouge') then perform public.err('EVENT_INVALID'); end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;

  if p_kind = 'but_adverse' and (p_player_id is not null or p_assist_player_id is not null) then
    perform public.err('EVENT_INVALID');
  end if;
  if p_kind in ('jaune', 'rouge') and p_player_id is null then perform public.err('EVENT_PLAYER_REQUIRED'); end if;
  if p_assist_player_id is not null and (p_kind <> 'but' or p_assist_player_id = p_player_id) then
    perform public.err('EVENT_INVALID');
  end if;
  if exists (select 1 from unnest(array[p_player_id, p_assist_player_id]) x
             where x is not null and not exists (select 1 from public.match_players mp
                                                 where mp.match_id = p_match_id and mp.player_id = x)) then
    perform public.err('STATS_NOT_IN_SQUAD');
  end if;
  if p_kind = 'jaune' and (select count(*) from public.match_events
                           where match_id = p_match_id and player_id = p_player_id and kind = 'jaune') >= 2 then
    perform public.err('STATS_INVALID');
  end if;
  if p_kind = 'rouge' and exists (select 1 from public.match_events
                                  where match_id = p_match_id and player_id = p_player_id and kind = 'rouge') then
    perform public.err('STATS_INVALID');
  end if;

  -- Minute et période
  if v_minute is null then
    case v_match.live_status
      when 'premiere' then
        v_minute := floor(extract(epoch from now() - v_match.live_started_at) / 60)::int + 1; v_period := 1;
      when 'mi_temps' then v_minute := 45; v_period := 1;
      when 'seconde' then
        v_minute := 45 + floor(extract(epoch from now() - v_match.second_half_started_at) / 60)::int + 1; v_period := 2;
      else null;
    end case;
  else
    v_period := case when v_match.live_status in ('seconde') or v_minute > 45 then 2
                     when v_match.live_status in ('premiere', 'mi_temps') then 1 end;
  end if;
  if v_minute is not null and v_minute not between 0 and 150 then perform public.err('EVENT_MINUTE'); end if;

  insert into public.match_events (match_id, kind, player_id, assist_player_id, minute, period, created_by)
  values (p_match_id, p_kind, p_player_id, p_assist_player_id, v_minute, v_period, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_match_event_minute(p_event_id uuid, p_minute integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_match uuid;
begin
  select match_id into v_match from public.match_events where id = p_event_id;
  if v_match is null then perform public.err('NOT_FOUND'); end if;
  if not public.can_record_facts(v_match) then perform public.err('FORBIDDEN'); end if;
  if p_minute is not null and p_minute not between 0 and 150 then perform public.err('EVENT_MINUTE'); end if;
  update public.match_events set minute = p_minute,
         period = case when p_minute is null then period when p_minute > 45 then 2 else coalesce(period, 1) end
   where id = p_event_id;
end $$;

create or replace function public.delete_match_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event public.match_events;
begin
  select * into v_event from public.match_events where id = p_event_id;
  if not found then perform public.err('NOT_FOUND'); end if;
  if not public.can_record_facts(v_event.match_id) then perform public.err('FORBIDDEN'); end if;
  delete from public.match_events where id = p_event_id;
  perform public.audit('match.fait.suppression', 'match', v_event.match_id::text, to_jsonb(v_event), null);
end $$;

-- L'ancienne saisie globale des statistiques est remplacée par les faits
drop function if exists public.admin_save_match_stats(uuid, smallint, smallint, jsonb);

-- ---------------------------------------------------------------------
-- 5. Suppression et import (versions mises à jour)
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_match(p_match_id uuid, p_confirm text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_staff();
  v_match public.matches;
  v_has_votes boolean;
  v_has_data boolean;
  v_snapshot jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  v_has_votes := exists (select 1 from public.ballots where match_id = p_match_id)
              or exists (select 1 from public.penalties where match_id = p_match_id);
  v_has_data := v_has_votes or exists (select 1 from public.match_events where match_id = p_match_id);
  -- Effacer des votes modifie le classement : réservé à l'administrateur
  if v_has_votes and not public.is_maitre() then perform public.err('ADMIN_ONLY'); end if;
  if v_has_data and coalesce(p_confirm, '') <> 'SUPPRIMER' then perform public.err('CONFIRM_REQUIRED'); end if;

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
    'statistiques', (select coalesce(jsonb_agg(to_jsonb(st)), '[]') from public.match_stats st where st.match_id = p_match_id),
    'faits', (select coalesce(jsonb_agg(to_jsonb(e) order by e.minute), '[]') from public.match_events e where e.match_id = p_match_id),
    'disponibilites', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.match_availability a where a.match_id = p_match_id)
  );

  delete from public.ballots where match_id = p_match_id;
  delete from public.penalties where match_id = p_match_id;
  delete from public.matches where id = p_match_id;   -- feuille, faits, stats, dispos, notifications en cascade
  perform public.audit('match.suppression', 'match', p_match_id::text, v_snapshot, null);
end $$;

create or replace function public.admin_import_matches(p_season_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_staff();
  r jsonb;
  v_id uuid;
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
    v_id := public.admin_save_match(
      null, p_season_id, r->>'opponent', (r->>'kickoff')::timestamp, r->>'location',
      nullif(r->>'opens', '')::timestamp, nullif(r->>'closes', '')::timestamp,
      (r->>'deadline')::timestamp, coalesce((r->>'counts')::boolean, true));
    update public.matches set is_home = coalesce((r->>'home')::boolean, true) where id = v_id;
    v_created := v_created + 1;
  end loop;
  perform public.audit('calendrier.import', 'season', p_season_id::text, null,
                       jsonb_build_object('crees', v_created, 'ignores_doublons', v_skipped));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------
-- 6. Notifications : nouveaux types, envois programmés, diagnostic
-- ---------------------------------------------------------------------
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log
  add constraint notification_log_kind_check check (kind in ('ouverture', 'rappel', 'dispo', 'convocation'));

create or replace function public.admin_save_notification_prefs(
  p_notify_on_open boolean, p_reminder_hours integer, p_notify_availability boolean, p_notify_convocation boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.app_settings;
begin
  if p_reminder_hours is null or p_reminder_hours not between 0 and 72 then perform public.err('INVALID_REMINDER'); end if;
  select * into v_before from public.app_settings where id = 1 for update;
  update public.app_settings
     set notify_on_open = coalesce(p_notify_on_open, true), reminder_hours = p_reminder_hours,
         notify_availability = coalesce(p_notify_availability, true),
         notify_convocation = coalesce(p_notify_convocation, true),
         updated_at = now(), updated_by = v_actor
   where id = 1;
  perform public.audit('config.notifications', 'app_settings', '1',
    jsonb_build_object('ouverture', v_before.notify_on_open, 'rappel_h', v_before.reminder_hours,
                       'dispo', v_before.notify_availability, 'convocation', v_before.notify_convocation),
    jsonb_build_object('ouverture', p_notify_on_open, 'rappel_h', p_reminder_hours,
                       'dispo', p_notify_availability, 'convocation', p_notify_convocation));
end $$;

create or replace function public.admin_save_club_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.require_maitre();
begin
  if coalesce(btrim(p_name), '') = '' or char_length(btrim(p_name)) > 30 then perform public.err('NAME_REQUIRED'); end if;
  update public.app_settings set club_name = btrim(p_name), updated_at = now(), updated_by = v_actor where id = 1;
end $$;

drop function if exists public.svc_pending_notifications();
create or replace function public.svc_pending_notifications()
returns table (user_id uuid, match_id uuid, kind text, opponent text, is_home boolean,
               kickoff_at timestamptz, vote_deadline timestamptz)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.app_settings where id = 1),
  candidates as (
    -- Vote ouvert / rappel avant l'heure limite (joueurs de la feuille sans bulletin)
    select pr.user_id, m.id as match_id,
           case when s.reminder_hours > 0 and now() >= m.vote_deadline - make_interval(hours => s.reminder_hours)
                then 'rappel' else 'ouverture' end as kind
    from public.matches m cross join s
    join public.match_players mp on mp.match_id = m.id
    join public.profiles pr on pr.player_id = mp.player_id and pr.active
    where public.match_effective_state(m, now()) = 'ouvert' and now() < m.vote_deadline
      and not exists (select 1 from public.ballots b where b.match_id = m.id and b.voter_player_id = mp.player_id)
      and (s.notify_on_open or (s.reminder_hours > 0 and now() >= m.vote_deadline - make_interval(hours => s.reminder_hours)))
    union all
    -- Disponibilités ouvertes (joueurs actifs sans réponse)
    select pr.user_id, m.id, 'dispo'
    from public.matches m cross join s
    join public.profiles pr on pr.active and pr.player_id is not null
    join public.players pl on pl.id = pr.player_id and pl.active
    where s.notify_availability and public.availability_state(m, now()) = 'ouverte'
      and not exists (select 1 from public.match_availability a where a.match_id = m.id and a.player_id = pl.id)
    union all
    -- Convocation (feuille validée)
    select pr.user_id, m.id, 'convocation'
    from public.matches m cross join s
    join public.match_players mp on mp.match_id = m.id
    join public.profiles pr on pr.player_id = mp.player_id and pr.active
    where s.notify_convocation and m.sheet_validated_at is not null and not m.archived and now() < m.kickoff_at
  )
  select c.user_id, c.match_id, c.kind, m.opponent, m.is_home, m.kickoff_at, m.vote_deadline
  from candidates c
  join public.matches m on m.id = c.match_id
  where not exists (select 1 from public.notification_log nl
                    where nl.match_id = c.match_id and nl.user_id = c.user_id and nl.kind = c.kind)
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = c.user_id)
$$;

-- Notifications libres (immédiates ou programmées) par l'administrateur
create table public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 200),
  url text not null default '/' check (url ~ '^/[^/]'
                                       or url = '/'),
  audience text not null check (audience in ('tous', 'feuille', 'moi')),
  match_id uuid references public.matches (id) on delete cascade,
  send_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_count integer,
  failed_count integer,
  cancelled boolean not null default false,
  constraint scheduled_notifications_match check (audience <> 'feuille' or match_id is not null)
);
create index scheduled_notifications_due_idx on public.scheduled_notifications (send_at) where claimed_at is null and not cancelled;

create or replace function public.admin_schedule_notification(
  p_title text, p_body text, p_audience text, p_match_id uuid, p_send_local timestamp, p_url text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_id uuid;
  v_at timestamptz := coalesce(public.brussels(p_send_local), now());
begin
  if v_at > now() + interval '120 days' then perform public.err('SCHEDULE_TOO_FAR'); end if;
  insert into public.scheduled_notifications (title, body, url, audience, match_id, send_at, created_by)
  values (btrim(p_title), btrim(p_body), coalesce(nullif(btrim(p_url), ''), '/'), p_audience, p_match_id,
          greatest(v_at, now()), v_actor)
  returning id into v_id;
  perform public.audit('notification.programmee', 'notification', v_id::text, null,
                       jsonb_build_object('titre', btrim(p_title), 'public', p_audience, 'envoi', v_at));
  return v_id;
end $$;

create or replace function public.admin_cancel_notification(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.require_maitre();
begin
  update public.scheduled_notifications set cancelled = true where id = p_id and claimed_at is null;
  if not found then perform public.err('NOT_FOUND'); end if;
end $$;

-- Réserve atomiquement les notifications dues (aucun double envoi)
create or replace function public.svc_claim_scheduled_notifications()
returns setof public.scheduled_notifications
language sql security definer set search_path = '' as $$
  update public.scheduled_notifications
     set claimed_at = now()
   where id in (select id from public.scheduled_notifications
                where claimed_at is null and not cancelled and send_at <= now()
                order by send_at limit 20 for update skip locked)
  returning *
$$;

create or replace function public.svc_scheduled_recipients(p_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pr.user_id from public.scheduled_notifications n
  join public.profiles pr on pr.active
  left join public.players pl on pl.id = pr.player_id
  where n.id = p_id
    and (n.audience = 'tous'
         or (n.audience = 'moi' and pr.user_id = n.created_by)
         or (n.audience = 'feuille' and exists (select 1 from public.match_players mp
                                                where mp.match_id = n.match_id and mp.player_id = pr.player_id)))
$$;

create or replace function public.svc_finish_scheduled(p_id uuid, p_sent integer, p_failed integer) returns void
language sql security definer set search_path = '' as $$
  update public.scheduled_notifications set sent_count = p_sent, failed_count = p_failed where id = p_id;
$$;

-- Réveil par pg_cron : seulement s'il y a quelque chose à envoyer
create or replace function public.dispatch_push_cron() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select value from public.app_secrets where key = 'site_url');
  v_token text := (select value from public.app_secrets where key = 'cron_token');
begin
  if v_url is null or v_token is null or to_regnamespace('net') is null then
    return;
  end if;
  if not exists (select 1 from public.svc_pending_notifications())
     and not exists (select 1 from public.scheduled_notifications
                     where claimed_at is null and not cancelled and send_at <= now()) then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 30000)'
    using v_url || '/api/cron/notifications',
          jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json');
end $$;

-- État du système de notifications (page administrateur)
create or replace function public.svc_notification_diagnostics() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := '{}';
  v_tmp jsonb;
begin
  v := v || jsonb_build_object(
    'site_url', (select value from public.app_secrets where key = 'site_url'),
    'cron_token', exists (select 1 from public.app_secrets where key = 'cron_token'),
    'vapid', exists (select 1 from public.app_secrets where key = 'vapid_public'),
    'abonnes', (select count(distinct user_id) from public.push_subscriptions),
    'appareils', (select count(*) from public.push_subscriptions),
    'en_attente', (select count(*) from public.svc_pending_notifications()),
    'programmees', (select count(*) from public.scheduled_notifications where claimed_at is null and not cancelled),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'));
  if to_regclass('cron.job') is not null then
    execute $q$select jsonb_build_object('present', count(*) > 0, 'actif', coalesce(bool_and(active), false), 'planning', max(schedule))
               from cron.job where jobname = 'aubel-push'$q$ into v_tmp;
    v := v || jsonb_build_object('tache', v_tmp);
  end if;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select coalesce(jsonb_agg(x), '[]') from (
                 select d.status, d.return_message, d.start_time from cron.job_run_details d
                 join cron.job j on j.jobid = d.jobid where j.jobname = 'aubel-push'
                 order by d.start_time desc limit 3) x$q$ into v_tmp;
    v := v || jsonb_build_object('executions', v_tmp);
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$select coalesce(jsonb_agg(x), '[]') from (
                 select status_code, timed_out, error_msg, created from net._http_response
                 order by created desc limit 5) x$q$ into v_tmp;
    v := v || jsonb_build_object('appels', v_tmp);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 7. Sécurité
-- ---------------------------------------------------------------------
alter table public.match_availability      enable row level security;
alter table public.match_events            enable row level security;
alter table public.scheduled_notifications enable row level security;
revoke all on public.match_availability, public.match_events, public.scheduled_notifications from anon, authenticated;
grant select on public.match_availability, public.match_events, public.scheduled_notifications to authenticated;
grant select, insert, update, delete on public.scheduled_notifications to service_role;

-- Disponibilités et faits de match : visibles par toute l'équipe
create policy match_availability_read on public.match_availability for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (not m.archived or (select public.is_staff()))));
create policy match_events_read on public.match_events for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (not m.archived or (select public.is_staff()))));
create policy scheduled_notifications_read on public.scheduled_notifications for select to authenticated
  using ((select public.is_maitre()));

-- L'entraîneur voit aussi les matchs archivés (gestion)
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select to authenticated
  using (not archived or (select public.is_staff()));
drop policy if exists match_players_read on public.match_players;
create policy match_players_read on public.match_players for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (not m.archived or (select public.is_staff()))));
drop policy if exists match_stats_read on public.match_stats;
create policy match_stats_read on public.match_stats for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (not m.archived or (select public.is_staff()))));

-- Vue calendrier enrichie
drop view if exists public.v_matches;
create view public.v_matches with (security_invoker = true) as
  select m.id, m.season_id, m.opponent, m.kickoff_at, m.location, m.is_home,
         m.vote_opens_at, m.vote_closes_at, m.vote_deadline,
         m.counts_for_ranking, m.archived, m.manual_state, m.manual_at,
         m.score_for, m.score_against,
         m.live_status, m.live_started_at, m.first_half_ended_at, m.second_half_started_at, m.live_ended_at,
         m.sheet_validated_at,
         public.availability_opens_at(m.kickoff_at) as availability_opens_at,
         public.availability_state(m, now()) as availability_state,
         public.match_effective_state(m, now()) as effective_state,
         (select st.club_name from public.app_settings st where st.id = 1) as club_name
  from public.matches m;
grant select on public.v_matches to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.can_record_facts(uuid) to authenticated;
grant execute on function public.availability_opens_at(timestamptz) to authenticated;
grant execute on function public.availability_state(public.matches, timestamptz) to authenticated;
grant execute on function public.set_my_availability(uuid, text, text) to authenticated;
grant execute on function public.admin_set_availability(uuid, uuid, text) to authenticated;
grant execute on function public.admin_validate_sheet(uuid, boolean) to authenticated;
grant execute on function public.match_has_votes(uuid) to authenticated;
grant execute on function public.admin_set_match_home(uuid, boolean) to authenticated;
grant execute on function public.live_control(uuid, text) to authenticated;
grant execute on function public.add_match_event(uuid, text, uuid, uuid, integer) to authenticated;
grant execute on function public.update_match_event_minute(uuid, integer) to authenticated;
grant execute on function public.delete_match_event(uuid) to authenticated;
grant execute on function public.admin_delete_match(uuid, text) to authenticated;
grant execute on function public.admin_import_matches(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_notification_prefs(boolean, integer, boolean, boolean) to authenticated;
grant execute on function public.admin_save_club_name(text) to authenticated;
grant execute on function public.admin_schedule_notification(text, text, text, uuid, timestamp, text) to authenticated;
grant execute on function public.admin_cancel_notification(uuid) to authenticated;
revoke execute on function public.require_staff(), public.recompute_match_facts(uuid), public.tg_match_events_recompute(),
  public.svc_pending_notifications(), public.svc_claim_scheduled_notifications(), public.svc_scheduled_recipients(uuid),
  public.svc_finish_scheduled(uuid, integer, integer), public.svc_notification_diagnostics(),
  public.svc_set_account_role(uuid, uuid, text), public.dispatch_push_cron()
  from authenticated;
grant execute on function public.svc_pending_notifications() to service_role;
grant execute on function public.svc_claim_scheduled_notifications() to service_role;
grant execute on function public.svc_scheduled_recipients(uuid) to service_role;
grant execute on function public.svc_finish_scheduled(uuid, integer, integer) to service_role;
grant execute on function public.svc_notification_diagnostics() to service_role;
grant execute on function public.svc_set_account_role(uuid, uuid, text) to service_role;
