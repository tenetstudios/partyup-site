create extension if not exists pgcrypto;

alter table public.room_missions
  add column if not exists mission_type text not null default 'generic',
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.room_missions
  drop constraint if exists room_missions_mission_type_check;
alter table public.room_missions
  add constraint room_missions_mission_type_check
  check (mission_type in ('generic', 'animal_pack'));

alter table public.room_missions
  drop constraint if exists room_missions_config_object_check;
alter table public.room_missions
  add constraint room_missions_config_object_check
  check (jsonb_typeof(config) = 'object');

create table if not exists public.mission_participant_assignments (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  assignment_key text not null,
  created_at timestamptz not null default now(),
  constraint mission_assignments_once_per_identity unique (mission_id, participant_identity_id),
  constraint mission_assignments_key_length check (char_length(assignment_key) between 1 and 32)
);

create index if not exists mission_assignments_mission_key_idx
  on public.mission_participant_assignments(mission_id, assignment_key);

create table if not exists public.mission_encounter_tokens (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  token_hash text not null unique,
  short_code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  constraint mission_encounter_tokens_hash_length check (
    char_length(token_hash) = 64 and char_length(short_code_hash) = 64
  )
);

create unique index if not exists mission_encounter_tokens_mission_code_idx
  on public.mission_encounter_tokens(mission_id, short_code_hash);
create index if not exists mission_encounter_tokens_owner_idx
  on public.mission_encounter_tokens(mission_id, participant_identity_id, expires_at desc);

create table if not exists public.mission_encounters (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_low_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  participant_high_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  assignment_key text not null,
  created_at timestamptz not null default now(),
  constraint mission_encounters_canonical_pair check (
    participant_low_identity_id < participant_high_identity_id
  ),
  constraint mission_encounters_unique_pair unique (
    mission_id, participant_low_identity_id, participant_high_identity_id
  )
);

create index if not exists mission_encounters_low_idx
  on public.mission_encounters(mission_id, participant_low_identity_id);
create index if not exists mission_encounters_high_idx
  on public.mission_encounters(mission_id, participant_high_identity_id);

create or replace function public.resolve_mission_participant_identity(p_guest_token text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if auth.uid() is not null then
    select identity.id
    into v_identity_id
    from public.partyup_identities identity
    where identity.user_id = auth.uid()
    limit 1;
  elsif nullif(btrim(coalesce(p_guest_token, '')), '') is not null then
    v_identity_id := public.resolve_guest_identity(p_guest_token);
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp participant identity required';
  end if;

  return v_identity_id;
end;
$$;

create or replace function public.can_identity_participate_in_mission_room(
  p_room_id uuid,
  p_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_rooms room
    join public.partyup_identities identity on identity.id = p_identity_id
    where room.id = p_room_id
      and room.status::text <> 'ended'
      and (
        identity.identity_type = 'guest'
        or room.host_id = identity.user_id
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = identity.user_id
            and attendee.status::text = 'accepted'
        )
      )
  );
$$;

create or replace function public.publish_room_mission(
  p_room_id uuid,
  p_title text,
  p_description text default null,
  p_duration_minutes integer default null
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_starts_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can publish Missions'; end if;
  if exists (select 1 from public.event_rooms where id = p_room_id and status::text = 'ended') then
    raise exception 'Missions cannot be published after the event ends';
  end if;
  if v_title is null then raise exception 'Mission title is required'; end if;
  if char_length(v_title) > 120 then raise exception 'Mission title is too long'; end if;
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Mission description is too long';
  end if;
  if p_duration_minutes is not null and (p_duration_minutes < 1 or p_duration_minutes > 1440) then
    raise exception 'Mission duration must be between 1 and 1440 minutes';
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || p_room_id::text));
  perform public.close_expired_room_missions(p_room_id);

  update public.room_missions
  set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = p_room_id and status = 'active';

  insert into public.room_missions (
    room_id, created_by_identity_id, title, description, mission_type, config,
    status, starts_at, ends_at
  ) values (
    p_room_id, v_identity_id, v_title, v_description, 'generic', '{}'::jsonb,
    'active', v_starts_at,
    case when p_duration_minutes is null then null
      else v_starts_at + make_interval(mins => p_duration_minutes) end
  ) returning * into v_mission;

  return v_mission;
end;
$$;

create or replace function public.publish_animal_pack_mission(
  p_room_id uuid,
  p_animal_count integer default 6,
  p_target_encounters integer default 3,
  p_duration_minutes integer default 10
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_starts_at timestamptz := now();
  v_animals jsonb := '["🐸","🦁","🐼","🦊","🐵","🐙","🐯","🐨","🐧","🐰","🐺","🦄"]'::jsonb;
  v_config jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can publish Missions'; end if;
  if exists (select 1 from public.event_rooms where id = p_room_id and status::text = 'ended') then
    raise exception 'Missions cannot be published after the event ends';
  end if;
  if p_animal_count not in (4, 6, 8, 10, 12) then
    raise exception 'Animal groups must be 4, 6, 8, 10, or 12';
  end if;
  if p_target_encounters not in (1, 2, 3) then
    raise exception 'Target encounters must be 1, 2, or 3';
  end if;
  if p_duration_minutes not in (5, 10, 15, 30) then
    raise exception 'Duration must be 5, 10, 15, or 30 minutes';
  end if;

  select jsonb_build_object(
    'animals', jsonb_agg(item.value order by item.ordinality),
    'target_encounters', p_target_encounters
  )
  into v_config
  from jsonb_array_elements(v_animals) with ordinality item(value, ordinality)
  where item.ordinality <= p_animal_count;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || p_room_id::text));
  perform public.close_expired_room_missions(p_room_id);

  update public.room_missions
  set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = p_room_id and status = 'active';

  insert into public.room_missions (
    room_id, created_by_identity_id, title, description, mission_type, config,
    status, starts_at, ends_at
  ) values (
    p_room_id, v_identity_id, 'Find Your Pack',
    'Find the other people in this room who share your animal.',
    'animal_pack', v_config, 'active', v_starts_at,
    v_starts_at + make_interval(mins => p_duration_minutes)
  ) returning * into v_mission;

  return v_mission;
end;
$$;

create or replace function public.join_animal_pack_mission(
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
  v_assignment text;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);

  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type <> 'animal_pack' then raise exception 'Find Your Pack Mission not found'; end if;
  if v_mission.status <> 'active' or v_mission.starts_at > now() then raise exception 'This Mission is no longer active'; end if;
  if v_mission.ends_at is not null and v_mission.ends_at <= now() then
    perform public.close_expired_room_missions(v_mission.room_id);
    raise exception 'This Mission has expired';
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id) then
    raise exception 'You must be participating in this room to join its Mission';
  end if;

  perform pg_advisory_xact_lock(hashtext('partyup-mission-assignment:' || p_mission_id::text));

  select assignment_key into v_assignment
  from public.mission_participant_assignments
  where mission_id = p_mission_id and participant_identity_id = v_identity_id;

  if v_assignment is null then
    select candidate.assignment_key into v_assignment
    from (
      select animal.value as assignment_key, count(existing.id) as assignment_count
      from jsonb_array_elements_text(v_mission.config->'animals') animal(value)
      left join public.mission_participant_assignments existing
        on existing.mission_id = p_mission_id and existing.assignment_key = animal.value
      group by animal.value
    ) candidate
    order by candidate.assignment_count asc, random()
    limit 1;

    if v_assignment is null then raise exception 'Mission animal configuration is invalid'; end if;

    insert into public.mission_participant_assignments (
      mission_id, participant_identity_id, assignment_key
    ) values (p_mission_id, v_identity_id, v_assignment)
    on conflict (mission_id, participant_identity_id) do update
      set assignment_key = mission_participant_assignments.assignment_key
    returning assignment_key into v_assignment;
  end if;

  return jsonb_build_object('assignment_key', v_assignment);
end;
$$;

create or replace function public.get_my_animal_pack_state(
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
  v_assignment text;
  v_progress integer;
  v_target integer;
  v_completed_at timestamptz;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'animal_pack' then raise exception 'Find Your Pack Mission not found'; end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id)
     and not public.is_room_host(v_mission.room_id) then
    raise exception 'You cannot view this Mission state';
  end if;

  select assignment_key into v_assignment
  from public.mission_participant_assignments
  where mission_id = p_mission_id and participant_identity_id = v_identity_id;
  if v_assignment is null then return null; end if;

  select count(*)::integer into v_progress
  from public.mission_encounters encounter
  where encounter.mission_id = p_mission_id
    and v_identity_id in (encounter.participant_low_identity_id, encounter.participant_high_identity_id);

  v_target := greatest(1, coalesce((v_mission.config->>'target_encounters')::integer, 3));
  select completed_at into v_completed_at
  from public.mission_completions
  where mission_id = p_mission_id and participant_identity_id = v_identity_id;

  return jsonb_build_object(
    'assignment_key', v_assignment,
    'progress', v_progress,
    'target_encounters', v_target,
    'completed', v_completed_at is not null,
    'completed_at', v_completed_at,
    'mission_active', v_mission.status = 'active'
      and v_mission.starts_at <= now()
      and (v_mission.ends_at is null or v_mission.ends_at > now())
      and exists (select 1 from public.event_rooms where id = v_mission.room_id and status::text <> 'ended')
  );
end;
$$;

create or replace function public.create_mission_encounter_token(
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
  v_token text;
  v_code text;
  v_expires_at timestamptz := now() + interval '60 seconds';
  v_attempt integer := 0;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type <> 'animal_pack' then raise exception 'Find Your Pack Mission not found'; end if;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now())
     or exists (select 1 from public.event_rooms where id = v_mission.room_id and status::text = 'ended') then
    raise exception 'This Mission is no longer active';
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id) then
    raise exception 'You must be participating in this room';
  end if;
  if not exists (
    select 1 from public.mission_participant_assignments
    where mission_id = p_mission_id and participant_identity_id = v_identity_id
  ) then raise exception 'Join this Mission before creating a code'; end if;

  update public.mission_encounter_tokens set revoked_at = now()
  where mission_id = p_mission_id and participant_identity_id = v_identity_id and revoked_at is null;

  loop
    v_attempt := v_attempt + 1;
    v_token := encode(gen_random_bytes(24), 'hex');
    v_code := upper(encode(gen_random_bytes(4), 'hex'));
    begin
      insert into public.mission_encounter_tokens (
        mission_id, participant_identity_id, token_hash, short_code_hash, expires_at
      ) values (
        p_mission_id, v_identity_id,
        encode(digest(v_token, 'sha256'), 'hex'),
        encode(digest(v_code, 'sha256'), 'hex'),
        v_expires_at
      );
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise exception 'Could not create a temporary Mission code'; end if;
    end;
  end loop;

  return jsonb_build_object(
    'token', v_token,
    'qr_payload', 'partyup-mission:' || v_token,
    'short_code', v_code,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.redeem_mission_encounter_token(
  p_mission_id uuid,
  p_token_or_code text,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scanner_id uuid;
  v_owner_id uuid;
  v_token_mission_id uuid;
  v_token_expires_at timestamptz;
  v_token_revoked_at timestamptz;
  v_value text := btrim(coalesce(p_token_or_code, ''));
  v_mission public.room_missions;
  v_scanner_assignment text;
  v_owner_assignment text;
  v_low uuid;
  v_high uuid;
  v_target integer;
  v_scanner_progress integer;
  v_owner_progress integer;
  v_inserted_rows integer := 0;
begin
  v_scanner_id := public.resolve_mission_participant_identity(p_guest_token);
  if v_value like 'partyup-mission:%' then v_value := substr(v_value, 17); end if;
  if v_value = '' then return jsonb_build_object('status', 'invalid'); end if;

  select token.mission_id, token.participant_identity_id, token.expires_at, token.revoked_at
  into v_token_mission_id, v_owner_id, v_token_expires_at, v_token_revoked_at
  from public.mission_encounter_tokens token
  where token.token_hash = encode(digest(v_value, 'sha256'), 'hex')
     or token.short_code_hash = encode(digest(upper(v_value), 'sha256'), 'hex')
  order by (token.mission_id = p_mission_id) desc, token.created_at desc
  limit 1;

  if v_owner_id is null then return jsonb_build_object('status', 'expired'); end if;
  if v_token_mission_id <> p_mission_id then return jsonb_build_object('status', 'wrong_mission'); end if;
  if v_token_revoked_at is not null or v_token_expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type <> 'animal_pack' then return jsonb_build_object('status', 'wrong_mission'); end if;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now())
     or exists (select 1 from public.event_rooms where id = v_mission.room_id and status::text = 'ended') then
    return jsonb_build_object('status', 'mission_ended');
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_scanner_id)
     or not public.can_identity_participate_in_mission_room(v_mission.room_id, v_owner_id) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_scanner_id = v_owner_id then return jsonb_build_object('status', 'self_scan'); end if;

  select assignment_key into v_scanner_assignment
  from public.mission_participant_assignments
  where mission_id = p_mission_id and participant_identity_id = v_scanner_id;
  select assignment_key into v_owner_assignment
  from public.mission_participant_assignments
  where mission_id = p_mission_id and participant_identity_id = v_owner_id;
  if v_scanner_assignment is null or v_owner_assignment is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_scanner_assignment <> v_owner_assignment then
    return jsonb_build_object('status', 'wrong_animal');
  end if;

  v_low := least(v_scanner_id, v_owner_id);
  v_high := greatest(v_scanner_id, v_owner_id);
  perform pg_advisory_xact_lock(hashtext('partyup-mission-pair:' || p_mission_id::text || ':' || v_low::text || ':' || v_high::text));

  insert into public.mission_encounters (
    mission_id, participant_low_identity_id, participant_high_identity_id, assignment_key
  ) values (p_mission_id, v_low, v_high, v_scanner_assignment)
  on conflict (mission_id, participant_low_identity_id, participant_high_identity_id) do nothing;
  get diagnostics v_inserted_rows = row_count;

  if v_inserted_rows = 0 then return jsonb_build_object('status', 'duplicate'); end if;

  select count(*)::integer into v_scanner_progress from public.mission_encounters
  where mission_id = p_mission_id and v_scanner_id in (participant_low_identity_id, participant_high_identity_id);
  select count(*)::integer into v_owner_progress from public.mission_encounters
  where mission_id = p_mission_id and v_owner_id in (participant_low_identity_id, participant_high_identity_id);
  v_target := greatest(1, coalesce((v_mission.config->>'target_encounters')::integer, 3));

  if v_scanner_progress >= v_target then
    insert into public.mission_completions(mission_id, participant_identity_id)
    values (p_mission_id, v_scanner_id) on conflict (mission_id, participant_identity_id) do nothing;
  end if;
  if v_owner_progress >= v_target then
    insert into public.mission_completions(mission_id, participant_identity_id)
    values (p_mission_id, v_owner_id) on conflict (mission_id, participant_identity_id) do nothing;
  end if;

  return jsonb_build_object(
    'status', 'valid',
    'progress', v_scanner_progress,
    'target_encounters', v_target,
    'completed', v_scanner_progress >= v_target
  );
end;
$$;

create or replace function public.get_animal_pack_host_results(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_participants integer;
  v_completed integer;
  v_people jsonb;
begin
  select room_id into v_room_id from public.room_missions
  where id = p_mission_id and mission_type = 'animal_pack';
  if v_room_id is null then raise exception 'Find Your Pack Mission not found'; end if;
  if not public.is_room_host(v_room_id) then raise exception 'Only the room host can view completed participants'; end if;

  select count(*)::integer into v_participants
  from public.mission_participant_assignments where mission_id = p_mission_id;
  select count(*)::integer into v_completed
  from public.mission_completions where mission_id = p_mission_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'identity_id', completion.participant_identity_id,
    'display_name', coalesce(nullif(to_jsonb(profile)->>'display_name', ''), profile.username, 'Guest ' || left(completion.participant_identity_id::text, 4)),
    'avatar_url', profile.avatar_url,
    'completed_at', completion.completed_at
  ) order by completion.completed_at), '[]'::jsonb)
  into v_people
  from public.mission_completions completion
  join public.partyup_identities identity on identity.id = completion.participant_identity_id
  left join public.profiles profile on profile.id = identity.user_id
  where completion.mission_id = p_mission_id;

  return jsonb_build_object(
    'participant_count', v_participants,
    'completed_count', v_completed,
    'completed_participants', v_people
  );
end;
$$;

drop function if exists public.get_active_room_mission(uuid);
create function public.get_active_room_mission(p_room_id uuid)
returns table (
  id uuid, room_id uuid, created_by_identity_id uuid, title text, description text,
  mission_type text, config jsonb, status text, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz, ended_at timestamptz, completion_count bigint,
  participant_count bigint, viewer_completed boolean, can_manage boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_room_missions(p_room_id) then return; end if;
  perform public.close_expired_room_missions(p_room_id);
  return query
  select mission.id, mission.room_id, mission.created_by_identity_id, mission.title,
    mission.description, mission.mission_type, mission.config, mission.status,
    mission.starts_at, mission.ends_at, mission.created_at, mission.ended_at,
    (select count(*) from public.mission_completions c where c.mission_id = mission.id),
    (select count(*) from public.mission_participant_assignments a where a.mission_id = mission.id),
    exists (select 1 from public.mission_completions c where c.mission_id = mission.id
      and c.participant_identity_id = public.current_partyup_identity_id()),
    public.is_room_host(p_room_id)
  from public.room_missions mission
  join public.event_rooms room on room.id = mission.room_id
  where mission.room_id = p_room_id and mission.status = 'active'
    and mission.starts_at <= now() and (mission.ends_at is null or mission.ends_at > now())
    and room.status::text <> 'ended'
  order by mission.starts_at desc limit 1;
end;
$$;

drop function if exists public.get_room_mission_history(uuid, integer);
create function public.get_room_mission_history(p_room_id uuid, p_limit integer default 10)
returns table (
  id uuid, room_id uuid, created_by_identity_id uuid, title text, description text,
  mission_type text, config jsonb, status text, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz, ended_at timestamptz, ended_reason text,
  completion_count bigint, participant_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can view Mission history'; end if;
  perform public.close_expired_room_missions(p_room_id);
  return query
  select mission.id, mission.room_id, mission.created_by_identity_id, mission.title,
    mission.description, mission.mission_type, mission.config, mission.status,
    mission.starts_at, mission.ends_at, mission.created_at, mission.ended_at,
    mission.ended_reason,
    (select count(*) from public.mission_completions c where c.mission_id = mission.id),
    (select count(*) from public.mission_participant_assignments a where a.mission_id = mission.id)
  from public.room_missions mission
  where mission.room_id = p_room_id and mission.status = 'ended'
  order by mission.ended_at desc nulls last, mission.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

create or replace function public.complete_room_mission(p_mission_id uuid)
returns public.mission_completions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_completion public.mission_completions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found then raise exception 'Mission not found'; end if;
  if v_mission.mission_type <> 'generic' then
    raise exception 'Find Your Pack Missions complete through verified encounters';
  end if;
  if v_mission.status <> 'active' then raise exception 'This Mission is no longer active'; end if;
  if v_mission.ends_at is not null and v_mission.ends_at <= now() then
    update public.room_missions set status = 'ended', ended_at = ends_at, ended_reason = 'expired'
    where id = v_mission.id;
    raise exception 'This Mission has expired';
  end if;
  if exists (select 1 from public.event_rooms where id = v_mission.room_id and status::text = 'ended') then
    raise exception 'This event has ended';
  end if;
  v_identity_id := public.resolve_mission_participant_identity(null);
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id) then
    raise exception 'You must be participating in this room to complete its Mission';
  end if;
  insert into public.mission_completions(mission_id, participant_identity_id)
  values (p_mission_id, v_identity_id)
  on conflict (mission_id, participant_identity_id) do nothing
  returning * into v_completion;
  if v_completion.id is null then
    select * into v_completion from public.mission_completions
    where mission_id = p_mission_id and participant_identity_id = v_identity_id;
  end if;
  return v_completion;
end;
$$;

alter table public.mission_participant_assignments enable row level security;
alter table public.mission_encounter_tokens enable row level security;
alter table public.mission_encounters enable row level security;

revoke all on public.mission_participant_assignments from anon, authenticated;
revoke all on public.mission_encounter_tokens from anon, authenticated;
revoke all on public.mission_encounters from anon, authenticated;
grant select on public.mission_participant_assignments to authenticated;
grant select on public.mission_encounters to authenticated;

drop policy if exists mission_assignments_select_own_or_host on public.mission_participant_assignments;
create policy mission_assignments_select_own_or_host on public.mission_participant_assignments
for select to authenticated using (
  participant_identity_id = public.current_partyup_identity_id()
  or exists (select 1 from public.room_missions mission
    where mission.id = mission_participant_assignments.mission_id
      and public.is_room_host(mission.room_id))
);

drop policy if exists mission_encounters_select_own_or_host on public.mission_encounters;
create policy mission_encounters_select_own_or_host on public.mission_encounters
for select to authenticated using (
  public.current_partyup_identity_id() in (participant_low_identity_id, participant_high_identity_id)
  or exists (select 1 from public.room_missions mission
    where mission.id = mission_encounters.mission_id
      and public.is_room_host(mission.room_id))
);

revoke all on function public.resolve_mission_participant_identity(text) from public, anon, authenticated;
revoke all on function public.can_identity_participate_in_mission_room(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_animal_pack_mission(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.join_animal_pack_mission(uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_animal_pack_state(uuid, text) from public, anon, authenticated;
revoke all on function public.create_mission_encounter_token(uuid, text) from public, anon, authenticated;
revoke all on function public.redeem_mission_encounter_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_animal_pack_host_results(uuid) from public, anon, authenticated;

grant execute on function public.get_active_room_mission(uuid) to anon, authenticated;
grant execute on function public.get_room_mission_history(uuid, integer) to authenticated;
grant execute on function public.publish_animal_pack_mission(uuid, integer, integer, integer) to authenticated;
grant execute on function public.join_animal_pack_mission(uuid, text) to anon, authenticated;
grant execute on function public.get_my_animal_pack_state(uuid, text) to anon, authenticated;
grant execute on function public.create_mission_encounter_token(uuid, text) to anon, authenticated;
grant execute on function public.redeem_mission_encounter_token(uuid, text, text) to anon, authenticated;
grant execute on function public.get_animal_pack_host_results(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.mission_participant_assignments;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.mission_encounters;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
