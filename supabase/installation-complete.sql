-- Aubel Réserve B : installation complète de la base (4 migrations).
-- À coller en une fois dans Supabase > SQL Editor, puis « Run ».

-- ===== 20261026000001_schema.sql =====
-- =====================================================================
-- Aubel Réserve B — 1/4 : schéma relationnel, contraintes et index
-- =====================================================================
-- Conventions :
--  * Toutes les dates/heures sont stockées en timestamptz (UTC en interne)
--    et interprétées/affichées dans le fuseau Europe/Brussels.
--  * Les joueurs (table players) sont distincts des comptes (profiles) :
--    l'historique d'un joueur survit à la désactivation de son compte.
--  * Aucune écriture directe n'est autorisée aux clients : toutes les
--    modifications passent par des fonctions SECURITY DEFINER (fichier 2/4).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.app_role as enum ('maitre', 'joueur');
create type public.vote_state as enum ('a_venir', 'ouvert', 'ferme');
create type public.penalty_kind as enum ('retard', 'non_vote');

-- ---------------------------------------------------------------------
-- Configuration (ligne unique)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  team_name text not null default 'Aubel Réserve B',
  timezone text not null default 'Europe/Brussels',
  late_penalty_enabled boolean not null default true,
  late_penalty_points integer not null default 2 check (late_penalty_points between 1 and 50),
  nonvote_penalty_enabled boolean not null default false,
  nonvote_penalty_points integer not null default 2 check (nonvote_penalty_points between 1 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.app_settings (id) values (1);

comment on table public.app_settings is
  'Paramètres globaux. Barème fixe 3/2/1. Classement : points nets puis points bruts, égalité conservée ensuite.';

-- ---------------------------------------------------------------------
-- Saisons
-- ---------------------------------------------------------------------
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_name_unique unique (name),
  constraint seasons_dates_check check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
-- Une seule saison courante à la fois
create unique index seasons_one_current on public.seasons (is_current) where is_current;

-- ---------------------------------------------------------------------
-- Joueurs (effectif) et comptes (profils)
-- ---------------------------------------------------------------------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  shirt_number smallint check (shirt_number between 1 and 99),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_display_name_unique on public.players (lower(btrim(display_name)));

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null,
  role public.app_role not null default 'joueur',
  player_id uuid references public.players (id) on delete restrict,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  constraint profiles_username_format check (username::text ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  constraint profiles_player_unique unique (player_id),
  -- Un compte joueur est toujours rattaché à un joueur de l'effectif.
  constraint profiles_joueur_has_player check (role = 'maitre' or player_id is not null)
);

-- ---------------------------------------------------------------------
-- Matchs
-- ---------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete restrict,
  opponent text not null check (char_length(btrim(opponent)) between 1 and 80),
  kickoff_at timestamptz not null,
  location text check (location is null or char_length(location) <= 120),
  -- État matérialisé (cache) ; la vérité est match_effective_state()
  vote_state public.vote_state not null default 'a_venir',
  vote_opens_at timestamptz,          -- ouverture automatique programmée (facultative)
  vote_closes_at timestamptz,         -- fermeture automatique programmée (facultative)
  vote_deadline timestamptz not null, -- heure limite : au-delà, bulletin tardif
  manual_state public.vote_state,     -- dernière action manuelle du maître
  manual_at timestamptz,
  opened_at timestamptz,              -- première ouverture effective constatée
  counts_for_ranking boolean not null default true,
  archived boolean not null default false,
  closure_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_window_check check (
    vote_opens_at is null or vote_closes_at is null or vote_closes_at > vote_opens_at
  ),
  constraint matches_manual_check check ((manual_state is null) = (manual_at is null))
);
create index matches_season_kickoff_idx on public.matches (season_id, kickoff_at);
create index matches_schedule_idx on public.matches (vote_state, vote_opens_at, vote_closes_at);

-- Feuille de match : joueurs présents (seuls autorisés à voter et à être choisis)
create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index match_players_player_idx on public.match_players (player_id);

-- ---------------------------------------------------------------------
-- Bulletins et sélections
-- ---------------------------------------------------------------------
create table public.ballots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete restrict,
  voter_player_id uuid not null references public.players (id) on delete restrict,
  first_submitted_at timestamptz not null,   -- horodatage serveur, jamais l'appareil
  last_modified_at timestamptz not null,
  is_late boolean not null,                  -- figé à la première soumission
  status text not null default 'valide' check (status in ('valide', 'annule')),
  version integer not null default 1 check (version >= 1),
  last_modified_by uuid,
  -- Un seul bulletin par joueur et par match : verrou anti-doublon
  constraint ballots_one_per_voter unique (match_id, voter_player_id),
  constraint ballots_times_check check (last_modified_at >= first_submitted_at)
);
create index ballots_voter_idx on public.ballots (voter_player_id);

create table public.ballot_selections (
  ballot_id uuid not null references public.ballots (id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  selected_player_id uuid not null references public.players (id) on delete restrict,
  points smallint generated always as (4 - rank) stored,   -- 3, 2, 1
  primary key (ballot_id, rank),
  constraint ballot_selections_distinct unique (ballot_id, selected_player_id)
);
create index ballot_selections_selected_idx on public.ballot_selections (selected_player_id);

-- Historique de toutes les versions validées (traçabilité, maître uniquement)
create table public.ballot_versions (
  id bigint generated always as identity primary key,
  ballot_id uuid not null references public.ballots (id) on delete cascade,
  version integer not null,
  selections uuid[] not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid,
  source text not null check (source in ('joueur', 'correction')),
  reason text,
  constraint ballot_versions_unique unique (ballot_id, version)
);

-- ---------------------------------------------------------------------
-- Malus (un au plus par joueur et par match)
-- ---------------------------------------------------------------------
create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  kind public.penalty_kind not null,
  points integer not null check (points > 0),
  status text not null default 'active' check (status in ('active', 'annulee')),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid,               -- null = appliqué automatiquement par le système
  updated_at timestamptz not null default now(),
  constraint penalties_one_per_match unique (match_id, player_id)
);
create index penalties_player_idx on public.penalties (player_id);

-- ---------------------------------------------------------------------
-- Journal d'audit (insertion seule)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_label text,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------
-- Tentatives de connexion (anti force brute), accès service uniquement
-- ---------------------------------------------------------------------
create table public.login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip text,
  success boolean not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_username_idx on public.login_attempts (username, attempted_at desc);
create index login_attempts_ip_idx on public.login_attempts (ip, attempted_at desc);

-- ---------------------------------------------------------------------
-- Triggers d'intégrité
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger players_touch before update on public.players
  for each row execute function public.tg_touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();
create trigger matches_touch before update on public.matches
  for each row execute function public.tg_touch_updated_at();
create trigger penalties_touch before update on public.penalties
  for each row execute function public.tg_touch_updated_at();

-- Interdiction de voter pour soi-même, même en cas d'écriture directe
create or replace function public.tg_selection_not_self() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.ballots b
    where b.id = new.ballot_id and b.voter_player_id = new.selected_player_id
  ) then
    raise exception 'SELF_VOTE' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger ballot_selections_not_self
  before insert or update on public.ballot_selections
  for each row execute function public.tg_selection_not_self();

-- Un bulletin valide contient exactement 3 sélections (vérifié en fin de transaction)
create or replace function public.tg_ballot_has_three() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_ballot uuid;
  v_count integer;
begin
  if tg_table_name = 'ballots' then
    v_ballot := new.id;
  elsif tg_op = 'DELETE' then
    v_ballot := old.ballot_id;
  else
    v_ballot := new.ballot_id;
  end if;
  if not exists (select 1 from public.ballots where id = v_ballot and status = 'valide') then
    return null;
  end if;
  select count(*) into v_count from public.ballot_selections where ballot_id = v_ballot;
  if v_count <> 3 then
    raise exception 'BALLOT_NEEDS_THREE' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger ballot_selections_three
  after insert or update or delete on public.ballot_selections
  deferrable initially deferred
  for each row execute function public.tg_ballot_has_three();

create constraint trigger ballots_three
  after insert or update on public.ballots
  deferrable initially deferred
  for each row execute function public.tg_ballot_has_three();

-- Le journal d'audit est immuable
create or replace function public.tg_audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'AUDIT_IMMUTABLE' using errcode = 'P0001';
end $$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.tg_audit_immutable();

-- ===== 20261026000002_functions.sql =====
-- =====================================================================
-- Aubel Réserve B — 2/4 : logique métier (fonctions transactionnelles)
-- =====================================================================
-- Toutes les fonctions SECURITY DEFINER fixent search_path = '' et
-- qualifient chaque objet, pour éviter tout détournement de schéma.
-- Les erreurs sont levées avec un code court (ex. VOTE_CLOSED) traduit
-- en français par l'application.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aides générales
-- ---------------------------------------------------------------------
create or replace function public.err(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001';
end $$;

-- Conversion d'une heure locale belge (saisie du maître) en instant absolu.
-- Heure inexistante (passage à l'heure d'été) : décalée d'une heure plus tard.
-- Heure ambiguë (passage à l'heure d'hiver) : seconde occurrence (heure d'hiver).
create or replace function public.brussels(p_local timestamp) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when p_local is null then null else p_local at time zone 'Europe/Brussels' end
$$;

create or replace function public.is_maitre() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'maitre' and p.active
  )
$$;

create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.player_id from public.profiles p
  where p.user_id = auth.uid() and p.active
$$;

create or replace function public.require_maitre() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_maitre() then
    perform public.err('FORBIDDEN');
  end if;
  return auth.uid();
end $$;

-- Pour les fonctions appelées par le serveur avec la clé service :
-- l'identité du maître est transmise explicitement puis vérifiée.
create or replace function public.svc_require_maitre(p_actor uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (
    select 1 from public.profiles p
    where p.user_id = p_actor and p.role = 'maitre' and p.active
  ) then
    perform public.err('FORBIDDEN');
  end if;
end $$;

create or replace function public.audit(
  p_action text, p_entity text, p_entity_id text,
  p_before jsonb, p_after jsonb, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  insert into public.audit_log (actor_user_id, actor_label, action, entity, entity_id, before_data, after_data)
  values (
    v_actor,
    coalesce((select p.username::text from public.profiles p where p.user_id = v_actor), 'système'),
    p_action, p_entity, p_entity_id, p_before, p_after
  );
end $$;

-- ---------------------------------------------------------------------
-- État du vote
-- ---------------------------------------------------------------------
-- Règle de combinaison manuel/automatique : l'événement le plus récent
-- déjà survenu l'emporte (ouverture programmée, fermeture programmée,
-- action manuelle). À instant égal, l'action manuelle prévaut.
create or replace function public.compute_vote_state(
  p_opens timestamptz, p_closes timestamptz,
  p_manual_state public.vote_state, p_manual_at timestamptz,
  p_at timestamptz
) returns public.vote_state
language plpgsql immutable set search_path = '' as $$
declare
  v_t timestamptz;
  v_state public.vote_state := 'a_venir';
begin
  if p_opens is not null and p_opens <= p_at then
    v_t := p_opens; v_state := 'ouvert';
  end if;
  if p_closes is not null and p_closes <= p_at and (v_t is null or p_closes >= v_t) then
    v_t := p_closes; v_state := 'ferme';
  end if;
  if p_manual_state is not null and p_manual_at <= p_at and (v_t is null or p_manual_at >= v_t) then
    v_state := p_manual_state;
  end if;
  return v_state;
end $$;

create or replace function public.match_effective_state(p_match public.matches, p_at timestamptz default now())
returns public.vote_state
language sql stable set search_path = '' as $$
  select case
    when p_match.archived then 'ferme'::public.vote_state
    else public.compute_vote_state(p_match.vote_opens_at, p_match.vote_closes_at,
                                   p_match.manual_state, p_match.manual_at, p_at)
  end
$$;

-- Applique les malus de non-vote à la clôture (si activés et si le vote a été ouvert)
create or replace function public.apply_closure(p_match_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.app_settings;
  v_match public.matches;
  v_count integer := 0;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.closure_processed_at is not null then
    return 0;
  end if;
  -- Pas de malus de non-vote si le vote n'a jamais été ouvert
  if v_match.opened_at is null
     and not exists (select 1 from public.ballots where match_id = p_match_id) then
    update public.matches set closure_processed_at = now() where id = p_match_id;
    return 0;
  end if;
  select * into v_settings from public.app_settings where id = 1;
  if v_settings.nonvote_penalty_enabled then
    with ins as (
      insert into public.penalties (match_id, player_id, kind, points, reason)
      select mp.match_id, mp.player_id, 'non_vote', v_settings.nonvote_penalty_points,
             'Aucun bulletin à la fermeture du vote'
      from public.match_players mp
      where mp.match_id = p_match_id
        and not exists (
          select 1 from public.ballots b
          where b.match_id = mp.match_id and b.voter_player_id = mp.player_id and b.status = 'valide'
        )
      on conflict (match_id, player_id) do nothing
      returning 1
    )
    select count(*) into v_count from ins;
  end if;
  update public.matches set closure_processed_at = now() where id = p_match_id;
  if v_count > 0 then
    perform public.audit('penalite.non_vote.auto', 'match', p_match_id::text, null,
                         jsonb_build_object('malus_appliques', v_count, 'points', v_settings.nonvote_penalty_points),
                         null);
  end if;
  return v_count;
end $$;

-- Matérialise l'état d'un match et déclenche les traitements de transition
create or replace function public.refresh_match_state(p_match_id uuid) returns public.vote_state
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches;
  v_state public.vote_state;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then return null; end if;
  v_state := public.match_effective_state(v_match, now());

  if v_state = 'ouvert' then
    update public.matches
       set opened_at = coalesce(opened_at, now()),
           closure_processed_at = null,
           vote_state = v_state
     where id = p_match_id
       and (vote_state is distinct from v_state or opened_at is null or closure_processed_at is not null);
  elsif v_state = 'ferme' then
    -- Ouverture programmée puis fermeture survenues entre deux passages du planificateur
    if v_match.opened_at is null and v_match.vote_opens_at is not null
       and v_match.vote_opens_at <= now() and not v_match.archived then
      update public.matches set opened_at = vote_opens_at where id = p_match_id;
    end if;
    update public.matches set vote_state = v_state
     where id = p_match_id and vote_state is distinct from v_state;
    perform public.apply_closure(p_match_id);
  else
    update public.matches set vote_state = v_state
     where id = p_match_id and vote_state is distinct from v_state;
  end if;
  return v_state;
end $$;

-- Planificateur (pg_cron, chaque minute) : ouvertures/fermetures automatiques
create or replace function public.process_vote_schedule() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select m.id from public.matches m
    where m.vote_state is distinct from public.match_effective_state(m, now())
       or (public.match_effective_state(m, now()) = 'ferme' and m.closure_processed_at is null)
       or (m.opened_at is null and m.vote_opens_at is not null and m.vote_opens_at <= now() and not m.archived)
  loop
    perform public.refresh_match_state(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- VOTE D'UN JOUEUR (transaction atomique)
-- ---------------------------------------------------------------------
create or replace function public.submit_ballot(p_match_id uuid, p_selections uuid[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_player uuid;
  v_match public.matches;
  v_now timestamptz;
  v_ballot public.ballots;
  v_settings public.app_settings;
  v_is_new boolean;
  i integer;
begin
  if v_uid is null then perform public.err('AUTH_REQUIRED'); end if;

  select p.player_id into v_player from public.profiles p
  where p.user_id = v_uid and p.active;
  if v_player is null then perform public.err('NO_PLAYER'); end if;

  -- Verrou partagé : sérialise avec les modifications du match par le maître
  select * into v_match from public.matches where id = p_match_id for share;
  if not found then perform public.err('MATCH_NOT_FOUND'); end if;

  -- Horodatage officiel : horloge du serveur de base de données
  v_now := clock_timestamp();

  if public.match_effective_state(v_match, v_now) <> 'ouvert' then
    perform public.err('VOTE_CLOSED');
  end if;

  if not exists (select 1 from public.match_players
                 where match_id = p_match_id and player_id = v_player) then
    perform public.err('NOT_IN_SQUAD');
  end if;

  if p_selections is null or coalesce(array_length(p_selections, 1), 0) <> 3
     or array_position(p_selections, null) is not null then
    perform public.err('NEED_THREE');
  end if;
  if (select count(distinct x) from unnest(p_selections) x) <> 3 then
    perform public.err('DUPLICATE_SELECTION');
  end if;
  if v_player = any (p_selections) then
    perform public.err('SELF_VOTE');
  end if;
  if (select count(*) from public.match_players
      where match_id = p_match_id and player_id = any (p_selections)) <> 3 then
    perform public.err('INVALID_SELECTION');
  end if;

  -- Insertion ou mise à jour atomique (la contrainte d'unicité sérialise
  -- les doubles clics et requêtes simultanées). is_late et
  -- first_submitted_at sont figés à la première soumission.
  insert into public.ballots as b
    (match_id, voter_player_id, first_submitted_at, last_modified_at, is_late, version, last_modified_by)
  values
    (p_match_id, v_player, v_now, v_now, v_now > v_match.vote_deadline, 1, v_uid)
  on conflict (match_id, voter_player_id) do update
    set last_modified_at = greatest(b.last_modified_at, excluded.last_modified_at),
        version = b.version + 1,
        last_modified_by = excluded.last_modified_by
    where b.status = 'valide'
  returning * into v_ballot;

  if v_ballot.id is null then
    perform public.err('BALLOT_CANCELLED');
  end if;
  v_is_new := v_ballot.version = 1;

  delete from public.ballot_selections where ballot_id = v_ballot.id;
  for i in 1..3 loop
    insert into public.ballot_selections (ballot_id, rank, selected_player_id)
    values (v_ballot.id, i, p_selections[i]);
  end loop;

  insert into public.ballot_versions (ballot_id, version, selections, recorded_at, recorded_by, source)
  values (v_ballot.id, v_ballot.version, p_selections, v_now, v_uid, 'joueur');

  -- Un bulletin valide annule un éventuel malus de non-vote automatique
  -- (cas d'un vote rouvert après clôture).
  delete from public.penalties
   where match_id = p_match_id and player_id = v_player
     and kind = 'non_vote' and created_by is null;

  -- Malus de retard : une seule fois, à la première soumission tardive
  if v_is_new and v_ballot.is_late then
    select * into v_settings from public.app_settings where id = 1;
    if v_settings.late_penalty_enabled then
      insert into public.penalties (match_id, player_id, kind, points, reason)
      values (p_match_id, v_player, 'retard', v_settings.late_penalty_points,
              'Bulletin soumis après l''heure limite')
      on conflict (match_id, player_id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ballot_id', v_ballot.id,
    'version', v_ballot.version,
    'is_late', v_ballot.is_late,
    'first_submitted_at', v_ballot.first_submitted_at,
    'last_modified_at', v_ballot.last_modified_at
  );
end $$;

-- ---------------------------------------------------------------------
-- ADMINISTRATION (maître)
-- ---------------------------------------------------------------------
create or replace function public.admin_save_settings(
  p_late_enabled boolean, p_late_points integer,
  p_nonvote_enabled boolean, p_nonvote_points integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.app_settings;
  v_after public.app_settings;
begin
  if p_late_points is null or p_late_points not between 1 and 50
     or p_nonvote_points is null or p_nonvote_points not between 1 and 50 then
    perform public.err('INVALID_PENALTY');
  end if;
  select * into v_before from public.app_settings where id = 1 for update;
  update public.app_settings
     set late_penalty_enabled = coalesce(p_late_enabled, false),
         late_penalty_points = p_late_points,
         nonvote_penalty_enabled = coalesce(p_nonvote_enabled, false),
         nonvote_penalty_points = p_nonvote_points,
         updated_at = now(), updated_by = v_actor
   where id = 1
  returning * into v_after;
  perform public.audit('config.malus', 'app_settings', '1', to_jsonb(v_before), to_jsonb(v_after));
end $$;

create or replace function public.admin_save_season(
  p_id uuid, p_name text, p_starts_on date, p_ends_on date, p_make_current boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.seasons;
  v_after public.seasons;
begin
  if p_make_current then
    update public.seasons set is_current = false where is_current and id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.seasons (name, starts_on, ends_on, is_current)
    values (btrim(p_name), p_starts_on, p_ends_on, coalesce(p_make_current, false))
    returning * into v_after;
  else
    select * into v_before from public.seasons where id = p_id for update;
    if not found then perform public.err('NOT_FOUND'); end if;
    update public.seasons
       set name = btrim(p_name), starts_on = p_starts_on, ends_on = p_ends_on,
           is_current = coalesce(p_make_current, is_current)
     where id = p_id
    returning * into v_after;
  end if;
  perform public.audit(case when p_id is null then 'saison.creation' else 'saison.modification' end,
                       'season', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
end $$;

create or replace function public.admin_save_player(
  p_id uuid, p_display_name text, p_shirt_number smallint, p_active boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.players;
  v_after public.players;
begin
  if p_id is null then
    insert into public.players (display_name, shirt_number, active)
    values (btrim(p_display_name), p_shirt_number, coalesce(p_active, true))
    returning * into v_after;
  else
    select * into v_before from public.players where id = p_id for update;
    if not found then perform public.err('NOT_FOUND'); end if;
    update public.players
       set display_name = btrim(p_display_name), shirt_number = p_shirt_number,
           active = coalesce(p_active, active)
     where id = p_id
    returning * into v_after;
  end if;
  perform public.audit(case when p_id is null then 'joueur.creation' else 'joueur.modification' end,
                       'player', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
end $$;

-- Création / modification d'un match. Les horaires sont saisis en heure locale belge.
create or replace function public.admin_save_match(
  p_id uuid, p_season_id uuid, p_opponent text, p_kickoff_local timestamp,
  p_location text, p_opens_local timestamp, p_closes_local timestamp,
  p_deadline_local timestamp, p_counts_for_ranking boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.matches;
  v_after public.matches;
  v_opens timestamptz := public.brussels(p_opens_local);
  v_closes timestamptz := public.brussels(p_closes_local);
begin
  if p_kickoff_local is null or p_deadline_local is null or coalesce(btrim(p_opponent), '') = '' then
    perform public.err('MATCH_FIELDS_REQUIRED');
  end if;
  if v_opens is not null and v_closes is not null and v_closes <= v_opens then
    perform public.err('CLOSE_BEFORE_OPEN');
  end if;

  if p_id is null then
    insert into public.matches (season_id, opponent, kickoff_at, location, vote_opens_at,
                                vote_closes_at, vote_deadline, counts_for_ranking)
    values (p_season_id, btrim(p_opponent), public.brussels(p_kickoff_local),
            nullif(btrim(coalesce(p_location, '')), ''), v_opens, v_closes,
            public.brussels(p_deadline_local), coalesce(p_counts_for_ranking, true))
    returning * into v_after;
  else
    select * into v_before from public.matches where id = p_id for update;
    if not found then perform public.err('NOT_FOUND'); end if;
    update public.matches
       set season_id = p_season_id, opponent = btrim(p_opponent),
           kickoff_at = public.brussels(p_kickoff_local),
           location = nullif(btrim(coalesce(p_location, '')), ''),
           vote_opens_at = v_opens, vote_closes_at = v_closes,
           vote_deadline = public.brussels(p_deadline_local),
           counts_for_ranking = coalesce(p_counts_for_ranking, true)
     where id = p_id
    returning * into v_after;
  end if;
  perform public.refresh_match_state(v_after.id);
  select * into v_after from public.matches where id = v_after.id;
  perform public.audit(case when p_id is null then 'match.creation' else 'match.modification' end,
                       'match', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
end $$;

-- Action manuelle : p_state = 'ouvert' | 'ferme' | 'a_venir', ou NULL pour revenir au mode automatique
create or replace function public.admin_set_vote_state(p_match_id uuid, p_state public.vote_state)
returns public.vote_state
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.matches;
  v_state public.vote_state;
begin
  select * into v_before from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  if v_before.archived and p_state = 'ouvert' then perform public.err('MATCH_ARCHIVED'); end if;
  update public.matches
     set manual_state = p_state,
         manual_at = case when p_state is null then null else now() end
   where id = p_match_id;
  v_state := public.refresh_match_state(p_match_id);
  perform public.audit('vote.etat_manuel', 'match', p_match_id::text,
    jsonb_build_object('etat', v_before.vote_state, 'manuel', v_before.manual_state),
    jsonb_build_object('etat', v_state, 'manuel', p_state));
  return v_state;
end $$;

create or replace function public.admin_set_archived(p_match_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.matches;
begin
  select * into v_before from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  update public.matches set archived = coalesce(p_archived, false) where id = p_match_id;
  perform public.refresh_match_state(p_match_id);
  perform public.audit(case when p_archived then 'match.archivage' else 'match.desarchivage' end,
                       'match', p_match_id::text,
                       jsonb_build_object('archived', v_before.archived),
                       jsonb_build_object('archived', p_archived));
end $$;

create or replace function public.admin_delete_match(p_match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.matches;
begin
  select * into v_before from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  if exists (select 1 from public.ballots where match_id = p_match_id)
     or exists (select 1 from public.penalties where match_id = p_match_id) then
    perform public.err('MATCH_HAS_VOTES');
  end if;
  delete from public.matches where id = p_match_id;
  perform public.audit('match.suppression', 'match', p_match_id::text, to_jsonb(v_before), null);
end $$;

-- Feuille de match (remplacement complet)
create or replace function public.admin_set_match_players(p_match_id uuid, p_player_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before uuid[];
  v_ids uuid[] := coalesce(p_player_ids, '{}');
begin
  perform 1 from public.matches where id = p_match_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  select coalesce(array_agg(player_id order by player_id), '{}') into v_before
    from public.match_players where match_id = p_match_id;

  -- On ne retire pas un joueur ayant déjà voté ou ayant été choisi
  if exists (
    select 1 from public.match_players mp
    where mp.match_id = p_match_id and not (mp.player_id = any (v_ids))
      and (exists (select 1 from public.ballots b where b.match_id = p_match_id
                   and b.voter_player_id = mp.player_id)
           or exists (select 1 from public.ballot_selections s
                      join public.ballots b on b.id = s.ballot_id
                      where b.match_id = p_match_id and s.selected_player_id = mp.player_id))
  ) then
    perform public.err('PLAYER_HAS_VOTES');
  end if;

  delete from public.match_players where match_id = p_match_id and not (player_id = any (v_ids));
  insert into public.match_players (match_id, player_id)
  select p_match_id, x from unnest(v_ids) x
  join public.players pl on pl.id = x
  on conflict do nothing;

  perform public.audit('match.feuille', 'match', p_match_id::text,
                       jsonb_build_object('joueurs', v_before),
                       jsonb_build_object('joueurs', (select coalesce(array_agg(player_id order by player_id), '{}')
                                                      from public.match_players where match_id = p_match_id)));
  return (select count(*) from public.match_players where match_id = p_match_id);
end $$;

-- Correction exceptionnelle d'un bulletin (création ou modification), journalisée
create or replace function public.admin_correct_ballot(
  p_match_id uuid, p_voter_player_id uuid, p_selections uuid[],
  p_is_late boolean, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_now timestamptz := clock_timestamp();
  v_match public.matches;
  v_before public.ballots;
  v_before_sel uuid[];
  v_ballot public.ballots;
  v_settings public.app_settings;
  i integer;
begin
  if coalesce(btrim(p_reason), '') = '' then perform public.err('REASON_REQUIRED'); end if;
  select * into v_match from public.matches where id = p_match_id for share;
  if not found then perform public.err('MATCH_NOT_FOUND'); end if;
  if p_selections is null or coalesce(array_length(p_selections, 1), 0) <> 3
     or array_position(p_selections, null) is not null then
    perform public.err('NEED_THREE');
  end if;
  if (select count(distinct x) from unnest(p_selections) x) <> 3 then perform public.err('DUPLICATE_SELECTION'); end if;
  if p_voter_player_id = any (p_selections) then perform public.err('SELF_VOTE'); end if;
  if (select count(*) from public.match_players
      where match_id = p_match_id and player_id = any (p_selections || p_voter_player_id)) <> 4 then
    perform public.err('INVALID_SELECTION');
  end if;

  select * into v_before from public.ballots
   where match_id = p_match_id and voter_player_id = p_voter_player_id for update;
  if found then
    select array_agg(selected_player_id order by rank) into v_before_sel
      from public.ballot_selections where ballot_id = v_before.id;
    update public.ballots
       set last_modified_at = v_now, version = version + 1, last_modified_by = v_actor,
           is_late = coalesce(p_is_late, is_late), status = 'valide'
     where id = v_before.id
    returning * into v_ballot;
  else
    insert into public.ballots (match_id, voter_player_id, first_submitted_at, last_modified_at,
                                is_late, version, last_modified_by)
    values (p_match_id, p_voter_player_id, v_now, v_now,
            coalesce(p_is_late, v_now > v_match.vote_deadline), 1, v_actor)
    returning * into v_ballot;
  end if;

  delete from public.ballot_selections where ballot_id = v_ballot.id;
  for i in 1..3 loop
    insert into public.ballot_selections (ballot_id, rank, selected_player_id)
    values (v_ballot.id, i, p_selections[i]);
  end loop;
  insert into public.ballot_versions (ballot_id, version, selections, recorded_at, recorded_by, source, reason)
  values (v_ballot.id, v_ballot.version, p_selections, v_now, v_actor, 'correction', btrim(p_reason));

  -- Synchronisation du malus de retard avec le statut corrigé
  select * into v_settings from public.app_settings where id = 1;
  delete from public.penalties
   where match_id = p_match_id and player_id = p_voter_player_id and kind = 'non_vote' and created_by is null;
  if v_ballot.is_late and (v_before.id is null or not v_before.is_late) and v_settings.late_penalty_enabled then
    insert into public.penalties (match_id, player_id, kind, points, reason, created_by)
    values (p_match_id, p_voter_player_id, 'retard', v_settings.late_penalty_points,
            'Correction : ' || btrim(p_reason), v_actor)
    on conflict (match_id, player_id) do update
      set kind = 'retard', points = excluded.points, status = 'active', reason = excluded.reason;
  elsif not v_ballot.is_late and v_before.is_late then
    update public.penalties set status = 'annulee', reason = 'Correction : ' || btrim(p_reason)
     where match_id = p_match_id and player_id = p_voter_player_id and kind = 'retard';
  end if;

  perform public.audit('bulletin.correction', 'ballot', v_ballot.id::text,
    case when v_before.id is null then null else
      jsonb_build_object('selections', v_before_sel, 'is_late', v_before.is_late, 'status', v_before.status,
                         'version', v_before.version) end,
    jsonb_build_object('selections', p_selections, 'is_late', v_ballot.is_late, 'status', v_ballot.status,
                       'version', v_ballot.version, 'motif', btrim(p_reason),
                       'match_id', p_match_id, 'votant', p_voter_player_id));
  return v_ballot.id;
end $$;

create or replace function public.admin_set_ballot_status(p_ballot_id uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.ballots;
begin
  if p_status not in ('valide', 'annule') then perform public.err('INVALID_STATUS'); end if;
  if coalesce(btrim(p_reason), '') = '' then perform public.err('REASON_REQUIRED'); end if;
  select * into v_before from public.ballots where id = p_ballot_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  update public.ballots set status = p_status, last_modified_by = v_actor where id = p_ballot_id;
  perform public.audit('bulletin.statut', 'ballot', p_ballot_id::text,
                       jsonb_build_object('status', v_before.status),
                       jsonb_build_object('status', p_status, 'motif', btrim(p_reason)));
end $$;

create or replace function public.admin_set_penalty(
  p_match_id uuid, p_player_id uuid, p_kind public.penalty_kind,
  p_points integer, p_status text, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.require_maitre();
  v_before public.penalties;
  v_after public.penalties;
begin
  if coalesce(btrim(p_reason), '') = '' then perform public.err('REASON_REQUIRED'); end if;
  if p_status not in ('active', 'annulee') then perform public.err('INVALID_STATUS'); end if;
  if p_points is null or p_points not between 1 and 50 then perform public.err('INVALID_PENALTY'); end if;
  select * into v_before from public.penalties
   where match_id = p_match_id and player_id = p_player_id for update;
  insert into public.penalties (match_id, player_id, kind, points, status, reason, created_by)
  values (p_match_id, p_player_id, p_kind, p_points, p_status, btrim(p_reason), v_actor)
  on conflict (match_id, player_id) do update
    set kind = excluded.kind, points = excluded.points, status = excluded.status,
        reason = excluded.reason, created_by = excluded.created_by
  returning * into v_after;
  perform public.audit('penalite.correction', 'penalty', v_after.id::text, to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
end $$;

-- ---------------------------------------------------------------------
-- LECTURES RÉSERVÉES AU MAÎTRE
-- ---------------------------------------------------------------------
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
    group by 1
  ),
  roster as (
    select pl0.id as pid from public.players pl0 where pl0.active
    union select pid from gross union select pid from pen union select pid from apps
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

create or replace function public.admin_match_summary(p_match_id uuid)
returns table (
  player_id uuid, display_name text, voted boolean, ballot_late boolean,
  points_received integer, votes_received integer, penalty_points integer, penalty_kind public.penalty_kind
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_maitre();
  return query
  select mp.player_id, pl.display_name,
         (b.id is not null), coalesce(b.is_late, false),
         coalesce((select sum(s.points)::integer from public.ballot_selections s
                   join public.ballots bb on bb.id = s.ballot_id and bb.status = 'valide'
                   where bb.match_id = p_match_id and s.selected_player_id = mp.player_id), 0),
         coalesce((select count(*)::integer from public.ballot_selections s
                   join public.ballots bb on bb.id = s.ballot_id and bb.status = 'valide'
                   where bb.match_id = p_match_id and s.selected_player_id = mp.player_id), 0),
         case when pe.status = 'active' then pe.points else 0 end,
         case when pe.status = 'active' then pe.kind end
  from public.match_players mp
  join public.players pl on pl.id = mp.player_id
  left join public.ballots b on b.match_id = mp.match_id and b.voter_player_id = mp.player_id and b.status = 'valide'
  left join public.penalties pe on pe.match_id = mp.match_id and pe.player_id = mp.player_id
  where mp.match_id = p_match_id
  order by 5 desc, pl.display_name;
end $$;

-- ---------------------------------------------------------------------
-- FONCTIONS SERVEUR (clé service uniquement) : comptes et connexion
-- ---------------------------------------------------------------------
create or replace function public.svc_create_account(
  p_actor uuid, p_user_id uuid, p_username text, p_role public.app_role,
  p_player_id uuid, p_new_player_name text, p_shirt_number smallint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid := p_player_id;
begin
  perform public.svc_require_maitre(p_actor);
  if v_player is null and coalesce(btrim(p_new_player_name), '') <> '' then
    insert into public.players (display_name, shirt_number)
    values (btrim(p_new_player_name), p_shirt_number)
    returning id into v_player;
    perform public.audit('joueur.creation', 'player', v_player::text, null,
                         jsonb_build_object('display_name', btrim(p_new_player_name)), p_actor);
  end if;
  insert into public.profiles (user_id, username, role, player_id, must_change_password)
  values (p_user_id, lower(btrim(p_username)), coalesce(p_role, 'joueur'), v_player, true);
  perform public.audit('compte.creation', 'profile', p_user_id::text, null,
                       jsonb_build_object('username', lower(btrim(p_username)), 'role', coalesce(p_role, 'joueur'),
                                          'player_id', v_player), p_actor);
  return v_player;
end $$;

-- Création du tout premier compte maître (refusée si un maître existe déjà)
create or replace function public.svc_bootstrap_maitre(
  p_user_id uuid, p_username text, p_display_name text, p_shirt_number smallint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid;
begin
  if exists (select 1 from public.profiles where role = 'maitre') then
    perform public.err('MAITRE_EXISTS');
  end if;
  insert into public.players (display_name, shirt_number)
  values (btrim(p_display_name), p_shirt_number) returning id into v_player;
  insert into public.profiles (user_id, username, role, player_id, must_change_password)
  values (p_user_id, lower(btrim(p_username)), 'maitre', v_player, false);
  perform public.audit('compte.creation_maitre', 'profile', p_user_id::text, null,
                       jsonb_build_object('username', lower(btrim(p_username))), p_user_id);
  return v_player;
end $$;

create or replace function public.svc_set_account_active(p_actor uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.profiles;
begin
  perform public.svc_require_maitre(p_actor);
  if p_actor = p_user_id and not p_active then perform public.err('CANNOT_DISABLE_SELF'); end if;
  select * into v_before from public.profiles where user_id = p_user_id for update;
  if not found then perform public.err('NOT_FOUND'); end if;
  update public.profiles set active = p_active where user_id = p_user_id;
  if v_before.player_id is not null then
    update public.players set active = p_active where id = v_before.player_id;
  end if;
  perform public.audit(case when p_active then 'compte.reactivation' else 'compte.desactivation' end,
                       'profile', p_user_id::text, jsonb_build_object('active', v_before.active),
                       jsonb_build_object('active', p_active), p_actor);
end $$;

create or replace function public.svc_mark_password_reset(p_actor uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.svc_require_maitre(p_actor);
  update public.profiles set must_change_password = true where user_id = p_user_id;
  if not found then perform public.err('NOT_FOUND'); end if;
  perform public.audit('compte.reinitialisation_mdp', 'profile', p_user_id::text, null, null, p_actor);
end $$;

create or replace function public.svc_password_changed(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set must_change_password = false where user_id = p_user_id;
  perform public.audit('compte.changement_mdp', 'profile', p_user_id::text, null, null, p_user_id);
end $$;

-- Anti force brute : 5 échecs par identifiant ou 20 échecs par IP en 15 minutes
create or replace function public.svc_login_allowed(p_username text, p_ip text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.login_attempts
          where username = lower(p_username) and not success
            and attempted_at > now() - interval '15 minutes') < 5
     and (p_ip is null or (select count(*) from public.login_attempts
          where ip = p_ip and not success
            and attempted_at > now() - interval '15 minutes') < 20)
$$;

create or replace function public.svc_login_record(p_username text, p_ip text, p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.login_attempts (username, ip, success) values (lower(p_username), p_ip, p_success);
  if p_success then
    delete from public.login_attempts where username = lower(p_username) and not success;
  end if;
  delete from public.login_attempts where attempted_at < now() - interval '7 days';
end $$;

-- ===== 20261026000003_security.sql =====
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

-- ===== 20261026000004_scheduler.sql =====
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
