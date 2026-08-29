create table if not exists public.room_recap_media (
  room_id uuid primary key references public.event_rooms(id) on delete cascade,
  media_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime')
  ),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 20971520),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint room_recap_media_type_mime_check check (
    (media_type = 'image' and mime_type like 'image/%' and file_size_bytes <= 10485760)
    or (media_type = 'video' and mime_type in ('video/mp4', 'video/webm', 'video/quicktime'))
  )
);

create or replace function public.can_view_room_recap_media(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      public.is_room_host(p_room_id)
      or exists (
        select 1
        from public.event_recaps recap
        where recap.room_id = p_room_id
          and recap.identity_id = public.current_partyup_identity_id()
      )
    );
$$;

create or replace function public.recap_media_path_room_id(p_name text)
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

create or replace function public.can_manage_room_recap_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.recap_media_path_room_id(p_name) is not null
    and public.is_room_host(public.recap_media_path_room_id(p_name))
    and split_part(p_name, '/', 2) ~ '^recap-media\.(jpe?g|png|webp|gif|mp4|webm|mov)$'
    and split_part(p_name, '/', 3) = '';
$$;

create or replace function public.can_view_room_recap_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.recap_media_path_room_id(p_name) is not null
    and public.can_view_room_recap_media(public.recap_media_path_room_id(p_name));
$$;

alter table public.room_recap_media enable row level security;

revoke all on public.room_recap_media from anon, authenticated;
grant select on public.room_recap_media to authenticated;

drop policy if exists room_recap_media_select_authorized on public.room_recap_media;
create policy room_recap_media_select_authorized
  on public.room_recap_media
  for select
  to authenticated
  using (public.can_view_room_recap_media(room_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-recap-media',
  'room-recap-media',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists room_recap_media_storage_select_authorized on storage.objects;
create policy room_recap_media_storage_select_authorized
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'room-recap-media'
    and public.can_view_room_recap_object(name)
  );

drop policy if exists room_recap_media_storage_insert_host on storage.objects;
create policy room_recap_media_storage_insert_host
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'room-recap-media'
    and public.can_manage_room_recap_object(name)
    and coalesce((metadata->>'size')::bigint, 0) <= case
      when lower(name) ~ '\.(jpe?g|png|webp|gif)$' then 10485760
      else 20971520
    end
  );

drop policy if exists room_recap_media_storage_update_host on storage.objects;
create policy room_recap_media_storage_update_host
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'room-recap-media'
    and public.can_manage_room_recap_object(name)
  )
  with check (
    bucket_id = 'room-recap-media'
    and public.can_manage_room_recap_object(name)
    and coalesce((metadata->>'size')::bigint, 0) <= case
      when lower(name) ~ '\.(jpe?g|png|webp|gif)$' then 10485760
      else 20971520
    end
  );

drop policy if exists room_recap_media_storage_delete_host on storage.objects;
create policy room_recap_media_storage_delete_host
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'room-recap-media'
    and public.can_manage_room_recap_object(name)
  );

create or replace function public.set_room_recap_media(
  p_room_id uuid,
  p_media_path text,
  p_media_type text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns public.room_recap_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extension text;
  v_result public.room_recap_media;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can add recap media';
  end if;

  if p_media_type = 'image' and p_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then
    v_extension := case p_mime_type
      when 'image/jpeg' then 'jpg'
      when 'image/png' then 'png'
      when 'image/webp' then 'webp'
      else 'gif'
    end;
  elsif p_media_type = 'video' and p_mime_type in ('video/mp4', 'video/webm', 'video/quicktime') then
    v_extension := case p_mime_type
      when 'video/mp4' then 'mp4'
      when 'video/webm' then 'webm'
      else 'mov'
    end;
  else
    raise exception 'Recap media must be a supported image, MP4, WebM, or MOV file';
  end if;

  if p_media_path <> (p_room_id::text || '/recap-media.' || v_extension) then
    raise exception 'Invalid recap media storage path';
  end if;

  if p_file_size_bytes <= 0
     or (p_media_type = 'image' and p_file_size_bytes > 10485760)
     or (p_media_type = 'video' and p_file_size_bytes > 20971520) then
    raise exception 'Recap media exceeds the allowed size';
  end if;

  insert into public.room_recap_media (
    room_id,
    media_path,
    media_type,
    mime_type,
    file_size_bytes,
    updated_by,
    updated_at
  )
  values (
    p_room_id,
    p_media_path,
    p_media_type,
    p_mime_type,
    p_file_size_bytes,
    auth.uid(),
    now()
  )
  on conflict (room_id) do update
  set media_path = excluded.media_path,
      media_type = excluded.media_type,
      mime_type = excluded.mime_type,
      file_size_bytes = excluded.file_size_bytes,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.remove_room_recap_media(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can remove recap media';
  end if;

  delete from public.room_recap_media
  where room_id = p_room_id
  returning media_path into v_path;

  return v_path;
end;
$$;

create or replace function public.get_event_recap_context(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_host_user_id uuid;
  v_host_profile public.profiles;
  v_media public.room_recap_media;
begin
  if v_identity_id is null then
    raise exception 'Authentication required';
  end if;

  select recap.host_user_id into v_host_user_id
  from public.event_recaps recap
  where recap.room_id = p_room_id
    and recap.identity_id = v_identity_id;

  if not found then
    raise exception 'Recap not found';
  end if;

  if v_host_user_id is not null then
    select * into v_host_profile
    from public.profiles
    where id = v_host_user_id;
  end if;

  select * into v_media
  from public.room_recap_media
  where room_id = p_room_id;

  return jsonb_build_object(
    'host', case when v_host_user_id is null then null else jsonb_build_object(
      'user_id', v_host_user_id,
      'username', v_host_profile.username,
      'display_name', to_jsonb(v_host_profile)->>'display_name',
      'avatar_url', v_host_profile.avatar_url,
      'is_following', exists (
        select 1 from public.follows follow
        where follow.follower_id = auth.uid()
          and follow.following_id = v_host_user_id
      ),
      'is_current_user', auth.uid() = v_host_user_id
    ) end,
    'host_media', case when v_media.room_id is null then null else jsonb_build_object(
      'media_path', v_media.media_path,
      'media_type', v_media.media_type,
      'mime_type', v_media.mime_type,
      'file_size_bytes', v_media.file_size_bytes
    ) end
  );
end;
$$;

revoke all on function public.set_room_recap_media(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.remove_room_recap_media(uuid) from public, anon, authenticated;
revoke all on function public.get_event_recap_context(uuid) from public, anon, authenticated;

grant execute on function public.set_room_recap_media(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.remove_room_recap_media(uuid) to authenticated;
grant execute on function public.get_event_recap_context(uuid) to authenticated;

notify pgrst, 'reload schema';
