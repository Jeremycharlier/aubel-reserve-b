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
