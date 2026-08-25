create table if not exists public.room_stream_queue (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'live', 'ended', 'removed')),
  priority integer not null check (priority > 0),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create unique index if not exists room_stream_queue_one_live_per_room
  on public.room_stream_queue (room_id)
  where status = 'live';

create index if not exists room_stream_queue_waiting_order
  on public.room_stream_queue (room_id, status, priority, approved_at);

alter table public.room_stream_queue enable row level security;
revoke all on public.room_stream_queue from anon, authenticated;
grant select on public.room_stream_queue to authenticated;

drop policy if exists room_stream_queue_select_host_or_self on public.room_stream_queue;
create policy room_stream_queue_select_host_or_self
  on public.room_stream_queue
  for select
  to authenticated
  using (
    public.is_room_host(room_id)
    or user_id = auth.uid()
    or (status = 'live' and public.can_view_room_idle_media(room_id))
  );

create or replace function public.approve_room_stream(
  p_room_id uuid,
  p_user_id uuid
)
returns public.room_stream_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_stream_queue;
  v_priority integer;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can manage the stream queue';
  end if;

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id and room.status::text <> 'ended'
  ) then
    raise exception 'This event is not available for streaming';
  end if;

  if not exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_room_id = p_room_id
      and attendee.user_id = p_user_id
      and attendee.status::text = 'accepted'
  ) then
    raise exception 'Only accepted room members can join the stream queue';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text || ':stream-queue', 0));

  select coalesce(max(queue.priority), 0) + 10
  into v_priority
  from public.room_stream_queue queue
  where queue.room_id = p_room_id
    and queue.status = 'waiting';

  insert into public.room_stream_queue (
    room_id, user_id, status, priority, approved_by, approved_at, started_at, ended_at, updated_at
  )
  values (
    p_room_id, p_user_id, 'waiting', v_priority, auth.uid(), now(), null, null, now()
  )
  on conflict (room_id, user_id) do update
  set status = case
        when room_stream_queue.status = 'live' then 'live'
        else 'waiting'
      end,
      priority = case
        when room_stream_queue.status = 'live' then room_stream_queue.priority
        else excluded.priority
      end,
      approved_by = excluded.approved_by,
      approved_at = case
        when room_stream_queue.status = 'live' then room_stream_queue.approved_at
        else excluded.approved_at
      end,
      started_at = case
        when room_stream_queue.status = 'live' then room_stream_queue.started_at
        else null
      end,
      ended_at = null,
      updated_at = now()
  returning * into v_result;

  update public.event_attendees
  set can_stream = (v_result.status = 'live')
  where event_room_id = p_room_id and user_id = p_user_id;

  return v_result;
end;
$$;

create or replace function public.start_room_stream(
  p_room_id uuid,
  p_user_id uuid
)
returns public.room_stream_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_stream_queue;
  v_previous_user_id uuid;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can start a queued stream';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text || ':stream-queue', 0));

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id and room.status::text <> 'ended'
  ) then
    raise exception 'This event is not available for streaming';
  end if;

  if not exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_room_id = p_room_id
      and attendee.user_id = p_user_id
      and attendee.status::text = 'accepted'
  ) then
    raise exception 'This user is no longer an accepted room member';
  end if;

  select queue.user_id
  into v_previous_user_id
  from public.room_stream_queue queue
  where queue.room_id = p_room_id and queue.status = 'live'
  for update;

  update public.room_stream_queue
  set status = 'ended', ended_at = now(), updated_at = now()
  where room_id = p_room_id and status = 'live' and user_id <> p_user_id;

  if v_previous_user_id is not null and v_previous_user_id <> p_user_id then
    update public.event_attendees
    set can_stream = false, stream_status = 'off'
    where event_room_id = p_room_id and user_id = v_previous_user_id;

    delete from public.room_live_publishers
    where room_id = p_room_id and participant_identity = v_previous_user_id::text;
  end if;

  update public.room_stream_queue
  set status = 'live', started_at = now(), ended_at = null, updated_at = now()
  where room_id = p_room_id
    and user_id = p_user_id
    and status in ('waiting', 'live')
  returning * into v_result;

  if not found then
    raise exception 'Approve this user before starting their stream';
  end if;

  update public.event_attendees
  set can_stream = (user_id = p_user_id),
      stream_status = case when user_id = p_user_id then stream_status else 'off' end
  where event_room_id = p_room_id
    and (user_id = p_user_id or coalesce(can_stream, false));

  perform public.refresh_room_live_state(p_room_id, null, 'stream_queue');
  return v_result;
end;
$$;

create or replace function public.end_room_stream(
  p_room_id uuid,
  p_user_id uuid default null
)
returns public.room_stream_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_stream_queue;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can end a queued stream';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text || ':stream-queue', 0));

  update public.room_stream_queue
  set status = 'ended', ended_at = now(), updated_at = now()
  where room_id = p_room_id
    and status = 'live'
    and (p_user_id is null or user_id = p_user_id)
  returning * into v_result;

  if not found then
    raise exception 'There is no matching live queued stream';
  end if;

  update public.event_attendees
  set can_stream = false, stream_status = 'off'
  where event_room_id = p_room_id and user_id = v_result.user_id;

  delete from public.room_live_publishers
  where room_id = p_room_id and participant_identity = v_result.user_id::text;

  perform public.refresh_room_live_state(p_room_id, null, 'stream_queue');
  return v_result;
end;
$$;

create or replace function public.remove_room_stream_queue_entry(
  p_room_id uuid,
  p_user_id uuid
)
returns public.room_stream_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.room_stream_queue;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can remove a queued stream';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text || ':stream-queue', 0));

  update public.room_stream_queue
  set status = 'removed', ended_at = now(), updated_at = now()
  where room_id = p_room_id and user_id = p_user_id and status in ('waiting', 'live')
  returning * into v_result;

  if not found then
    raise exception 'This user is not in the active stream queue';
  end if;

  update public.event_attendees
  set can_stream = false, stream_status = 'off'
  where event_room_id = p_room_id and user_id = p_user_id;

  delete from public.room_live_publishers
  where room_id = p_room_id and participant_identity = p_user_id::text;

  perform public.refresh_room_live_state(p_room_id, null, 'stream_queue');
  return v_result;
end;
$$;

create or replace function public.move_room_stream_queue_entry(
  p_room_id uuid,
  p_user_id uuid,
  p_direction text
)
returns public.room_stream_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.room_stream_queue;
  v_other public.room_stream_queue;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can prioritize the stream queue';
  end if;

  if p_direction not in ('up', 'down') then
    raise exception 'Direction must be up or down';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text || ':stream-queue', 0));

  select * into v_current
  from public.room_stream_queue
  where room_id = p_room_id and user_id = p_user_id and status = 'waiting'
  for update;

  if not found then
    raise exception 'This user is not waiting to stream';
  end if;

  if p_direction = 'up' then
    select * into v_other
    from public.room_stream_queue
    where room_id = p_room_id and status = 'waiting' and priority < v_current.priority
    order by priority desc, approved_at desc
    limit 1 for update;
  else
    select * into v_other
    from public.room_stream_queue
    where room_id = p_room_id and status = 'waiting' and priority > v_current.priority
    order by priority asc, approved_at asc
    limit 1 for update;
  end if;

  if v_other.id is null then
    return v_current;
  end if;

  update public.room_stream_queue
  set priority = case
        when id = v_current.id then v_other.priority
        else v_current.priority
      end,
      updated_at = now()
  where id in (v_current.id, v_other.id);

  select * into v_current from public.room_stream_queue where id = v_current.id;
  return v_current;
end;
$$;

create or replace function public.sync_stream_queue_when_attendee_leaves()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_room_id := old.event_room_id;
    v_user_id := old.user_id;
  else
    v_room_id := new.event_room_id;
    v_user_id := new.user_id;
  end if;

  if tg_op = 'DELETE' or new.status::text <> 'accepted' then
    update public.room_stream_queue
    set status = 'removed', ended_at = now(), updated_at = now()
    where room_id = v_room_id and user_id = v_user_id and status in ('waiting', 'live');

    delete from public.room_live_publishers
    where room_id = v_room_id and participant_identity = v_user_id::text;

    perform public.refresh_room_live_state(v_room_id, null, 'attendee_left');
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists event_attendees_sync_stream_queue_on_leave on public.event_attendees;
create trigger event_attendees_sync_stream_queue_on_leave
after delete or update of status on public.event_attendees
for each row execute function public.sync_stream_queue_when_attendee_leaves();

create or replace function public.close_stream_queue_when_event_ends()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'ended' and old.status::text is distinct from 'ended' then
    update public.room_stream_queue
    set status = 'ended', ended_at = coalesce(ended_at, now()), updated_at = now()
    where room_id = new.id and status in ('waiting', 'live');
  end if;
  return new;
end;
$$;

drop trigger if exists event_rooms_close_stream_queue_when_ended on public.event_rooms;
create trigger event_rooms_close_stream_queue_when_ended
after update of status on public.event_rooms
for each row execute function public.close_stream_queue_when_event_ends();

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
          join public.room_stream_queue queue
            on queue.room_id = attendee.event_room_id
           and queue.user_id = attendee.user_id
          where attendee.event_room_id = room.id
            and attendee.user_id = v_user_id
            and attendee.status::text = 'accepted'
            and coalesce(attendee.can_stream, false)
            and queue.status = 'live'
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
      room_id, participant_identity, track_sid, source, updated_at
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

revoke all on function public.approve_room_stream(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_room_stream(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_room_stream(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_room_stream_queue_entry(uuid, uuid) from public, anon, authenticated;
revoke all on function public.move_room_stream_queue_entry(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.report_room_live_publisher(uuid, boolean) from public, anon, authenticated;

grant execute on function public.approve_room_stream(uuid, uuid) to authenticated;
grant execute on function public.start_room_stream(uuid, uuid) to authenticated;
grant execute on function public.end_room_stream(uuid, uuid) to authenticated;
grant execute on function public.remove_room_stream_queue_entry(uuid, uuid) to authenticated;
grant execute on function public.move_room_stream_queue_entry(uuid, uuid, text) to authenticated;
grant execute on function public.report_room_live_publisher(uuid, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'room_stream_queue'
     ) then
    alter publication supabase_realtime add table public.room_stream_queue;
  end if;
end;
$$;

notify pgrst, 'reload schema';
