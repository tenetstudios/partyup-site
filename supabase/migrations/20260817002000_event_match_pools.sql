create unique index if not exists match_pools_active_event_source_idx
  on public.match_pools(source_id)
  where pool_type = 'event'
    and status = 'active'
    and source_id is not null;

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
  v_user_id uuid := auth.uid();
  v_room record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

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

grant execute on function public.get_or_create_event_match_pool(uuid) to authenticated;

create or replace function public.next_match(p_match_session_id uuid)
returns table (
  matched boolean,
  session_id uuid,
  opponent_identity_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_other_identity_id uuid;
  v_pool_id uuid;
  v_session record;
  v_identity_a uuid;
  v_identity_b uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_identity_id
  from public.partyup_identities
  where user_id = v_user_id;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  select *
  into v_session
  from public.match_sessions
  where id = p_match_session_id
  for update;

  if not found then
    raise exception 'Match session not found';
  end if;

  if v_identity_id not in (v_session.participant_a_identity, v_session.participant_b_identity) then
    raise exception 'Not authorized for this Match session';
  end if;

  v_other_identity_id := case
    when v_session.participant_a_identity = v_identity_id then v_session.participant_b_identity
    else v_session.participant_a_identity
  end;

  v_pool_id := v_session.pool_id;

  if v_pool_id is null then
    select pool_id
    into v_pool_id
    from public.match_queue
    where identity_id in (v_identity_id, v_other_identity_id)
      and match_session_id = p_match_session_id
    limit 1;
  end if;

  if v_pool_id is null then
    select id into v_pool_id
    from public.match_pools
    where slug = 'global'
    limit 1;
  end if;

  if v_pool_id is null then
    raise exception 'Match pool not found';
  end if;

  if v_session.status <> 'ended' then
    update public.match_sessions
    set status = 'ended',
        ended_at = now(),
        ended_reason = 'next',
        ended_by_identity = v_identity_id
    where id = p_match_session_id;
  end if;

  v_identity_a := least(v_identity_id, v_other_identity_id);
  v_identity_b := greatest(v_identity_id, v_other_identity_id);

  insert into public.match_pair_blocks (
    identity_a,
    identity_b,
    source_match_session_id,
    reason,
    expires_at
  )
  select
    v_identity_a,
    v_identity_b,
    p_match_session_id,
    'next',
    -- Temporary for Match connection testing. Restore to interval '30 minutes' before shipping.
    now() + interval '5 seconds'
  where not exists (
    select 1
    from public.match_pair_blocks
    where identity_a = v_identity_a
      and identity_b = v_identity_b
      and source_match_session_id = p_match_session_id
      and reason = 'next'
  );

  delete from public.match_queue
  where identity_id in (v_identity_id, v_other_identity_id)
    and (match_session_id = p_match_session_id or status = 'matched');

  insert into public.match_queue (identity_id, pool_id, status, match_session_id)
  values (v_identity_id, v_pool_id, 'waiting', null);

  return query
  select *
  from public.enqueue_and_match(v_pool_id);
end;
$$;

grant execute on function public.next_match(uuid) to authenticated;

notify pgrst, 'reload schema';
