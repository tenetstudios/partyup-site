create table if not exists public.saved_memories (
  id uuid primary key default gen_random_uuid(),
  user_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  memory_id uuid not null references public.room_memories(id) on delete cascade,
  saved_at timestamptz not null default now(),
  constraint saved_memories_unique_identity_memory unique (user_identity_id, memory_id)
);

create index if not exists saved_memories_identity_saved_at_idx
  on public.saved_memories(user_identity_id, saved_at desc);

create index if not exists saved_memories_memory_id_idx
  on public.saved_memories(memory_id);

alter table public.saved_memories enable row level security;

drop policy if exists saved_memories_select_own on public.saved_memories;
create policy saved_memories_select_own
  on public.saved_memories
  for select
  to authenticated
  using (user_identity_id = public.current_partyup_identity_id());

drop policy if exists saved_memories_insert_own_visible_memory on public.saved_memories;
create policy saved_memories_insert_own_visible_memory
  on public.saved_memories
  for insert
  to authenticated
  with check (
    user_identity_id = public.current_partyup_identity_id()
    and exists (
      select 1
      from public.room_memories memory
      where memory.id = saved_memories.memory_id
        and memory.deleted_at is null
        and public.is_room_memory_participant(memory.room_id)
    )
  );

drop policy if exists saved_memories_delete_own on public.saved_memories;
create policy saved_memories_delete_own
  on public.saved_memories
  for delete
  to authenticated
  using (user_identity_id = public.current_partyup_identity_id());

grant select, insert, delete on public.saved_memories to authenticated;

create or replace function public.get_saved_room_memory_ids(p_memory_ids uuid[])
returns table (
  memory_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
begin
  if auth.uid() is null or v_identity_id is null then
    return;
  end if;

  return query
  select saved.memory_id
  from public.saved_memories saved
  join public.room_memories memory
    on memory.id = saved.memory_id
  where saved.user_identity_id = v_identity_id
    and saved.memory_id = any(coalesce(p_memory_ids, array[]::uuid[]))
    and memory.deleted_at is null
    and public.is_room_memory_participant(memory.room_id);
end;
$$;

create or replace function public.save_room_memory(p_memory_id uuid)
returns table (
  saved boolean,
  saved_memory_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_memory public.room_memories;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  select *
  into v_memory
  from public.room_memories
  where id = p_memory_id
    and deleted_at is null;

  if not found then
    raise exception 'Memory not found';
  end if;

  if not public.is_room_memory_participant(v_memory.room_id) then
    raise exception 'Not allowed to save this Memory';
  end if;

  insert into public.saved_memories (user_identity_id, memory_id)
  values (v_identity_id, p_memory_id)
  on conflict (user_identity_id, memory_id)
  do update set saved_at = public.saved_memories.saved_at
  returning id into saved_memory_id;

  saved := true;
  return next;
end;
$$;

create or replace function public.unsave_room_memory(p_memory_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  delete from public.saved_memories
  where user_identity_id = v_identity_id
    and memory_id = p_memory_id;
end;
$$;

create or replace function public.get_my_saved_memories()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_payload jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  select coalesce(jsonb_agg(group_row order by (group_row->>'latest_saved_at')::timestamptz desc), '[]'::jsonb)
  into v_payload
  from (
    select jsonb_build_object(
      'room_id', grouped.room_id,
      'room_title', grouped.room_title,
      'room_date', grouped.room_date,
      'latest_saved_at', grouped.latest_saved_at,
      'memory_count', grouped.memory_count,
      'memories', grouped.memories
    ) as group_row
    from (
      select
        memory.room_id,
        coalesce(nullif(room.title, ''), 'PartyUp event') as room_title,
        coalesce(
          to_jsonb(room)->>'scheduled_at',
          to_jsonb(room)->>'starts_at',
          to_jsonb(room)->>'created_at',
          min(memory.created_at)::text
        ) as room_date,
        max(saved.saved_at) as latest_saved_at,
        count(*)::integer as memory_count,
        jsonb_agg(
          jsonb_build_object(
            'id', memory.id,
            'saved_memory_id', saved.id,
            'room_id', memory.room_id,
            'uploader_identity_id', memory.uploader_identity_id,
            'media_type', memory.media_type,
            'media_path', memory.media_path,
            'thumbnail_path', memory.thumbnail_path,
            'created_at', memory.created_at,
            'saved_at', saved.saved_at,
            'uploader_name', coalesce(profile.username, 'Guest ' || left(memory.uploader_identity_id::text, 4)),
            'uploader_avatar_url', profile.avatar_url,
            'room_title', coalesce(nullif(room.title, ''), 'PartyUp event'),
            'room_date', coalesce(
              to_jsonb(room)->>'scheduled_at',
              to_jsonb(room)->>'starts_at',
              to_jsonb(room)->>'created_at',
              memory.created_at::text
            )
          )
          order by memory.created_at desc
        ) as memories
      from public.saved_memories saved
      join public.room_memories memory
        on memory.id = saved.memory_id
      join public.event_rooms room
        on room.id = memory.room_id
      join public.partyup_identities identity
        on identity.id = memory.uploader_identity_id
      left join public.profiles profile
        on profile.id = identity.user_id
      where saved.user_identity_id = v_identity_id
        and memory.deleted_at is null
        and public.is_room_memory_participant(memory.room_id)
      group by memory.room_id, room.title, to_jsonb(room)
    ) grouped
  ) rows;

  return v_payload;
end;
$$;

grant execute on function public.get_saved_room_memory_ids(uuid[]) to authenticated;
grant execute on function public.save_room_memory(uuid) to authenticated;
grant execute on function public.unsave_room_memory(uuid) to authenticated;
grant execute on function public.get_my_saved_memories() to authenticated;

notify pgrst, 'reload schema';
