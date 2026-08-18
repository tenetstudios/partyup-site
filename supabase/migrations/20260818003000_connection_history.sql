alter table public.partyup_connections
  add column if not exists connected_at timestamptz,
  add column if not exists origin_type text,
  add column if not exists origin_label text,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by_identity uuid references public.partyup_identities(id) on delete set null;

update public.partyup_connections
set connected_at = created_at
where connected_at is null;

alter table public.partyup_connections
  alter column connected_at set default now();

create index if not exists partyup_connections_connected_at_idx
  on public.partyup_connections(connected_at);

create index if not exists partyup_connections_removed_at_idx
  on public.partyup_connections(removed_at)
  where removed_at is not null;

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
  v_origin_type text := 'global';
  v_origin_label text := 'PartyUp';
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
    select
      coalesce(pool.pool_type, 'global'),
      case
        when pool.pool_type = 'event' then coalesce(nullif(room.title, ''), nullif(pool.name, ''), 'PartyUp event')
        else 'PartyUp'
      end
    into v_origin_type, v_origin_label
    from public.match_pools pool
    left join public.event_rooms room
      on pool.pool_type = 'event'
     and room.id = pool.source_id
    where pool.id = v_session.pool_id;

    v_origin_type := coalesce(v_origin_type, 'global');
    v_origin_label := coalesce(nullif(v_origin_label, ''), 'PartyUp');

    insert into public.partyup_connections (
      identity_a,
      identity_b,
      source_match_session_id,
      source_pool_id,
      connected_at,
      origin_type,
      origin_label,
      removed_at,
      removed_by_identity
    )
    values (
      v_identity_a,
      v_identity_b,
      p_match_session_id,
      v_session.pool_id,
      now(),
      v_origin_type,
      v_origin_label,
      null,
      null
    )
    on conflict (identity_a, identity_b)
    do update
      set source_match_session_id = excluded.source_match_session_id,
          source_pool_id = excluded.source_pool_id,
          connected_at = case
            when public.partyup_connections.removed_at is not null then excluded.connected_at
            else coalesce(public.partyup_connections.connected_at, excluded.connected_at)
          end,
          origin_type = case
            when public.partyup_connections.removed_at is not null then excluded.origin_type
            else coalesce(public.partyup_connections.origin_type, excluded.origin_type)
          end,
          origin_label = case
            when public.partyup_connections.removed_at is not null then excluded.origin_label
            else coalesce(public.partyup_connections.origin_label, excluded.origin_label)
          end,
          removed_at = null,
          removed_by_identity = null
    returning id into v_connection_id;
  end if;

  saved := true;
  mutual := v_mutual;
  connection_id := v_connection_id;
  return next;
end;
$$;

revoke all on function public.keep_match_connection_for_identity(uuid, uuid) from public, anon, authenticated;

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
    and connections.identity_b = v_identity_b
    and connections.removed_at is null;

  mutual := connection_id is not null;
  return next;
end;
$$;

revoke all on function public.get_match_connection_state_for_identity(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_my_connections()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_connections jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_identity_id
  from public.partyup_identities
  where user_id = v_user_id
  limit 1;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  select coalesce(jsonb_agg(connection_row order by (connection_row->>'connected_at')::timestamptz desc), '[]'::jsonb)
  into v_connections
  from (
    select jsonb_build_object(
      'id', connections.id,
      'connected_at', coalesce(connections.connected_at, connections.created_at),
      'source_match_session_id', connections.source_match_session_id,
      'source_pool_id', connections.source_pool_id,
      'context', jsonb_build_object(
        'type', coalesce(connections.origin_type, pool.pool_type, 'global'),
        'label', case
          when coalesce(connections.origin_type, pool.pool_type) = 'event' then coalesce(nullif(connections.origin_label, ''), nullif(room.title, ''), nullif(pool.name, ''), 'PartyUp event')
          else coalesce(nullif(connections.origin_label, ''), 'PartyUp')
        end
      ),
      'person', jsonb_build_object(
        'identity_id', other_identity.id,
        'profile_user_id', other_identity.user_id,
        'identity_type', other_identity.identity_type,
        'username', profile.username,
        'display_name', profile.username,
        'avatar_url', profile.avatar_url
      )
    ) as connection_row
    from public.partyup_connections connections
    join public.partyup_identities other_identity
      on other_identity.id = case
        when connections.identity_a = v_identity_id then connections.identity_b
        else connections.identity_a
      end
    left join public.profiles profile
      on profile.id = other_identity.user_id
    left join public.match_pools pool
      on pool.id = connections.source_pool_id
    left join public.event_rooms room
      on pool.pool_type = 'event'
     and room.id = pool.source_id
    where connections.removed_at is null
      and v_identity_id in (connections.identity_a, connections.identity_b)
  ) rows;

  return v_connections;
end;
$$;

revoke all on function public.get_my_connections() from public, anon, authenticated;
grant execute on function public.get_my_connections() to authenticated;

create or replace function public.remove_partyup_connection(p_connection_id uuid)
returns void
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
  where user_id = v_user_id
  limit 1;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  update public.partyup_connections
  set removed_at = coalesce(removed_at, now()),
      removed_by_identity = coalesce(removed_by_identity, v_identity_id)
  where id = p_connection_id
    and removed_at is null
    and v_identity_id in (identity_a, identity_b);

  if not found then
    raise exception 'Connection not found';
  end if;
end;
$$;

revoke all on function public.remove_partyup_connection(uuid) from public, anon, authenticated;
grant execute on function public.remove_partyup_connection(uuid) to authenticated;

create or replace function public.get_profile_social_state(p_profile_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_identity_id uuid;
  v_profile_identity_id uuid;
  v_connection_id uuid;
  v_following_count integer := 0;
  v_follower_count integer := 0;
  v_is_following boolean := false;
begin
  select count(*)::integer
  into v_following_count
  from public.follows
  where follower_id = p_profile_user_id;

  select count(*)::integer
  into v_follower_count
  from public.follows
  where following_id = p_profile_user_id;

  if v_user_id is not null then
    select id
    into v_current_identity_id
    from public.partyup_identities
    where user_id = v_user_id
    limit 1;

    select id
    into v_profile_identity_id
    from public.partyup_identities
    where user_id = p_profile_user_id
    limit 1;

    select exists (
      select 1
      from public.follows
      where follower_id = v_user_id
        and following_id = p_profile_user_id
    )
    into v_is_following;

    if v_current_identity_id is not null and v_profile_identity_id is not null then
      select id
      into v_connection_id
      from public.partyup_connections
      where identity_a = least(v_current_identity_id, v_profile_identity_id)
        and identity_b = greatest(v_current_identity_id, v_profile_identity_id)
        and removed_at is null;
    end if;
  end if;

  return jsonb_build_object(
    'followers', v_follower_count,
    'following', v_following_count,
    'is_following', v_is_following,
    'connected', v_connection_id is not null,
    'connection_id', v_connection_id
  );
end;
$$;

revoke all on function public.get_profile_social_state(uuid) from public, anon, authenticated;
grant execute on function public.get_profile_social_state(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
