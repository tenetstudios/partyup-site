-- Verified Into the Wild Match Missions reuse authoritative room-scoped Match
-- sessions. Queue entry, searching, Global Match, and client claims never count.

create table if not exists public.mission_match_verifications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  opponent_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  match_session_id uuid not null references public.match_sessions(id) on delete restrict,
  participant_faction_key text not null,
  opponent_faction_key text not null,
  verified_at timestamptz not null default now(),
  constraint mission_match_verifications_distinct_players check (
    participant_identity_id <> opponent_identity_id
  ),
  constraint mission_match_verifications_opposing_factions check (
    participant_faction_key <> opponent_faction_key
  ),
  constraint mission_match_verifications_unique_opponent unique (
    mission_id, participant_identity_id, opponent_identity_id
  ),
  constraint mission_match_verifications_unique_session unique (
    mission_id, participant_identity_id, match_session_id
  )
);

create index if not exists mission_match_verifications_progress_idx
  on public.mission_match_verifications(mission_id, participant_identity_id, verified_at);

create or replace function public.get_wild_verified_match_progress(
  p_mission_id uuid,
  p_identity_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.mission_match_verifications verification
  where verification.mission_id = p_mission_id
    and verification.participant_identity_id = p_identity_id;
$$;

-- This completion boundary protects both the normal completion RPC and the
-- Wild influence/contribution transaction from direct client bypasses.
create or replace function public.enforce_match_mission_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_required integer;
  v_progress integer;
begin
  select * into v_mission
  from public.room_missions mission
  where mission.id = new.mission_id;

  if v_mission.config->>'verification_type' = 'match_faction' then
    v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_matches')::integer, 1)));
    v_progress := public.get_wild_verified_match_progress(new.mission_id, new.participant_identity_id);
    if v_progress < v_required then
      raise exception 'Verified opposing-faction Matches required (% of % complete)', v_progress, v_required;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists mission_completions_require_match_evidence on public.mission_completions;
create trigger mission_completions_require_match_evidence
before insert on public.mission_completions
for each row execute function public.enforce_match_mission_completion_evidence();

create or replace function public.publish_wild_match_mission(
  p_game_id uuid,
  p_faction_key text,
  p_territory_key text,
  p_title text,
  p_description text default null,
  p_influence_reward integer default 10,
  p_duration_minutes integer default 20,
  p_required_matches integer default 2
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
begin
  if p_required_matches is null or p_required_matches < 1 or p_required_matches > 20 then
    raise exception 'Required Matches must be between 1 and 20';
  end if;

  v_mission := public.publish_wild_faction_mission(
    p_game_id,
    p_faction_key,
    p_territory_key,
    p_title,
    p_description,
    p_influence_reward,
    p_duration_minutes,
    'none',
    null,
    1,
    null
  );

  update public.room_missions
  set config = (config - 'encounter_relationship' - 'required_encounters' - 'target_faction')
    || jsonb_build_object(
      'verification_type', 'match_faction',
      'match_relationship', 'opposing_faction',
      'required_matches', p_required_matches
    )
  where id = v_mission.id
  returning * into v_mission;

  return v_mission;
end;
$$;

-- Records one participant's side of a real Match. This function is internal;
-- every room, game, timing, faction, eligibility, and identity value is derived
-- from database rows rather than caller input.
create or replace function public.record_wild_match_mission_for_identity(
  p_match_session_id uuid,
  p_room_id uuid,
  p_game_id uuid,
  p_participant_identity_id uuid,
  p_opponent_identity_id uuid,
  p_verified_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_assignment public.wild_faction_assignments;
  v_opponent_assignment public.wild_faction_assignments;
  v_mission public.room_missions;
  v_verification_id uuid;
  v_required integer;
  v_progress integer;
begin
  if p_participant_identity_id = p_opponent_identity_id then return; end if;
  if not public.can_identity_participate_in_mission_room(p_room_id, p_participant_identity_id)
     or not public.can_identity_participate_in_mission_room(p_room_id, p_opponent_identity_id) then
    return;
  end if;

  select * into v_participant_assignment
  from public.wild_faction_assignments assignment
  where assignment.game_id = p_game_id
    and assignment.participant_identity_id = p_participant_identity_id
    and assignment.created_at <= p_verified_at;

  select * into v_opponent_assignment
  from public.wild_faction_assignments assignment
  where assignment.game_id = p_game_id
    and assignment.participant_identity_id = p_opponent_identity_id
    and assignment.created_at <= p_verified_at;

  if v_participant_assignment.id is null
     or v_opponent_assignment.id is null
     or v_participant_assignment.faction_key = v_opponent_assignment.faction_key then
    return;
  end if;

  for v_mission in
    select mission.*
    from public.room_missions mission
    where mission.room_id = p_room_id
      and mission.mission_type = 'wild_faction'
      and mission.status = 'active'
      and mission.config->>'game_id' = p_game_id::text
      and mission.config->>'verification_type' = 'match_faction'
      and mission.config->>'match_relationship' = 'opposing_faction'
      and mission.starts_at <= p_verified_at
      and (mission.ends_at is null or mission.ends_at > p_verified_at)
      and (
        mission.config->>'faction_key' = 'all'
        or mission.config->>'faction_key' = v_participant_assignment.faction_key
      )
  loop
    v_verification_id := null;
    insert into public.mission_match_verifications (
      mission_id,
      participant_identity_id,
      opponent_identity_id,
      match_session_id,
      participant_faction_key,
      opponent_faction_key,
      verified_at
    ) values (
      v_mission.id,
      p_participant_identity_id,
      p_opponent_identity_id,
      p_match_session_id,
      v_participant_assignment.faction_key,
      v_opponent_assignment.faction_key,
      p_verified_at
    )
    on conflict do nothing
    returning id into v_verification_id;

    if v_verification_id is not null then
      v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_matches')::integer, 1)));
      v_progress := public.get_wild_verified_match_progress(v_mission.id, p_participant_identity_id);
      if v_progress >= v_required then
        perform public.award_wild_mission_for_identity(v_mission.id, p_participant_identity_id);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.verify_wild_match_missions_on_session_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.match_pools;
  v_game public.wild_games;
  v_verified_at timestamptz := clock_timestamp();
begin
  if new.status <> 'created' or new.pool_id is null then return new; end if;

  select * into v_pool
  from public.match_pools pool
  where pool.id = new.pool_id
    and pool.pool_type = 'event'
    and pool.source_id is not null;

  -- This immediate exit is the Global Match isolation boundary.
  if not found then return new; end if;

  select * into v_game
  from public.wild_games game
  where game.room_id = v_pool.source_id
    and game.status = 'active'
  order by game.started_at desc
  limit 1;

  if not found then return new; end if;

  perform public.record_wild_match_mission_for_identity(
    new.id, v_pool.source_id, v_game.id,
    new.participant_a_identity, new.participant_b_identity, v_verified_at
  );
  perform public.record_wild_match_mission_for_identity(
    new.id, v_pool.source_id, v_game.id,
    new.participant_b_identity, new.participant_a_identity, v_verified_at
  );

  return new;
end;
$$;

drop trigger if exists match_sessions_verify_wild_match_missions on public.match_sessions;
create trigger match_sessions_verify_wild_match_missions
after insert on public.match_sessions
for each row execute function public.verify_wild_match_missions_on_session_created();

create or replace function public.get_my_wild_match_state(
  p_mission_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_progress integer := 0;
  v_required integer := 1;
  v_completed boolean := false;
  v_verified_match_count integer := 0;
  v_completion_count integer := 0;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'wild_faction'
     or v_mission.config->>'verification_type' <> 'match_faction' then
    raise exception 'Verified Match Mission not found';
  end if;

  select * into v_game from public.wild_games where id = (v_mission.config->>'game_id')::uuid;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id)
     and not public.is_room_host(v_mission.room_id) then
    raise exception 'You cannot view this Match Mission state';
  end if;

  select * into v_assignment
  from public.wild_faction_assignments assignment
  where assignment.game_id = v_game.id
    and assignment.participant_identity_id = v_identity_id;

  v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_matches')::integer, 1)));
  if v_assignment.id is not null then
    v_progress := public.get_wild_verified_match_progress(p_mission_id, v_identity_id);
  end if;
  select exists (
    select 1 from public.mission_completions completion
    where completion.mission_id = p_mission_id
      and completion.participant_identity_id = v_identity_id
  ) into v_completed;

  if public.is_room_host(v_mission.room_id) then
    select count(*)::integer into v_verified_match_count
    from public.mission_match_verifications where mission_id = p_mission_id;
    select count(*)::integer into v_completion_count
    from public.mission_completions where mission_id = p_mission_id;
  end if;

  return jsonb_build_object(
    'progress', v_progress,
    'required_matches', v_required,
    'completed', v_completed,
    'eligible', v_assignment.id is not null and (
      v_mission.config->>'faction_key' = 'all'
      or v_mission.config->>'faction_key' = v_assignment.faction_key
    ),
    'verification_type', 'match_faction',
    'match_relationship', 'opposing_faction',
    'verified_match_count', v_verified_match_count,
    'mission_completion_count', v_completion_count,
    'mission_active', v_mission.status = 'active' and v_game.status = 'active'
      and v_mission.starts_at <= now()
      and (v_mission.ends_at is null or v_mission.ends_at > now())
  );
end;
$$;

alter table public.mission_match_verifications enable row level security;
revoke all on public.mission_match_verifications from anon, authenticated;
grant select on public.mission_match_verifications to authenticated;

drop policy if exists mission_match_verifications_select_own_or_host on public.mission_match_verifications;
create policy mission_match_verifications_select_own_or_host
on public.mission_match_verifications
for select
to authenticated
using (
  participant_identity_id = public.current_partyup_identity_id()
  or exists (
    select 1 from public.room_missions mission
    where mission.id = mission_match_verifications.mission_id
      and public.is_room_host(mission.room_id)
  )
);

revoke all on function public.get_wild_verified_match_progress(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_match_mission_completion_evidence() from public, anon, authenticated;
revoke all on function public.record_wild_match_mission_for_identity(uuid, uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.verify_wild_match_missions_on_session_created() from public, anon, authenticated;
revoke all on function public.publish_wild_match_mission(uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.get_my_wild_match_state(uuid, text) from public, anon, authenticated;

grant execute on function public.publish_wild_match_mission(uuid, text, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.get_my_wild_match_state(uuid, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'mission_match_verifications'
     ) then
    alter publication supabase_realtime add table public.mission_match_verifications;
  end if;
end $$;

notify pgrst, 'reload schema';
