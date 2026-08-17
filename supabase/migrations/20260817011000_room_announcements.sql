create extension if not exists pgcrypto;

create table if not exists public.room_announcements (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text null,
  cta_label text null,
  cta_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz null,
  constraint room_announcements_title_length
    check (char_length(title) between 1 and 120),
  constraint room_announcements_message_length
    check (message is null or char_length(message) <= 500),
  constraint room_announcements_cta_label_length
    check (cta_label is null or char_length(cta_label) <= 40),
  constraint room_announcements_cta_url_length
    check (cta_url is null or char_length(cta_url) <= 500),
  constraint room_announcements_http_cta_url
    check (
      cta_url is null
      or cta_url ~* '^https?://'
      or cta_url ~ '^/'
    )
);

create unique index if not exists room_announcements_one_active_per_room_idx
  on public.room_announcements(room_id)
  where is_active = true;

create index if not exists room_announcements_room_active_idx
  on public.room_announcements(room_id, is_active, expires_at);

create index if not exists room_announcements_created_by_idx
  on public.room_announcements(created_by);

create or replace function public.set_room_announcements_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists room_announcements_set_updated_at on public.room_announcements;
create trigger room_announcements_set_updated_at
before update on public.room_announcements
for each row
execute function public.set_room_announcements_updated_at();

alter table public.room_announcements enable row level security;

revoke all on public.room_announcements from anon, authenticated;
grant select on public.room_announcements to anon, authenticated;

drop policy if exists room_announcements_select_for_existing_rooms on public.room_announcements;
create policy room_announcements_select_for_existing_rooms
on public.room_announcements
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.event_rooms rooms
    where rooms.id = room_announcements.room_id
  )
);

create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_rooms rooms
    where rooms.id = p_room_id
      and rooms.host_id = auth.uid()
  );
$$;

revoke all on function public.is_room_host(uuid) from public, anon, authenticated;
grant execute on function public.is_room_host(uuid) to authenticated;

create or replace function public.get_active_room_announcement(p_room_id uuid)
returns setof public.room_announcements
language sql
security definer
set search_path = public
as $$
  select announcements.*
  from public.room_announcements announcements
  where announcements.room_id = p_room_id
    and announcements.is_active = true
    and (announcements.expires_at is null or announcements.expires_at > now())
  order by announcements.updated_at desc
  limit 1;
$$;

revoke all on function public.get_active_room_announcement(uuid) from public, anon, authenticated;
grant execute on function public.get_active_room_announcement(uuid) to anon, authenticated;

create or replace function public.publish_room_announcement(
  p_room_id uuid,
  p_title text,
  p_message text default null,
  p_cta_label text default null,
  p_cta_url text default null,
  p_expires_at timestamptz default null
)
returns public.room_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_announcement public.room_announcements;
  v_title text := nullif(btrim(p_title), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_cta_label text := nullif(btrim(coalesce(p_cta_label, '')), '');
  v_cta_url text := nullif(btrim(coalesce(p_cta_url, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can manage announcements';
  end if;

  if v_title is null then
    raise exception 'Announcement title is required';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'Announcement title is too long';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'Announcement message is too long';
  end if;

  if v_cta_label is not null and char_length(v_cta_label) > 40 then
    raise exception 'CTA label is too long';
  end if;

  if v_cta_url is not null and char_length(v_cta_url) > 500 then
    raise exception 'CTA URL is too long';
  end if;

  if v_cta_url is not null and v_cta_url !~* '^https?://' and v_cta_url !~ '^/' then
    raise exception 'CTA URL must be http(s) or an app-relative path';
  end if;

  if v_cta_label is null then
    v_cta_url := null;
  end if;

  if v_cta_url is null then
    v_cta_label := null;
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiration must be in the future';
  end if;

  perform pg_advisory_xact_lock(hashtext('partyup-room-announcement:' || p_room_id::text));

  update public.room_announcements
  set is_active = false
  where room_id = p_room_id
    and is_active = true;

  insert into public.room_announcements (
    room_id,
    created_by,
    title,
    message,
    cta_label,
    cta_url,
    expires_at,
    is_active
  )
  values (
    p_room_id,
    v_user_id,
    v_title,
    v_message,
    v_cta_label,
    v_cta_url,
    p_expires_at,
    true
  )
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.publish_room_announcement(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_room_announcement(uuid, text, text, text, text, timestamptz) to authenticated;

create or replace function public.update_room_announcement(
  p_announcement_id uuid,
  p_title text,
  p_message text default null,
  p_cta_label text default null,
  p_cta_url text default null,
  p_expires_at timestamptz default null
)
returns public.room_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.room_announcements;
  v_title text := nullif(btrim(p_title), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_cta_label text := nullif(btrim(coalesce(p_cta_label, '')), '');
  v_cta_url text := nullif(btrim(coalesce(p_cta_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_announcement
  from public.room_announcements
  where id = p_announcement_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Active announcement not found';
  end if;

  if not public.is_room_host(v_announcement.room_id) then
    raise exception 'Only the room host can manage announcements';
  end if;

  if v_title is null then
    raise exception 'Announcement title is required';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'Announcement title is too long';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'Announcement message is too long';
  end if;

  if v_cta_label is not null and char_length(v_cta_label) > 40 then
    raise exception 'CTA label is too long';
  end if;

  if v_cta_url is not null and char_length(v_cta_url) > 500 then
    raise exception 'CTA URL is too long';
  end if;

  if v_cta_url is not null and v_cta_url !~* '^https?://' and v_cta_url !~ '^/' then
    raise exception 'CTA URL must be http(s) or an app-relative path';
  end if;

  if v_cta_label is null then
    v_cta_url := null;
  end if;

  if v_cta_url is null then
    v_cta_label := null;
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiration must be in the future';
  end if;

  update public.room_announcements
  set title = v_title,
      message = v_message,
      cta_label = v_cta_label,
      cta_url = v_cta_url,
      expires_at = p_expires_at
  where id = p_announcement_id
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.update_room_announcement(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_room_announcement(uuid, text, text, text, text, timestamptz) to authenticated;

create or replace function public.end_room_announcement(p_announcement_id uuid)
returns public.room_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.room_announcements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_announcement
  from public.room_announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'Announcement not found';
  end if;

  if not public.is_room_host(v_announcement.room_id) then
    raise exception 'Only the room host can manage announcements';
  end if;

  update public.room_announcements
  set is_active = false
  where id = p_announcement_id
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.end_room_announcement(uuid) from public, anon, authenticated;
grant execute on function public.end_room_announcement(uuid) to authenticated;

notify pgrst, 'reload schema';
