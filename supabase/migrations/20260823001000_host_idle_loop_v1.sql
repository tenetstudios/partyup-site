create table if not exists public.room_idle_media (
  room_id uuid primary key references public.event_rooms(id) on delete cascade,
  media_path text not null,
  media_type text not null check (media_type in ('video', 'gif')),
  mime_type text not null check (mime_type in ('video/mp4', 'image/gif')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 20971520),
  enabled boolean not null default true,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint room_idle_media_type_mime_check check (
    (media_type = 'video' and mime_type = 'video/mp4' and file_size_bytes <= 20971520)
    or (media_type = 'gif' and mime_type = 'image/gif' and file_size_bytes <= 10485760)
  )
);

create table if not exists public.room_live_publishers (
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  participant_identity text not null,
  track_sid text not null,
  source text not null check (source in ('client', 'livekit', 'ingress')),
  updated_at timestamptz not null default now(),
  primary key (room_id, participant_identity, track_sid)
);

create table if not exists public.room_live_state (
  room_id uuid primary key references public.event_rooms(id) on delete cascade,
  is_live boolean not null default false,
  active_publisher_count integer not null default 0 check (active_publisher_count >= 0),
  signal_authoritative boolean not null default false,
  signal_source text null,
  updated_at timestamptz not null default now()
);

create or replace function public.can_view_room_idle_media(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.event_rooms room
      where room.id = p_room_id
        and (
          room.host_id = auth.uid()
          or not coalesce(room.is_private, false)
          or exists (
            select 1
            from public.event_attendees attendee
            where attendee.event_room_id = room.id
              and attendee.user_id = auth.uid()
              and attendee.status::text = 'accepted'
          )
        )
    );
$$;

create or replace function public.idle_media_path_room_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_segment text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_segment::uuid;
end;
$$;

create or replace function public.can_manage_room_idle_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.idle_media_path_room_id(p_name) is not null
    and public.is_room_host(public.idle_media_path_room_id(p_name))
    and split_part(p_name, '/', 2) in ('idle-loop.mp4', 'idle-loop.gif')
    and split_part(p_name, '/', 3) = '';
$$;

create or replace function public.can_view_room_idle_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.idle_media_path_room_id(p_name) is not null
    and public.can_view_room_idle_media(public.idle_media_path_room_id(p_name));
$$;

alter table public.room_idle_media enable row level security;
alter table public.room_live_publishers enable row level security;
alter table public.room_live_state enable row level security;

revoke all on public.room_idle_media from anon, authenticated;
revoke all on public.room_live_publishers from anon, authenticated;
revoke all on public.room_live_state from anon, authenticated;
grant select on public.room_idle_media to authenticated;
grant select on public.room_live_state to authenticated;

drop policy if exists room_idle_media_select_authorized on public.room_idle_media;
create policy room_idle_media_select_authorized
  on public.room_idle_media
  for select
  to authenticated
  using (public.can_view_room_idle_media(room_id));

drop policy if exists room_live_state_select_authorized on public.room_live_state;
create policy room_live_state_select_authorized
  on public.room_live_state
  for select
  to authenticated
  using (public.can_view_room_idle_media(room_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-idle-media',
  'room-idle-media',
  false,
  20971520,
  array['video/mp4', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists room_idle_media_storage_select_authorized on storage.objects;
create policy room_idle_media_storage_select_authorized
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'room-idle-media'
    and public.can_view_room_idle_object(name)
  );

drop policy if exists room_idle_media_storage_insert_host on storage.objects;
create policy room_idle_media_storage_insert_host
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'room-idle-media'
    and public.can_manage_room_idle_object(name)
    and case
      when lower(name) like '%.gif' then coalesce((metadata->>'size')::bigint, 0) <= 10485760
      else coalesce((metadata->>'size')::bigint, 0) <= 20971520
    end
  );

drop policy if exists room_idle_media_storage_update_host on storage.objects;
create policy room_idle_media_storage_update_host
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'room-idle-media'
    and public.can_manage_room_idle_object(name)
  )
  with check (
    bucket_id = 'room-idle-media'
    and public.can_manage_room_idle_object(name)
    and case
      when lower(name) like '%.gif' then coalesce((metadata->>'size')::bigint, 0) <= 10485760
      else coalesce((metadata->>'size')::bigint, 0) <= 20971520
    end
  );

drop policy if exists room_idle_media_storage_delete_host on storage.objects;
create policy room_idle_media_storage_delete_host
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'room-idle-media'
    and public.can_manage_room_idle_object(name)
  );

create or replace function public.set_room_idle_media(
  p_room_id uuid,
  p_media_path text,
  p_media_type text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_enabled boolean default true
)
returns public.room_idle_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_idle_media;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can configure Idle Loop';
  end if;

  if p_media_type not in ('video', 'gif')
     or p_mime_type not in ('video/mp4', 'image/gif')
     or (p_media_type = 'video' and p_mime_type <> 'video/mp4')
     or (p_media_type = 'gif' and p_mime_type <> 'image/gif') then
    raise exception 'Idle Loop supports MP4 video or GIF media';
  end if;

  if p_media_path <> (
    p_room_id::text || '/idle-loop.' ||
    case when p_media_type = 'gif' then 'gif' else 'mp4' end
  ) then
    raise exception 'Invalid Idle Loop storage path';
  end if;

  if p_file_size_bytes <= 0
     or (p_media_type = 'video' and p_file_size_bytes > 20971520)
     or (p_media_type = 'gif' and p_file_size_bytes > 10485760) then
    raise exception 'Idle Loop file exceeds the allowed size';
  end if;

  insert into public.room_idle_media (
    room_id,
    media_path,
    media_type,
    mime_type,
    file_size_bytes,
    enabled,
    updated_by,
    updated_at
  )
  values (
    p_room_id,
    p_media_path,
    p_media_type,
    p_mime_type,
    p_file_size_bytes,
    coalesce(p_enabled, true),
    auth.uid(),
    now()
  )
  on conflict (room_id) do update
  set media_path = excluded.media_path,
      media_type = excluded.media_type,
      mime_type = excluded.mime_type,
      file_size_bytes = excluded.file_size_bytes,
      enabled = excluded.enabled,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.set_room_idle_media_enabled(
  p_room_id uuid,
  p_enabled boolean
)
returns public.room_idle_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_idle_media;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can configure Idle Loop';
  end if;

  update public.room_idle_media
  set enabled = p_enabled,
      updated_by = auth.uid(),
      updated_at = now()
  where room_id = p_room_id
  returning * into v_result;

  if not found then
    raise exception 'Idle Loop is not configured';
  end if;

  return v_result;
end;
$$;

create or replace function public.remove_room_idle_media(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can configure Idle Loop';
  end if;

  delete from public.room_idle_media
  where room_id = p_room_id
  returning media_path into v_path;

  return v_path;
end;
$$;

create or replace function public.refresh_room_live_state(
  p_room_id uuid,
  p_signal_authoritative boolean default null,
  p_signal_source text default null
)
returns public.room_live_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_result public.room_live_state;
begin
  select count(distinct participant_identity)::integer
  into v_count
  from public.room_live_publishers
  where room_id = p_room_id;

  insert into public.room_live_state (
    room_id,
    is_live,
    active_publisher_count,
    signal_authoritative,
    signal_source,
    updated_at
  )
  values (
    p_room_id,
    v_count > 0,
    v_count,
    coalesce(p_signal_authoritative, false),
    p_signal_source,
    now()
  )
  on conflict (room_id) do update
  set is_live = excluded.is_live,
      active_publisher_count = excluded.active_publisher_count,
      signal_authoritative = coalesce(p_signal_authoritative, room_live_state.signal_authoritative),
      signal_source = coalesce(p_signal_source, room_live_state.signal_source),
      updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.report_room_live_publisher(
  p_room_id uuid,
  p_is_live boolean
)
returns public.room_live_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowed boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and room.status::text <> 'ended'
      and (
        room.host_id = v_user_id
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = v_user_id
            and attendee.status::text = 'accepted'
            and coalesce(attendee.can_stream, false)
        )
        or (
          not p_is_live
          and exists (
            select 1
            from public.room_live_publishers publisher
            where publisher.room_id = room.id
              and publisher.participant_identity = v_user_id::text
              and publisher.source = 'client'
          )
        )
      )
  ) into v_allowed;

  if not v_allowed then
    raise exception 'You are not authorized to publish in this room';
  end if;

  if p_is_live then
    insert into public.room_live_publishers (
      room_id,
      participant_identity,
      track_sid,
      source,
      updated_at
    )
    values (p_room_id, v_user_id::text, 'client-video', 'client', now())
    on conflict (room_id, participant_identity, track_sid) do update
    set updated_at = excluded.updated_at;
  else
    delete from public.room_live_publishers
    where room_id = p_room_id
      and participant_identity = v_user_id::text
      and source = 'client';
  end if;

  return public.refresh_room_live_state(p_room_id, null, 'client');
end;
$$;

create or replace function public.room_live_state_when_event_ends()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'ended' and old.status::text is distinct from 'ended' then
    delete from public.room_live_publishers where room_id = new.id;
    perform public.refresh_room_live_state(new.id, null, 'room_ended');
  end if;
  return new;
end;
$$;

drop trigger if exists event_rooms_clear_live_state_when_ended on public.event_rooms;
create trigger event_rooms_clear_live_state_when_ended
after update of status on public.event_rooms
for each row execute function public.room_live_state_when_event_ends();

revoke all on function public.set_room_idle_media(uuid, text, text, text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.set_room_idle_media_enabled(uuid, boolean) from public, anon, authenticated;
revoke all on function public.remove_room_idle_media(uuid) from public, anon, authenticated;
revoke all on function public.refresh_room_live_state(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.report_room_live_publisher(uuid, boolean) from public, anon, authenticated;

grant execute on function public.set_room_idle_media(uuid, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.set_room_idle_media_enabled(uuid, boolean) to authenticated;
grant execute on function public.remove_room_idle_media(uuid) to authenticated;
grant execute on function public.report_room_live_publisher(uuid, boolean) to authenticated;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['room_idle_media', 'room_live_state']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
