create or replace function public.reject_ended_room_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := to_jsonb(new);
  v_room_id uuid;
begin
  v_room_id := coalesce(
    nullif(v_payload->>'room_id', '')::uuid,
    nullif(v_payload->>'event_room_id', '')::uuid
  );

  if v_room_id is not null and exists (
    select 1
    from public.event_rooms room
    where room.id = v_room_id
      and room.status::text = 'ended'
  ) then
    raise exception 'This event has ended and is read-only';
  end if;

  return new;
end;
$$;

create or replace function public.guard_ended_room_attendee_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.event_rooms room
    where room.id = new.event_room_id
      and room.status::text = 'ended'
  ) then
    if new.status::text is distinct from old.status::text
       and new.status::text in ('accepted', 'waiting', 'pending', 'requested', 'queued') then
      raise exception 'This event has ended and is not accepting participants';
    end if;

    if coalesce(new.can_stream, false)
       or coalesce(new.stream_status::text, 'off') <> 'off' then
      raise exception 'Streaming is unavailable after an event ends';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists event_attendees_reject_ended_insert on public.event_attendees;
create trigger event_attendees_reject_ended_insert
before insert on public.event_attendees
for each row execute function public.reject_ended_room_insert();

drop trigger if exists event_attendees_guard_ended_update on public.event_attendees;
create trigger event_attendees_guard_ended_update
before update on public.event_attendees
for each row execute function public.guard_ended_room_attendee_update();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'room_messages',
    'room_presence',
    'room_typing',
    'room_activity',
    'room_memories'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists %I on public.%I', v_table || '_reject_ended_insert', v_table);
      execute format(
        'create trigger %I before insert on public.%I for each row execute function public.reject_ended_room_insert()',
        v_table || '_reject_ended_insert',
        v_table
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['room_messages', 'room_presence', 'room_typing']
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists %I on public.%I', v_table || '_reject_ended_update', v_table);
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.reject_ended_room_insert()',
        v_table || '_reject_ended_update',
        v_table
      );
    end if;
  end loop;
end;
$$;

drop policy if exists room_memories_storage_insert_participant on storage.objects;
create policy room_memories_storage_insert_participant
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'room-memories'
    and public.is_room_memory_participant(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = public.current_partyup_identity_id()
    and exists (
      select 1
      from public.event_rooms room
      where room.id = ((storage.foldername(name))[1])::uuid
        and room.status::text <> 'ended'
    )
  );

create or replace function public.guard_ended_room_match_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pool_type::text = 'event'
     and new.source_id is not null
     and new.status::text = 'active'
     and exists (
       select 1
       from public.event_rooms room
       where room.id = new.source_id
         and room.status::text = 'ended'
     ) then
    raise exception 'Match is unavailable after an event ends';
  end if;

  return new;
end;
$$;

drop trigger if exists match_pools_guard_ended_room on public.match_pools;
create trigger match_pools_guard_ended_room
before insert or update of status, source_id, pool_type on public.match_pools
for each row execute function public.guard_ended_room_match_pool();

create or replace function public.guard_event_room_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status::text = 'ended' and new.status::text <> 'ended' then
    raise exception 'An ended event cannot be reopened';
  end if;

  if old.status::text <> 'ended'
     and new.status::text = 'ended'
     and current_setting('partyup.ending_room_id', true) is distinct from new.id::text then
    raise exception 'Use end_event_room to end an event safely';
  end if;

  return new;
end;
$$;

drop trigger if exists event_rooms_guard_status_transition on public.event_rooms;
create trigger event_rooms_guard_status_transition
before update of status on public.event_rooms
for each row execute function public.guard_event_room_status_transition();

create or replace function public.end_event_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.event_rooms;
  v_ended_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_room
  from public.event_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Event room not found';
  end if;

  if v_room.host_id <> auth.uid() then
    raise exception 'Only the host can end this event';
  end if;

  if v_room.status::text = 'ended' then
    return jsonb_build_object(
      'room_id', v_room.id,
      'status', 'ended',
      'already_ended', true
    );
  end if;

  update public.event_attendees
  set can_stream = false,
      stream_status = 'off',
      status = case
        when status::text in ('waiting', 'pending', 'requested', 'queued') then 'left'
        else status
      end
  where event_room_id = p_room_id;

  delete from public.match_queue queue
  using public.match_pools pool
  where queue.pool_id = pool.id
    and pool.pool_type::text = 'event'
    and pool.source_id = p_room_id;

  update public.match_sessions session
  set status = 'ended',
      ended_at = coalesce(session.ended_at, v_ended_at),
      ended_reason = coalesce(session.ended_reason, 'event_ended')
  from public.match_pools pool
  where session.pool_id = pool.id
    and pool.pool_type::text = 'event'
    and pool.source_id = p_room_id
    and session.status::text <> 'ended';

  update public.match_pools
  set status = 'ended',
      expires_at = v_ended_at
  where pool_type::text = 'event'
    and source_id = p_room_id;

  update public.room_announcements
  set is_active = false,
      updated_at = v_ended_at
  where room_id = p_room_id
    and is_active = true;

  if to_regclass('public.room_presence') is not null then
    execute 'delete from public.room_presence where room_id = $1' using p_room_id;
  end if;

  if to_regclass('public.room_typing') is not null then
    execute 'delete from public.room_typing where room_id = $1' using p_room_id;
  end if;

  if to_regclass('public.room_stream_keys') is not null then
    execute 'delete from public.room_stream_keys where room_id = $1' using p_room_id;
  end if;

  perform set_config('partyup.ending_room_id', p_room_id::text, true);

  update public.event_rooms
  set status = 'ended',
      current_users = 0,
      queue_count = 0,
      last_active_at = v_ended_at
  where id = p_room_id;

  return jsonb_build_object(
    'room_id', p_room_id,
    'status', 'ended',
    'already_ended', false,
    'ended_at', v_ended_at
  );
end;
$$;

revoke all on function public.end_event_room(uuid) from public, anon, authenticated;
grant execute on function public.end_event_room(uuid) to authenticated;

notify pgrst, 'reload schema';
