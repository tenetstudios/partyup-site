create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  host_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text null check (description is null or char_length(description) <= 1000),
  cover_image_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_series_host_created_idx
  on public.event_series(host_identity_id, created_at desc);

create table if not exists public.series_follows (
  series_id uuid not null references public.event_series(id) on delete cascade,
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (series_id, identity_id)
);

create index if not exists series_follows_identity_created_idx
  on public.series_follows(identity_id, created_at desc);

alter table public.event_rooms
  add column if not exists series_id uuid null references public.event_series(id) on delete set null;

create index if not exists event_rooms_series_status_date_idx
  on public.event_rooms(series_id, status, scheduled_at desc)
  where series_id is not null;

alter table public.event_series enable row level security;
alter table public.series_follows enable row level security;

drop policy if exists event_series_select_public on public.event_series;
create policy event_series_select_public
  on public.event_series
  for select
  to anon, authenticated
  using (true);

drop policy if exists event_series_insert_own on public.event_series;
create policy event_series_insert_own
  on public.event_series
  for insert
  to authenticated
  with check (host_identity_id = public.current_partyup_identity_id());

drop policy if exists event_series_update_own on public.event_series;
create policy event_series_update_own
  on public.event_series
  for update
  to authenticated
  using (host_identity_id = public.current_partyup_identity_id())
  with check (host_identity_id = public.current_partyup_identity_id());

drop policy if exists event_series_delete_own on public.event_series;
create policy event_series_delete_own
  on public.event_series
  for delete
  to authenticated
  using (host_identity_id = public.current_partyup_identity_id());

drop policy if exists series_follows_select_own on public.series_follows;
create policy series_follows_select_own
  on public.series_follows
  for select
  to authenticated
  using (identity_id = public.current_partyup_identity_id());

drop policy if exists series_follows_insert_own on public.series_follows;
create policy series_follows_insert_own
  on public.series_follows
  for insert
  to authenticated
  with check (identity_id = public.current_partyup_identity_id());

drop policy if exists series_follows_delete_own on public.series_follows;
create policy series_follows_delete_own
  on public.series_follows
  for delete
  to authenticated
  using (identity_id = public.current_partyup_identity_id());

grant select, insert, update, delete on public.event_series to authenticated;
grant select on public.event_series to anon;
grant select, insert, delete on public.series_follows to authenticated;

create or replace function public.set_event_series_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists event_series_set_updated_at on public.event_series;
create trigger event_series_set_updated_at
before update on public.event_series
for each row execute function public.set_event_series_updated_at();

create or replace function public.validate_event_room_series_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_host_user_id uuid;
begin
  if new.series_id is null then
    return new;
  end if;

  select identity.user_id
  into v_series_host_user_id
  from public.event_series series
  join public.partyup_identities identity on identity.id = series.host_identity_id
  where series.id = new.series_id;

  if v_series_host_user_id is null or v_series_host_user_id <> new.host_id then
    raise exception 'A room can only be added to a series owned by its host';
  end if;

  return new;
end;
$$;

drop trigger if exists event_rooms_validate_series_owner on public.event_rooms;
create trigger event_rooms_validate_series_owner
before insert or update of series_id, host_id on public.event_rooms
for each row execute function public.validate_event_room_series_owner();

create or replace function public.create_event_series(
  p_name text,
  p_description text default null,
  p_cover_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_series_id uuid;
begin
  if auth.uid() is null or v_identity_id is null then
    raise exception 'Authentication and a PartyUp identity are required';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'Series name is required';
  end if;

  insert into public.event_series (host_identity_id, name, description, cover_image_url)
  values (
    v_identity_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_cover_image_url, '')), '')
  )
  returning id into v_series_id;

  return v_series_id;
end;
$$;

create or replace function public.update_event_series(
  p_series_id uuid,
  p_name text,
  p_description text default null,
  p_cover_image_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'Series name is required';
  end if;

  update public.event_series
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      cover_image_url = nullif(btrim(coalesce(p_cover_image_url, '')), '')
  where id = p_series_id
    and host_identity_id = public.current_partyup_identity_id();

  if not found then
    raise exception 'Series not found or not owned by the current user';
  end if;
end;
$$;

create or replace function public.set_event_series_follow(p_series_id uuid, p_follow boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
begin
  if auth.uid() is null or v_identity_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (select 1 from public.event_series where id = p_series_id) then
    raise exception 'Series not found';
  end if;

  if p_follow then
    insert into public.series_follows (series_id, identity_id)
    values (p_series_id, v_identity_id)
    on conflict do nothing;
  else
    delete from public.series_follows
    where series_id = p_series_id and identity_id = v_identity_id;
  end if;

  return p_follow;
end;
$$;

create or replace function public.get_my_event_series()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', series.id,
    'name', series.name,
    'description', series.description,
    'cover_image_url', series.cover_image_url,
    'event_count', (select count(*)::integer from public.event_rooms room where room.series_id = series.id)
  ) order by series.created_at desc), '[]'::jsonb)
  from public.event_series series
  where series.host_identity_id = public.current_partyup_identity_id();
$$;

create or replace function public.get_host_event_series(p_host_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', series.id,
    'name', series.name,
    'description', series.description,
    'cover_image_url', series.cover_image_url,
    'event_count', (select count(*)::integer from public.event_rooms room where room.series_id = series.id),
    'follower_count', (select count(*)::integer from public.series_follows follow where follow.series_id = series.id),
    'next_event_at', (
      select min(coalesce(room.scheduled_at, room.created_at))
      from public.event_rooms room
      where room.series_id = series.id
        and room.status::text in ('live', 'scheduled')
        and coalesce((to_jsonb(room)->>'is_private')::boolean, false) = false
    )
  ) order by series.created_at desc), '[]'::jsonb)
  from public.event_series series
  join public.partyup_identities identity on identity.id = series.host_identity_id
  where identity.user_id = p_host_user_id;
$$;

create or replace function public.get_event_series_profile(p_series_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', series.id,
    'name', series.name,
    'description', series.description,
    'cover_image_url', series.cover_image_url,
    'created_at', series.created_at,
    'host', jsonb_build_object(
      'user_id', host_identity.user_id,
      'username', host_profile.username,
      'display_name', to_jsonb(host_profile)->>'display_name',
      'avatar_url', host_profile.avatar_url,
      'is_verified_host', coalesce((to_jsonb(host_profile)->>'is_verified_host')::boolean, false)
    ),
    'follower_count', (select count(*)::integer from public.series_follows follow where follow.series_id = series.id),
    'is_following', coalesce(v_identity_id is not null and exists (
      select 1 from public.series_follows follow
      where follow.series_id = series.id and follow.identity_id = v_identity_id
    ), false),
    'is_owner', coalesce(v_identity_id = series.host_identity_id, false),
    'total_events', (select count(*)::integer from public.event_rooms room where room.series_id = series.id),
    'returning_attendees', (
      select count(*)::integer
      from (
        select attendee.user_id
        from public.event_rooms room
        join public.event_attendees attendee
          on attendee.event_room_id = room.id and attendee.status::text = 'accepted'
        where room.series_id = series.id and attendee.user_id <> host_identity.user_id
        group by attendee.user_id
        having count(distinct room.id) >= 2
      ) returning_people
    ),
    'upcoming_events', (
      select coalesce(jsonb_agg(event_row order by sort_date asc), '[]'::jsonb)
      from (
        select coalesce(room.scheduled_at, room.created_at) as sort_date,
          jsonb_build_object(
            'id', room.id,
            'title', coalesce(nullif(room.title, ''), 'PartyUp event'),
            'status', room.status::text,
            'event_date', coalesce(room.scheduled_at, room.created_at),
            'venue_name', to_jsonb(room)->>'venue_name',
            'cover_image_url', coalesce(to_jsonb(room)->>'cover_image', to_jsonb(room)->>'image_url'),
            'people_count', (select count(distinct attendee.user_id)::integer from public.event_attendees attendee where attendee.event_room_id = room.id and attendee.status::text = 'accepted'),
            'memory_count', (select count(*)::integer from public.room_memories memory where memory.room_id = room.id and memory.deleted_at is null)
          ) event_row
        from public.event_rooms room
        where room.series_id = series.id
          and room.status::text in ('live', 'scheduled')
          and coalesce((to_jsonb(room)->>'is_private')::boolean, false) = false
      ) upcoming
    ),
    'past_events', (
      select coalesce(jsonb_agg(event_row order by sort_date desc), '[]'::jsonb)
      from (
        select coalesce(room.scheduled_at, room.created_at) as sort_date,
          jsonb_build_object(
            'id', room.id,
            'title', coalesce(nullif(room.title, ''), 'PartyUp event'),
            'status', room.status::text,
            'event_date', coalesce(room.scheduled_at, room.created_at),
            'venue_name', to_jsonb(room)->>'venue_name',
            'cover_image_url', coalesce(to_jsonb(room)->>'cover_image', to_jsonb(room)->>'image_url'),
            'people_count', (select count(distinct attendee.user_id)::integer from public.event_attendees attendee where attendee.event_room_id = room.id and attendee.status::text = 'accepted'),
            'memory_count', (select count(*)::integer from public.room_memories memory where memory.room_id = room.id and memory.deleted_at is null)
          ) event_row
        from public.event_rooms room
        where room.series_id = series.id
          and room.status::text = 'ended'
          and coalesce((to_jsonb(room)->>'is_private')::boolean, false) = false
      ) past
    )
  )
  into v_result
  from public.event_series series
  join public.partyup_identities host_identity on host_identity.id = series.host_identity_id
  left join public.profiles host_profile on host_profile.id = host_identity.user_id
  where series.id = p_series_id;

  return v_result;
end;
$$;

create or replace function public.get_my_followed_series_events()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', room.id,
    'title', coalesce(nullif(room.title, ''), 'PartyUp event'),
    'status', room.status::text,
    'event_date', coalesce(room.scheduled_at, room.created_at),
    'cover_image_url', coalesce(to_jsonb(room)->>'cover_image', to_jsonb(room)->>'image_url'),
    'series_id', series.id,
    'series_name', series.name
  ) order by case when room.status::text = 'live' then 0 else 1 end, coalesce(room.scheduled_at, room.created_at) asc), '[]'::jsonb)
  from public.series_follows follow
  join public.event_series series on series.id = follow.series_id
  join public.event_rooms room on room.series_id = series.id
  where follow.identity_id = public.current_partyup_identity_id()
    and room.status::text in ('live', 'scheduled')
    and coalesce((to_jsonb(room)->>'is_private')::boolean, false) = false;
$$;

revoke all on function public.create_event_series(text, text, text) from public, anon, authenticated;
revoke all on function public.update_event_series(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.set_event_series_follow(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_my_event_series() from public, anon, authenticated;
revoke all on function public.get_host_event_series(uuid) from public, anon, authenticated;
revoke all on function public.get_event_series_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_my_followed_series_events() from public, anon, authenticated;

grant execute on function public.create_event_series(text, text, text) to authenticated;
grant execute on function public.update_event_series(uuid, text, text, text) to authenticated;
grant execute on function public.set_event_series_follow(uuid, boolean) to authenticated;
grant execute on function public.get_my_event_series() to authenticated;
grant execute on function public.get_host_event_series(uuid) to anon, authenticated;
grant execute on function public.get_event_series_profile(uuid) to anon, authenticated;
grant execute on function public.get_my_followed_series_events() to authenticated;

notify pgrst, 'reload schema';
