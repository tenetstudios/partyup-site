create table if not exists public.room_memories (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  uploader_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null,
  thumbnail_path text null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists room_memories_room_created_idx
  on public.room_memories(room_id, created_at desc)
  where deleted_at is null;

create index if not exists room_memories_uploader_idx
  on public.room_memories(uploader_identity_id);

alter table public.room_memories enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-memories',
  'room-memories',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_room_memory_participant(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and room.host_id = auth.uid()
  )
  or exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_room_id = p_room_id
      and attendee.user_id = auth.uid()
      and attendee.status = 'accepted'
  );
$$;

create or replace function public.current_partyup_identity_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.partyup_identities
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_delete_room_memory(p_memory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_memories memory
    join public.partyup_identities identity
      on identity.id = memory.uploader_identity_id
    where memory.id = p_memory_id
      and identity.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.room_memories memory
    join public.event_rooms room
      on room.id = memory.room_id
    where memory.id = p_memory_id
      and room.host_id = auth.uid()
  );
$$;

drop policy if exists room_memories_select_room_participants on public.room_memories;
create policy room_memories_select_room_participants
  on public.room_memories
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_room_memory_participant(room_id)
  );

drop policy if exists room_memories_insert_own_identity on public.room_memories;
create policy room_memories_insert_own_identity
  on public.room_memories
  for insert
  to authenticated
  with check (
    deleted_at is null
    and uploader_identity_id = public.current_partyup_identity_id()
    and public.is_room_memory_participant(room_id)
  );

drop policy if exists room_memories_soft_delete_own_or_host on public.room_memories;
create policy room_memories_soft_delete_own_or_host
  on public.room_memories
  for update
  to authenticated
  using (public.can_delete_room_memory(id))
  with check (public.can_delete_room_memory(id));

drop policy if exists room_memories_storage_insert_participant on storage.objects;
create policy room_memories_storage_insert_participant
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'room-memories'
    and public.is_room_memory_participant(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = public.current_partyup_identity_id()
  );

drop policy if exists room_memories_storage_select_participant on storage.objects;
create policy room_memories_storage_select_participant
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'room-memories'
    and public.is_room_memory_participant(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists room_memories_storage_delete_owner_or_host on storage.objects;
create policy room_memories_storage_delete_owner_or_host
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'room-memories'
    and (
      ((storage.foldername(name))[2])::uuid = public.current_partyup_identity_id()
      or exists (
        select 1
        from public.event_rooms room
        where room.id = ((storage.foldername(name))[1])::uuid
          and room.host_id = auth.uid()
      )
    )
  );

create or replace function public.get_room_memories(p_room_id uuid)
returns table (
  id uuid,
  room_id uuid,
  uploader_identity_id uuid,
  media_type text,
  media_path text,
  thumbnail_path text,
  created_at timestamptz,
  uploader_name text,
  uploader_avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    memory.id,
    memory.room_id,
    memory.uploader_identity_id,
    memory.media_type,
    memory.media_path,
    memory.thumbnail_path,
    memory.created_at,
    coalesce(profile.username, 'Guest ' || left(memory.uploader_identity_id::text, 4)) as uploader_name,
    profile.avatar_url as uploader_avatar_url
  from public.room_memories memory
  join public.partyup_identities identity
    on identity.id = memory.uploader_identity_id
  left join public.profiles profile
    on profile.id = identity.user_id
  where memory.room_id = p_room_id
    and memory.deleted_at is null
    and public.is_room_memory_participant(p_room_id)
  order by memory.created_at desc;
$$;

grant select, insert on public.room_memories to authenticated;
revoke update on public.room_memories from authenticated;
grant update (deleted_at) on public.room_memories to authenticated;
grant execute on function public.is_room_memory_participant(uuid) to authenticated;
grant execute on function public.current_partyup_identity_id() to authenticated;
grant execute on function public.can_delete_room_memory(uuid) to authenticated;
grant execute on function public.get_room_memories(uuid) to authenticated;
