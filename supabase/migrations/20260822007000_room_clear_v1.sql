create table if not exists public.room_clear_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  host_id uuid not null,
  message text null check (message is null or char_length(message) <= 500),
  removed_count integer not null default 0 check (removed_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists room_clear_events_room_created_idx
  on public.room_clear_events(room_id, created_at desc);

create table if not exists public.room_clear_recipients (
  clear_event_id uuid not null references public.room_clear_events(id) on delete cascade,
  user_id uuid not null,
  username text null,
  previous_status text null,
  acknowledged_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (clear_event_id, user_id)
);

create index if not exists room_clear_recipients_user_pending_idx
  on public.room_clear_recipients(user_id, created_at desc)
  where acknowledged_at is null;

alter table public.room_clear_events enable row level security;
alter table public.room_clear_recipients enable row level security;

revoke all on public.room_clear_events from anon, authenticated;
revoke all on public.room_clear_recipients from anon, authenticated;
grant select on public.room_clear_events to authenticated;
grant select on public.room_clear_recipients to authenticated;

drop policy if exists room_clear_events_select_authorized on public.room_clear_events;
create policy room_clear_events_select_authorized
  on public.room_clear_events
  for select
  to authenticated
  using (host_id = auth.uid());

drop policy if exists room_clear_recipients_select_authorized on public.room_clear_recipients;
create policy room_clear_recipients_select_authorized
  on public.room_clear_recipients
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.clear_event_room(
  p_room_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.event_rooms;
  v_clear_event_id uuid;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_removed_count integer := 0;
  v_cleared_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'The participant message must be 500 characters or fewer';
  end if;

  select *
  into v_room
  from public.event_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  if v_room.host_id <> v_user_id then
    raise exception 'Only the room host can clear participants';
  end if;

  if v_room.status::text = 'ended' then
    raise exception 'An ended room cannot be cleared';
  end if;

  insert into public.room_clear_events (room_id, host_id, message)
  values (p_room_id, v_user_id, v_message)
  returning id into v_clear_event_id;

  insert into public.room_clear_recipients (
    clear_event_id,
    user_id,
    username,
    previous_status,
    created_at
  )
  select
    v_clear_event_id,
    attendee.user_id,
    attendee.username,
    attendee.status::text,
    v_cleared_at
  from public.event_attendees attendee
  where attendee.event_room_id = p_room_id
    and attendee.user_id <> v_user_id
  on conflict (clear_event_id, user_id) do nothing;

  get diagnostics v_removed_count = row_count;

  update public.room_clear_events
  set removed_count = v_removed_count
  where id = v_clear_event_id;

  delete from public.event_attendees attendee
  where attendee.event_room_id = p_room_id
    and attendee.user_id <> v_user_id;

  if to_regclass('public.room_chat_mutes') is not null then
    execute 'delete from public.room_chat_mutes where room_id = $1'
      using p_room_id;
  end if;

  delete from public.match_queue queue
  using public.match_pools pool
  where queue.pool_id = pool.id
    and pool.pool_type::text = 'event'
    and pool.source_id = p_room_id;

  update public.match_sessions session
  set status = 'ended',
      ended_at = coalesce(session.ended_at, v_cleared_at),
      ended_reason = coalesce(session.ended_reason, 'room_cleared')
  from public.match_pools pool
  where session.pool_id = pool.id
    and pool.pool_type::text = 'event'
    and pool.source_id = p_room_id
    and session.status::text <> 'ended';

  if to_regclass('public.room_presence') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'room_presence'
        and column_name = 'user_id'
    ) then
      execute 'delete from public.room_presence where room_id = $1 and user_id <> $2'
        using p_room_id, v_user_id;
    else
      execute 'delete from public.room_presence where room_id = $1'
        using p_room_id;
    end if;
  end if;

  if to_regclass('public.room_typing') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'room_typing'
        and column_name = 'user_id'
    ) then
      execute 'delete from public.room_typing where room_id = $1 and user_id <> $2'
        using p_room_id, v_user_id;
    else
      execute 'delete from public.room_typing where room_id = $1'
        using p_room_id;
    end if;
  end if;

  update public.event_rooms
  set current_users = 0,
      queue_count = 0,
      last_active_at = v_cleared_at
  where id = p_room_id;

  return jsonb_build_object(
    'clear_event_id', v_clear_event_id,
    'room_id', p_room_id,
    'removed_count', v_removed_count,
    'message_sent', v_message is not null,
    'cleared_at', v_cleared_at
  );
end;
$$;

create or replace function public.get_pending_room_clear_notice()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'clear_event_id', clear_event.id,
    'room_id', clear_event.room_id,
    'message', clear_event.message,
    'created_at', clear_event.created_at
  )
  from public.room_clear_recipients recipient
  join public.room_clear_events clear_event
    on clear_event.id = recipient.clear_event_id
  where recipient.user_id = auth.uid()
    and recipient.acknowledged_at is null
  order by clear_event.created_at desc
  limit 1;
$$;

create or replace function public.acknowledge_room_clear_notice(p_clear_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.room_clear_recipients
  set acknowledged_at = coalesce(acknowledged_at, now())
  where clear_event_id = p_clear_event_id
    and user_id = auth.uid();

  return found;
end;
$$;

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
      and attendee.status::text = 'accepted'
  )
  or exists (
    select 1
    from public.room_clear_events clear_event
    join public.room_clear_recipients recipient
      on recipient.clear_event_id = clear_event.id
    where clear_event.room_id = p_room_id
      and recipient.user_id = auth.uid()
      and recipient.previous_status = 'accepted'
  );
$$;

revoke all on function public.clear_event_room(uuid, text) from public, anon, authenticated;
revoke all on function public.get_pending_room_clear_notice() from public, anon, authenticated;
revoke all on function public.acknowledge_room_clear_notice(uuid) from public, anon, authenticated;

grant execute on function public.clear_event_room(uuid, text) to authenticated;
grant execute on function public.get_pending_room_clear_notice() to authenticated;
grant execute on function public.acknowledge_room_clear_notice(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'room_clear_recipients'
     ) then
    alter publication supabase_realtime add table public.room_clear_recipients;
  end if;
end;
$$;

notify pgrst, 'reload schema';
