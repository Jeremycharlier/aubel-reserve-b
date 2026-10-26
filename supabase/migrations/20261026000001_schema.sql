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
