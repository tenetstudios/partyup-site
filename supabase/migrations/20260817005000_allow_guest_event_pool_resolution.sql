create or replace function public.get_or_create_event_match_pool(p_event_room_id uuid)
returns table (
  pool_id uuid,
  name text,
  source_event_room_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room record;
begin
  select *
  into v_room
  from public.event_rooms
  where id = p_event_room_id;

  if not found then
    raise exception 'Event room not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('partyup-event-match-pool:' || p_event_room_id::text));

  select id, match_pools.name, source_id
  into pool_id, name, source_event_room_id
  from public.match_pools
  where pool_type = 'event'
    and source_id = p_event_room_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if pool_id is not null then
    return next;
    return;
  end if;

  select id, match_pools.name, source_id
  into pool_id, name, source_event_room_id
  from public.match_pools
  where pool_type = 'event'
    and source_id = p_event_room_id
  order by id asc
  limit 1;

  if pool_id is not null then
    update public.match_pools
    set status = 'active',
        expires_at = null
    where id = pool_id
    returning id, match_pools.name, source_id
    into pool_id, name, source_event_room_id;

    return next;
    return;
  end if;

  insert into public.match_pools (
    slug,
    pool_type,
    name,
    source_id,
    status,
    expires_at
  )
  values (
    'event-' || p_event_room_id::text,
    'event',
    coalesce(nullif(v_room.title, ''), 'Event') || ' Match',
    p_event_room_id,
    'active',
    null
  );

  select id, match_pools.name, source_id
  into pool_id, name, source_event_room_id
  from public.match_pools
  where pool_type = 'event'
    and source_id = p_event_room_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if pool_id is null then
    raise exception 'Event Match pool could not be created';
  end if;

  return next;
end;
$$;

grant execute on function public.get_or_create_event_match_pool(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
