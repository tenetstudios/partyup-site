create table if not exists public.match_pair_blocks (
  id uuid primary key default gen_random_uuid(),
  identity_a uuid not null references public.partyup_identities(id) on delete cascade,
  identity_b uuid not null references public.partyup_identities(id) on delete cascade,
  source_match_session_id uuid null references public.match_sessions(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  constraint match_pair_blocks_distinct_identities check (identity_a <> identity_b)
);

create index if not exists match_pair_blocks_identity_a_idx
  on public.match_pair_blocks(identity_a);

create index if not exists match_pair_blocks_identity_b_idx
  on public.match_pair_blocks(identity_b);

create index if not exists match_pair_blocks_expires_at_idx
  on public.match_pair_blocks(expires_at);

alter table public.match_sessions
  add column if not exists ended_at timestamptz,
  add column if not exists ended_reason text,
  add column if not exists ended_by_identity uuid references public.partyup_identities(id) on delete set null;

create or replace function public.enqueue_and_match(p_pool_id uuid)
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
  v_opponent_identity_id uuid;
  v_session_id uuid;
  v_room_name text;
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

  perform pg_advisory_xact_lock(hashtext('partyup-match-global'));

  delete from public.match_queue q
  using public.match_sessions s
  where q.match_session_id = s.id
    and q.status = 'matched'
    and s.expires_at <= now();

  select q.match_session_id, other_identity.id
  into v_session_id, v_opponent_identity_id
  from public.match_queue q
  join public.match_sessions s on s.id = q.match_session_id
  join public.partyup_identities other_identity
    on other_identity.id in (s.participant_a_identity, s.participant_b_identity)
   and other_identity.id <> v_identity_id
  where q.identity_id = v_identity_id
    and q.status = 'matched'
    and q.match_session_id is not null
    and s.status in ('created', 'connecting', 'active')
    and s.expires_at > now()
  limit 1;

  if v_session_id is not null then
    matched := true;
    session_id := v_session_id;
    opponent_identity_id := v_opponent_identity_id;
    return next;
    return;
  end if;

  delete from public.match_queue
  where identity_id = v_identity_id;

  select q.identity_id
  into v_opponent_identity_id
  from public.match_queue q
  where q.pool_id = p_pool_id
    and q.identity_id <> v_identity_id
    and q.status = 'waiting'
    and not exists (
      select 1
      from public.match_pair_blocks b
      where (
        (b.identity_a = v_identity_id and b.identity_b = q.identity_id)
        or
        (b.identity_a = q.identity_id and b.identity_b = v_identity_id)
      )
      and (b.expires_at is null or b.expires_at > now())
    )
  order by q.identity_id asc
  for update skip locked
  limit 1;

  if v_opponent_identity_id is null then
    insert into public.match_queue (identity_id, pool_id, status, match_session_id)
    values (v_identity_id, p_pool_id, 'waiting', null);

    matched := false;
    session_id := null;
    opponent_identity_id := null;
    return next;
    return;
  end if;

  v_session_id := gen_random_uuid();
  v_room_name := 'match-' || v_session_id::text;

  insert into public.match_sessions (
    id,
    pool_id,
    participant_a_identity,
    participant_b_identity,
    livekit_room_name,
    status,
    expires_at
  )
  values (
    v_session_id,
    p_pool_id,
    v_opponent_identity_id,
    v_identity_id,
    v_room_name,
    'created',
    now() + interval '10 minutes'
  );

  update public.match_queue
  set status = 'matched',
      match_session_id = v_session_id
  where identity_id = v_opponent_identity_id;

  insert into public.match_queue (identity_id, pool_id, status, match_session_id)
  values (v_identity_id, p_pool_id, 'matched', v_session_id);

  matched := true;
  session_id := v_session_id;
  opponent_identity_id := v_opponent_identity_id;
  return next;
end;
$$;

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

  select pool_id
  into v_pool_id
  from public.match_queue
  where identity_id in (v_identity_id, v_other_identity_id)
    and match_session_id = p_match_session_id
  limit 1;

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
    now() + interval '30 minutes'
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
grant execute on function public.enqueue_and_match(uuid) to authenticated;
