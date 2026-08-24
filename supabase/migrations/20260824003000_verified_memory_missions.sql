-- A Memory Mission references the existing authoritative room_memories row.
-- Media upload/storage behavior remains owned by the Memories feature.

create unique index if not exists room_memories_media_path_unique_idx
  on public.room_memories(media_path);

create table if not exists public.mission_memory_verifications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  memory_id uuid not null references public.room_memories(id) on delete restrict,
  verified_at timestamptz not null default now(),
  constraint mission_memory_verifications_one_per_participant unique (mission_id, participant_identity_id),
  constraint mission_memory_verifications_memory_once unique (memory_id)
);

create index if not exists mission_memory_verifications_mission_idx
  on public.mission_memory_verifications(mission_id, verified_at desc);

create or replace function public.has_valid_memory_mission_evidence(
  p_mission_id uuid,
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
    from public.mission_memory_verifications verification
    join public.room_missions mission on mission.id = verification.mission_id
    join public.room_memories memory on memory.id = verification.memory_id
    where verification.mission_id = p_mission_id
      and verification.participant_identity_id = p_identity_id
      and mission.config->>'verification_type' = 'memory_upload'
      and memory.room_id = mission.room_id
      and memory.uploader_identity_id = p_identity_id
      and split_part(memory.media_path, '/', 1) = mission.room_id::text
      and split_part(memory.media_path, '/', 2) = p_identity_id::text
      and memory.deleted_at is null
      and exists (
        select 1 from storage.objects object
        where object.bucket_id = 'room-memories'
          and object.name = memory.media_path
          and object.created_at >= mission.starts_at
          and (mission.ends_at is null or object.created_at <= mission.ends_at)
      )
      and memory.created_at >= mission.starts_at
      and (mission.ends_at is null or memory.created_at <= mission.ends_at)
      and (
        coalesce(mission.config->>'required_media_type', 'any') = 'any'
        or memory.media_type = mission.config->>'required_media_type'
      )
  );
$$;

-- This common completion boundary protects both standard Missions and Wild
-- influence awards, including callers that try to skip the verification RPC.
create or replace function public.enforce_memory_mission_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification_type text;
begin
  select mission.config->>'verification_type'
  into v_verification_type
  from public.room_missions mission
  where mission.id = new.mission_id;

  if v_verification_type = 'memory_upload'
     and not public.has_valid_memory_mission_evidence(new.mission_id, new.participant_identity_id) then
    raise exception 'A valid Memory uploaded during this Mission is required';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_completions_require_memory_evidence on public.mission_completions;
create trigger mission_completions_require_memory_evidence
before insert on public.mission_completions
for each row execute function public.enforce_memory_mission_completion_evidence();

create or replace function public.publish_memory_room_mission(
  p_room_id uuid,
  p_title text,
  p_description text default null,
  p_duration_minutes integer default null,
  p_required_media_type text default 'any'
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_media_type text := coalesce(lower(nullif(btrim(coalesce(p_required_media_type, '')), '')), 'any');
begin
  if v_media_type not in ('any', 'image', 'video') then
    raise exception 'Required media type must be any, image, or video';
  end if;

  v_mission := public.publish_room_mission(
    p_room_id, p_title, p_description, p_duration_minutes
  );

  update public.room_missions
  set config = config || jsonb_build_object(
    'verification_type', 'memory_upload',
    'required_media_type', v_media_type,
    'required_memories', 1
  )
  where id = v_mission.id
  returning * into v_mission;
  return v_mission;
end;
$$;

create or replace function public.publish_wild_memory_mission(
  p_game_id uuid,
  p_faction_key text,
  p_territory_key text,
  p_title text,
  p_description text default null,
  p_influence_reward integer default 10,
  p_duration_minutes integer default 10,
  p_required_media_type text default 'any'
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_media_type text := coalesce(lower(nullif(btrim(coalesce(p_required_media_type, '')), '')), 'any');
begin
  if v_media_type not in ('any', 'image', 'video') then
    raise exception 'Required media type must be any, image, or video';
  end if;

  v_mission := public.publish_wild_faction_mission(
    p_game_id, p_faction_key, p_territory_key, p_title, p_description,
    p_influence_reward, p_duration_minutes, 'none', null, 1, null
  );

  update public.room_missions
  set config = config || jsonb_build_object(
    'verification_type', 'memory_upload',
    'required_media_type', v_media_type,
    'required_memories', 1
  )
  where id = v_mission.id
  returning * into v_mission;
  return v_mission;
end;
$$;

create or replace function public.verify_memory_mission_completion(
  p_mission_id uuid,
  p_memory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_memory public.room_memories;
  v_existing public.mission_memory_verifications;
  v_required_media_type text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_identity_id := public.resolve_mission_participant_identity(null);

  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type not in ('generic', 'wild_faction')
     or v_mission.config->>'verification_type' <> 'memory_upload' then
    raise exception 'Memory Mission not found';
  end if;
  if v_mission.status <> 'active' or v_mission.starts_at is null or v_mission.starts_at > now() then
    raise exception 'This Mission is no longer active';
  end if;
  if v_mission.ends_at is not null and v_mission.ends_at <= now() then
    update public.room_missions set status = 'ended', ended_at = ends_at, ended_reason = 'expired'
    where id = v_mission.id;
    raise exception 'This Mission has expired';
  end if;
  perform 1 from public.event_rooms
  where id = v_mission.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id) then
    raise exception 'You must be participating in this room';
  end if;

  if v_mission.mission_type = 'wild_faction' and not exists (
    select 1
    from public.wild_faction_assignments assignment
    where assignment.game_id = (v_mission.config->>'game_id')::uuid
      and assignment.participant_identity_id = v_identity_id
      and (
        v_mission.config->>'faction_key' = 'all'
        or assignment.faction_key = v_mission.config->>'faction_key'
      )
  ) then raise exception 'This Mission belongs to another faction'; end if;

  select * into v_memory from public.room_memories where id = p_memory_id for update;
  if not found then raise exception 'Memory not found'; end if;
  if v_memory.room_id <> v_mission.room_id then raise exception 'Memory belongs to another room'; end if;
  if v_memory.uploader_identity_id <> v_identity_id then raise exception 'You can only use a Memory you uploaded'; end if;
  if split_part(v_memory.media_path, '/', 1) <> v_mission.room_id::text
     or split_part(v_memory.media_path, '/', 2) <> v_identity_id::text then
    raise exception 'Memory upload ownership could not be verified';
  end if;
  if v_memory.deleted_at is not null then raise exception 'This Memory was removed'; end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'room-memories'
      and object.name = v_memory.media_path
      and object.created_at >= v_mission.starts_at
      and (v_mission.ends_at is null or object.created_at <= v_mission.ends_at)
  ) then raise exception 'Memory upload did not occur during this Mission'; end if;
  if v_memory.created_at < v_mission.starts_at then raise exception 'Memory was created before this Mission began'; end if;
  if v_mission.ends_at is not null and v_memory.created_at > v_mission.ends_at then
    raise exception 'Memory was created after this Mission ended';
  end if;
  v_required_media_type := coalesce(v_mission.config->>'required_media_type', 'any');
  if v_required_media_type not in ('any', 'image', 'video') then
    raise exception 'Memory Mission media configuration is invalid';
  end if;
  if v_required_media_type <> 'any' and v_memory.media_type <> v_required_media_type then
    raise exception 'This Mission requires a %', case when v_required_media_type = 'image' then 'photo' else 'video' end;
  end if;

  select * into v_existing from public.mission_memory_verifications
  where mission_id = p_mission_id and participant_identity_id = v_identity_id;
  if v_existing.id is not null and v_existing.memory_id <> p_memory_id then
    raise exception 'You already verified another Memory for this Mission';
  end if;
  if v_existing.id is null and exists (
    select 1 from public.mission_memory_verifications where memory_id = p_memory_id
  ) then raise exception 'This Memory has already verified another Mission'; end if;

  if v_existing.id is null then
    insert into public.mission_memory_verifications (
      mission_id, participant_identity_id, memory_id
    ) values (p_mission_id, v_identity_id, p_memory_id)
    returning * into v_existing;
  end if;

  if v_mission.mission_type = 'wild_faction' then
    v_result := public.complete_wild_faction_mission(p_mission_id, null);
  else
    select to_jsonb(completion) into v_result
    from public.complete_room_mission(p_mission_id) completion;
  end if;

  return jsonb_build_object(
    'status', 'verified',
    'mission_id', p_mission_id,
    'memory_id', p_memory_id,
    'completed', true,
    'completion', v_result
  );
end;
$$;

alter table public.mission_memory_verifications enable row level security;
revoke all on public.mission_memory_verifications from anon, authenticated;
grant select on public.mission_memory_verifications to authenticated;

-- The original Memories grant allowed callers to explicitly supply created_at.
-- Restrict inserts to upload fields so the database timestamp remains authoritative.
revoke insert on public.room_memories from authenticated;
grant insert (room_id, uploader_identity_id, media_type, media_path, thumbnail_path)
  on public.room_memories to authenticated;

drop policy if exists room_memories_insert_own_identity on public.room_memories;
create policy room_memories_insert_own_identity
on public.room_memories
for insert
to authenticated
with check (
  deleted_at is null
  and uploader_identity_id = public.current_partyup_identity_id()
  and public.is_room_memory_participant(room_id)
  and split_part(media_path, '/', 1) = room_id::text
  and split_part(media_path, '/', 2) = uploader_identity_id::text
);

drop policy if exists mission_memory_verifications_select_own_or_host on public.mission_memory_verifications;
create policy mission_memory_verifications_select_own_or_host
on public.mission_memory_verifications
for select
to authenticated
using (
  participant_identity_id = public.current_partyup_identity_id()
  or exists (
    select 1 from public.room_missions mission
    where mission.id = mission_memory_verifications.mission_id
      and public.is_room_host(mission.room_id)
  )
);

revoke all on function public.has_valid_memory_mission_evidence(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_memory_mission_completion_evidence() from public, anon, authenticated;
revoke all on function public.publish_memory_room_mission(uuid, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.publish_wild_memory_mission(uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.verify_memory_mission_completion(uuid, uuid) from public, anon, authenticated;

grant execute on function public.publish_memory_room_mission(uuid, text, text, integer, text) to authenticated;
grant execute on function public.publish_wild_memory_mission(uuid, text, text, text, text, integer, integer, text) to authenticated;
grant execute on function public.verify_memory_mission_completion(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
