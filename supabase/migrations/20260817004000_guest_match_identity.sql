create extension if not exists pgcrypto;

alter table public.partyup_identities
  add column if not exists identity_type text not null default 'account';

alter table public.partyup_identities
  drop constraint if exists partyup_identities_identity_type_check;

alter table public.partyup_identities
  add constraint partyup_identities_identity_type_check
  check (identity_type in ('guest', 'account'));

update public.partyup_identities
set identity_type = case when user_id is null then 'guest' else 'account' end
where identity_type is null;

create table if not exists public.partyup_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz null default (now() + interval '30 days'),
  revoked_at timestamptz null
);

create index if not exists partyup_guest_sessions_identity_id_idx
  on public.partyup_guest_sessions(identity_id);

create index if not exists partyup_guest_sessions_expires_at_idx
  on public.partyup_guest_sessions(expires_at);

alter table public.partyup_guest_sessions enable row level security;
revoke all on public.partyup_guest_sessions from anon, authenticated;

create or replace function public.resolve_guest_identity(p_guest_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if p_guest_token is null or length(p_guest_token) < 32 then
    raise exception 'Invalid guest credential';
  end if;

  update public.partyup_guest_sessions
  set last_seen_at = now()
  where token_hash = encode(digest(p_guest_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning identity_id into v_identity_id;

  if v_identity_id is null then
    raise exception 'Invalid guest credential';
  end if;

  return v_identity_id;
end;
$$;

revoke all on function public.resolve_guest_identity(text) from public, anon, authenticated;
grant execute on function public.resolve_guest_identity(text) to service_role;

create or replace function public.enqueue_and_match_for_identity(
  p_identity_id uuid,
  p_pool_id uuid
)
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
  v_opponent_identity_id uuid;
  v_session_id uuid;
  v_room_name text;
begin
  if p_identity_id is null then
    raise exception 'PartyUp identity required';
  end if;

  if not exists (select 1 from public.partyup_identities where id = p_identity_id) then
    raise exception 'PartyUp identity not found';
  end if;

  if not exists (
    select 1
    from public.match_pools
    where id = p_pool_id
      and status = 'active'
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Match pool not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('partyup-match-pool:' || p_pool_id::text));

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
   and other_identity.id <> p_identity_id
  where q.identity_id = p_identity_id
    and q.pool_id = p_pool_id
    and s.pool_id = p_pool_id
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
  where identity_id = p_identity_id;

  select q.identity_id
  into v_opponent_identity_id
  from public.match_queue q
  where q.pool_id = p_pool_id
    and q.identity_id <> p_identity_id
    and q.status = 'waiting'
    and not exists (
      select 1
      from public.match_pair_blocks b
      where (
        (b.identity_a = p_identity_id and b.identity_b = q.identity_id)
        or
        (b.identity_a = q.identity_id and b.identity_b = p_identity_id)
      )
      and (b.expires_at is null or b.expires_at > now())
    )
  order by q.identity_id asc
  for update skip locked
  limit 1;

  if v_opponent_identity_id is null then
    insert into public.match_queue (identity_id, pool_id, status, match_session_id)
    values (p_identity_id, p_pool_id, 'waiting', null);

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
    p_identity_id,
    v_room_name,
    'created',
    now() + interval '10 minutes'
  );

  update public.match_queue
  set status = 'matched',
      match_session_id = v_session_id
  where identity_id = v_opponent_identity_id;

  insert into public.match_queue (identity_id, pool_id, status, match_session_id)
  values (p_identity_id, p_pool_id, 'matched', v_session_id);

  matched := true;
  session_id := v_session_id;
  opponent_identity_id := v_opponent_identity_id;
  return next;
end;
$$;

revoke all on function public.enqueue_and_match_for_identity(uuid, uuid) from public, anon, authenticated;

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

  return query
  select *
  from public.enqueue_and_match_for_identity(v_identity_id, p_pool_id);
end;
$$;

create or replace function public.guest_enqueue_and_match(
  p_pool_id uuid,
  p_guest_token text
)
returns table (
  matched boolean,
  session_id uuid,
  opponent_identity_id uuid,
  identity_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_match record;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  for v_match in
    select *
    from public.enqueue_and_match_for_identity(v_identity_id, p_pool_id)
  loop
    matched := v_match.matched;
    session_id := v_match.session_id;
    opponent_identity_id := v_match.opponent_identity_id;
    identity_id := v_identity_id;
    return next;
    return;
  end loop;
end;
$$;

grant execute on function public.guest_enqueue_and_match(uuid, text) to anon, authenticated;

create or replace function public.next_match_for_identity(
  p_identity_id uuid,
  p_match_session_id uuid
)
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
  v_other_identity_id uuid;
  v_pool_id uuid;
  v_session record;
  v_identity_a uuid;
  v_identity_b uuid;
begin
  select *
  into v_session
  from public.match_sessions
  where id = p_match_session_id
  for update;

  if not found then
    raise exception 'Match session not found';
  end if;

  if p_identity_id not in (v_session.participant_a_identity, v_session.participant_b_identity) then
    raise exception 'Not authorized for this Match session';
  end if;

  v_other_identity_id := case
    when v_session.participant_a_identity = p_identity_id then v_session.participant_b_identity
    else v_session.participant_a_identity
  end;

  v_pool_id := v_session.pool_id;

  if v_pool_id is null then
    select pool_id
    into v_pool_id
    from public.match_queue
    where identity_id in (p_identity_id, v_other_identity_id)
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
        ended_by_identity = p_identity_id
    where id = p_match_session_id;
  end if;

  v_identity_a := least(p_identity_id, v_other_identity_id);
  v_identity_b := greatest(p_identity_id, v_other_identity_id);

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
  where identity_id in (p_identity_id, v_other_identity_id)
    and (match_session_id = p_match_session_id or status = 'matched');

  insert into public.match_queue (identity_id, pool_id, status, match_session_id)
  values (p_identity_id, v_pool_id, 'waiting', null);

  return query
  select *
  from public.enqueue_and_match_for_identity(p_identity_id, v_pool_id);
end;
$$;

revoke all on function public.next_match_for_identity(uuid, uuid) from public, anon, authenticated;

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

  return query
  select *
  from public.next_match_for_identity(v_identity_id, p_match_session_id);
end;
$$;

create or replace function public.guest_next_match(
  p_match_session_id uuid,
  p_guest_token text
)
returns table (
  matched boolean,
  session_id uuid,
  opponent_identity_id uuid,
  identity_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_match record;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  for v_match in
    select *
    from public.next_match_for_identity(v_identity_id, p_match_session_id)
  loop
    matched := v_match.matched;
    session_id := v_match.session_id;
    opponent_identity_id := v_match.opponent_identity_id;
    identity_id := v_identity_id;
    return next;
    return;
  end loop;
end;
$$;

grant execute on function public.guest_next_match(uuid, text) to anon, authenticated;

create or replace function public.keep_match_connection_for_identity(
  p_identity_id uuid,
  p_match_session_id uuid
)
returns table (
  saved boolean,
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_identity_id uuid;
  v_identity_a uuid;
  v_identity_b uuid;
  v_session record;
  v_connection_id uuid;
  v_mutual boolean := false;
begin
  select *
  into v_session
  from public.match_sessions
  where id = p_match_session_id
  for update;

  if not found then
    raise exception 'Match session not found';
  end if;

  if p_identity_id not in (v_session.participant_a_identity, v_session.participant_b_identity) then
    raise exception 'Not authorized for this Match session';
  end if;

  v_other_identity_id := case
    when v_session.participant_a_identity = p_identity_id then v_session.participant_b_identity
    else v_session.participant_a_identity
  end;

  if v_other_identity_id is null then
    raise exception 'Match session is missing another participant';
  end if;

  v_identity_a := least(p_identity_id, v_other_identity_id);
  v_identity_b := greatest(p_identity_id, v_other_identity_id);

  insert into public.match_connection_votes (
    match_session_id,
    identity_id,
    wants_connection
  )
  values (
    p_match_session_id,
    p_identity_id,
    true
  )
  on conflict (match_session_id, identity_id)
  do update
    set wants_connection = true;

  select count(*) = 2
  into v_mutual
  from public.match_connection_votes
  where match_session_id = p_match_session_id
    and identity_id in (p_identity_id, v_other_identity_id)
    and wants_connection = true;

  if v_mutual then
    insert into public.partyup_connections (
      identity_a,
      identity_b,
      source_match_session_id,
      source_pool_id
    )
    values (
      v_identity_a,
      v_identity_b,
      p_match_session_id,
      v_session.pool_id
    )
    on conflict (identity_a, identity_b)
    do nothing
    returning id into v_connection_id;

    if v_connection_id is null then
      select id
      into v_connection_id
      from public.partyup_connections
      where identity_a = v_identity_a
        and identity_b = v_identity_b;
    end if;
  end if;

  saved := true;
  mutual := v_mutual;
  connection_id := v_connection_id;
  return next;
end;
$$;

revoke all on function public.keep_match_connection_for_identity(uuid, uuid) from public, anon, authenticated;

create or replace function public.keep_match_connection(p_match_session_id uuid)
returns table (
  saved boolean,
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
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

  return query
  select *
  from public.keep_match_connection_for_identity(v_identity_id, p_match_session_id);
end;
$$;

create or replace function public.guest_keep_match_connection(
  p_match_session_id uuid,
  p_guest_token text
)
returns table (
  saved boolean,
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  return query
  select *
  from public.keep_match_connection_for_identity(v_identity_id, p_match_session_id);
end;
$$;

grant execute on function public.guest_keep_match_connection(uuid, text) to anon, authenticated;

create or replace function public.get_match_connection_state_for_identity(
  p_identity_id uuid,
  p_match_session_id uuid
)
returns table (
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_identity_id uuid;
  v_identity_a uuid;
  v_identity_b uuid;
  v_session record;
begin
  select *
  into v_session
  from public.match_sessions
  where id = p_match_session_id;

  if not found then
    raise exception 'Match session not found';
  end if;

  if p_identity_id not in (v_session.participant_a_identity, v_session.participant_b_identity) then
    raise exception 'Not authorized for this Match session';
  end if;

  v_other_identity_id := case
    when v_session.participant_a_identity = p_identity_id then v_session.participant_b_identity
    else v_session.participant_a_identity
  end;

  v_identity_a := least(p_identity_id, v_other_identity_id);
  v_identity_b := greatest(p_identity_id, v_other_identity_id);

  select connections.id
  into connection_id
  from public.partyup_connections connections
  where connections.identity_a = v_identity_a
    and connections.identity_b = v_identity_b;

  mutual := connection_id is not null;
  return next;
end;
$$;

revoke all on function public.get_match_connection_state_for_identity(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_match_connection_state(p_match_session_id uuid)
returns table (
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
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

  return query
  select *
  from public.get_match_connection_state_for_identity(v_identity_id, p_match_session_id);
end;
$$;

create or replace function public.guest_get_match_connection_state(
  p_match_session_id uuid,
  p_guest_token text
)
returns table (
  mutual boolean,
  connection_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  return query
  select *
  from public.get_match_connection_state_for_identity(v_identity_id, p_match_session_id);
end;
$$;

grant execute on function public.guest_get_match_connection_state(uuid, text) to anon, authenticated;

create or replace function public.guest_cancel_match_search(p_guest_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  delete from public.match_queue
  where identity_id = v_identity_id
    and status = 'waiting';
end;
$$;

grant execute on function public.guest_cancel_match_search(text) to anon, authenticated;

create or replace function public.guest_get_current_match_queue_state(p_guest_token text)
returns table (
  status text,
  match_session_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  return query
  select q.status, q.match_session_id
  from public.match_queue q
  where q.identity_id = v_identity_id
  limit 1;
end;
$$;

grant execute on function public.guest_get_current_match_queue_state(text) to anon, authenticated;

create or replace function public.claim_guest_identity(p_guest_token text)
returns table (
  claimed boolean,
  identity_id uuid,
  conflict boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_existing_identity_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_identity_id := public.resolve_guest_identity(p_guest_token);

  select id
  into v_existing_identity_id
  from public.partyup_identities
  where user_id = v_user_id
    and id <> v_identity_id
  limit 1;

  if v_existing_identity_id is not null then
    claimed := false;
    identity_id := v_identity_id;
    conflict := true;
    message := 'This Google account already has a PartyUp identity. Guest history attachment is deferred.';
    return next;
    return;
  end if;

  update public.partyup_identities
  set user_id = v_user_id,
      identity_type = 'account'
  where id = v_identity_id
    and user_id is null
    and identity_type = 'guest';

  if not found then
    raise exception 'Guest identity is already claimed';
  end if;

  update public.partyup_guest_sessions
  set revoked_at = now()
  where identity_id = v_identity_id
    and token_hash = encode(digest(p_guest_token, 'sha256'), 'hex');

  claimed := true;
  identity_id := v_identity_id;
  conflict := false;
  message := 'Guest identity claimed.';
  return next;
end;
$$;

grant execute on function public.claim_guest_identity(text) to authenticated;

grant execute on function public.next_match(uuid) to authenticated;
grant execute on function public.enqueue_and_match(uuid) to authenticated;
grant execute on function public.keep_match_connection(uuid) to authenticated;
grant execute on function public.get_match_connection_state(uuid) to authenticated;
grant execute on function public.get_or_create_event_match_pool(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
