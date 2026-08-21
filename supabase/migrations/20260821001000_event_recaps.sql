create table if not exists public.event_recaps (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  room_title text not null,
  event_date timestamptz not null,
  cover_image_url text null,
  host_user_id uuid null,
  created_at timestamptz not null default now(),
  constraint event_recaps_identity_room_unique unique (identity_id, room_id)
);

create index if not exists event_recaps_identity_created_idx
  on public.event_recaps(identity_id, created_at desc);

alter table public.event_recaps enable row level security;

drop policy if exists event_recaps_select_own on public.event_recaps;
create policy event_recaps_select_own
  on public.event_recaps
  for select
  to authenticated
  using (identity_id = public.current_partyup_identity_id());

revoke all on public.event_recaps from anon, authenticated;
grant select on public.event_recaps to authenticated;

create table if not exists public.room_recap_messages (
  room_id uuid primary key references public.event_rooms(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

alter table public.room_recap_messages enable row level security;

drop policy if exists room_recap_messages_select_participants on public.room_recap_messages;
create policy room_recap_messages_select_participants
  on public.room_recap_messages
  for select
  to authenticated
  using (public.is_room_memory_participant(room_id));

drop policy if exists room_recap_messages_manage_host on public.room_recap_messages;
create policy room_recap_messages_manage_host
  on public.room_recap_messages
  for all
  to authenticated
  using (
    exists (
      select 1 from public.event_rooms room
      where room.id = room_recap_messages.room_id
        and room.host_id = auth.uid()
    )
  )
  with check (
    updated_by = auth.uid()
    and exists (
      select 1 from public.event_rooms room
      where room.id = room_recap_messages.room_id
        and room.host_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.room_recap_messages to authenticated;

alter table public.notifications
  add column if not exists recap_room_id uuid null;

create unique index if not exists notifications_event_recap_user_room_idx
  on public.notifications(user_id, recap_room_id)
  where recap_room_id is not null;

create or replace function public.notify_event_recap_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.partyup_identities
  where id = new.identity_id;

  if v_user_id is not null and new.host_user_id is not null then
    insert into public.notifications (
      user_id,
      actor_id,
      type,
      title,
      body,
      room_id,
      recap_room_id,
      is_read
    )
    values (
      v_user_id,
      new.host_user_id,
      'room_approved',
      'Your recap is ready',
      'See what happened at ' || new.room_title || '.',
      new.room_id,
      new.room_id,
      false
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists event_recaps_notify_ready on public.event_recaps;
create trigger event_recaps_notify_ready
after insert on public.event_recaps
for each row execute function public.notify_event_recap_ready();

create or replace function public.create_event_recaps_for_room(p_room_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.event_rooms;
  v_inserted integer := 0;
begin
  select * into v_room
  from public.event_rooms
  where id = p_room_id;

  if not found or v_room.status::text <> 'ended' then
    return 0;
  end if;

  insert into public.event_recaps (
    room_id,
    identity_id,
    room_title,
    event_date,
    cover_image_url,
    host_user_id
  )
  select
    v_room.id,
    identity.id,
    coalesce(nullif(v_room.title, ''), 'PartyUp event'),
    coalesce(v_room.scheduled_at, v_room.created_at, now()),
    to_jsonb(v_room)->>'image_url',
    v_room.host_id
  from public.partyup_identities identity
  where identity.user_id is not null
    and (
      identity.user_id = v_room.host_id
      or exists (
        select 1
        from public.event_attendees attendee
        where attendee.event_room_id = v_room.id
          and attendee.user_id = identity.user_id
          and attendee.status::text = 'accepted'
      )
    )
  on conflict (identity_id, room_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.create_event_recaps_for_room(uuid) from public, anon, authenticated;

create or replace function public.create_event_recaps_when_room_ends()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'ended'
     and old.status::text is distinct from 'ended' then
    perform public.create_event_recaps_for_room(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists event_rooms_create_recaps_on_end on public.event_rooms;
create trigger event_rooms_create_recaps_on_end
after update of status on public.event_rooms
for each row execute function public.create_event_recaps_when_room_ends();

create or replace function public.resolve_my_event_recaps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_created integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  for v_room_id in
    select room.id
    from public.event_rooms room
    where room.status::text = 'ended'
      and (
        room.host_id = v_user_id
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = v_user_id
            and attendee.status::text = 'accepted'
        )
      )
  loop
    v_created := v_created + public.create_event_recaps_for_room(v_room_id);
  end loop;

  return v_created;
end;
$$;

revoke all on function public.resolve_my_event_recaps() from public, anon, authenticated;
grant execute on function public.resolve_my_event_recaps() to authenticated;

create or replace function public.get_event_recap(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.current_partyup_identity_id();
  v_recap public.event_recaps;
  v_message text;
  v_connections jsonb := '[]'::jsonb;
  v_people_count integer := 0;
  v_memory_count integer := 0;
  v_match_count integer := 0;
  v_connection_count integer := 0;
  v_saved_count integer := 0;
begin
  if v_identity_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_recap
  from public.event_recaps
  where room_id = p_room_id
    and identity_id = v_identity_id;

  if not found then
    raise exception 'Recap not found';
  end if;

  select message into v_message
  from public.room_recap_messages
  where room_id = p_room_id;

  select count(distinct attendee.user_id)::integer into v_people_count
  from public.event_attendees attendee
  where attendee.event_room_id = p_room_id
    and attendee.status::text = 'accepted';

  select count(*)::integer into v_memory_count
  from public.room_memories memory
  where memory.room_id = p_room_id
    and memory.deleted_at is null;

  select count(*)::integer into v_match_count
  from public.match_sessions session
  join public.match_pools pool on pool.id = session.pool_id
  where pool.pool_type = 'event'
    and pool.source_id = p_room_id
    and session.status = 'ended';

  select count(*)::integer into v_connection_count
  from public.partyup_connections connection
  join public.match_pools pool on pool.id = connection.source_pool_id
  where pool.pool_type = 'event'
    and pool.source_id = p_room_id
    and connection.removed_at is null;

  select count(*)::integer into v_saved_count
  from public.saved_memories saved
  join public.room_memories memory on memory.id = saved.memory_id
  where saved.user_identity_id = v_identity_id
    and memory.room_id = p_room_id
    and memory.deleted_at is null;

  select coalesce(jsonb_agg(person order by connected_at desc), '[]'::jsonb)
  into v_connections
  from (
    select
      connection.connected_at,
      jsonb_build_object(
        'connection_id', connection.id,
        'identity_id', other_identity.id,
        'profile_user_id', other_identity.user_id,
        'username', profile.username,
        'display_name', to_jsonb(profile)->>'display_name',
        'avatar_url', profile.avatar_url,
        'connected_at', coalesce(connection.connected_at, connection.created_at)
      ) as person
    from public.partyup_connections connection
    join public.match_pools pool
      on pool.id = connection.source_pool_id
     and pool.pool_type = 'event'
     and pool.source_id = p_room_id
    join public.partyup_identities other_identity
      on other_identity.id = case
        when connection.identity_a = v_identity_id then connection.identity_b
        else connection.identity_a
      end
    left join public.profiles profile on profile.id = other_identity.user_id
    where connection.removed_at is null
      and v_identity_id in (connection.identity_a, connection.identity_b)
  ) rows;

  return jsonb_build_object(
    'id', v_recap.id,
    'room_id', v_recap.room_id,
    'room_title', v_recap.room_title,
    'event_date', v_recap.event_date,
    'cover_image_url', v_recap.cover_image_url,
    'created_at', v_recap.created_at,
    'host_message', v_message,
    'connections', v_connections,
    'metrics', jsonb_build_object(
      'people', v_people_count,
      'memories', v_memory_count,
      'matches', v_match_count,
      'connections', v_connection_count
    ),
    'personal', jsonb_build_object(
      'connections', jsonb_array_length(v_connections),
      'saved_memories', v_saved_count
    )
  );
end;
$$;

revoke all on function public.get_event_recap(uuid) from public, anon, authenticated;
grant execute on function public.get_event_recap(uuid) to authenticated;

create or replace function public.set_room_recap_message(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not exists (
    select 1 from public.event_rooms
    where id = p_room_id and host_id = auth.uid()
  ) then
    raise exception 'Only the room host can edit the after-event message';
  end if;

  if v_message is null then
    delete from public.room_recap_messages where room_id = p_room_id;
    return;
  end if;

  if char_length(v_message) > 500 then
    raise exception 'After-event message must be 500 characters or fewer';
  end if;

  insert into public.room_recap_messages (room_id, message, updated_by)
  values (p_room_id, v_message, auth.uid())
  on conflict (room_id) do update
    set message = excluded.message,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.set_room_recap_message(uuid, text) from public, anon, authenticated;
grant execute on function public.set_room_recap_message(uuid, text) to authenticated;

select public.create_event_recaps_for_room(room.id)
from public.event_rooms room
where room.status::text = 'ended';

notify pgrst, 'reload schema';
