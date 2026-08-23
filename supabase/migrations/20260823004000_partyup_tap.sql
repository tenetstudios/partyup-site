create extension if not exists pgcrypto;

alter table public.partyup_connections
  add column if not exists origin_room_id uuid references public.event_rooms(id) on delete set null,
  add column if not exists connection_method text not null default 'roulette';

alter table public.partyup_connections
  drop constraint if exists partyup_connections_method_check;
alter table public.partyup_connections
  add constraint partyup_connections_method_check
  check (connection_method in ('roulette', 'partyup_tap'));

update public.partyup_connections connection
set origin_room_id = pool.source_id
from public.match_pools pool
where connection.origin_room_id is null
  and connection.source_pool_id = pool.id
  and pool.pool_type = 'event';

create index if not exists partyup_connections_origin_room_idx
  on public.partyup_connections(origin_room_id)
  where origin_room_id is not null;

create or replace function public.normalize_partyup_connection_origin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pool_type text;
  v_room_id uuid;
  v_label text;
  v_should_normalize boolean := false;
begin
  if tg_op = 'INSERT' then
    v_should_normalize := new.source_match_session_id is not null;
  elsif tg_op = 'UPDATE' then
    v_should_normalize := new.source_match_session_id is not null
      and old.removed_at is not null and new.removed_at is null;
  end if;

  if v_should_normalize then
    new.connection_method := 'roulette';
    select pool.pool_type, case when pool.pool_type = 'event' then pool.source_id else null end,
      case when pool.pool_type = 'event'
        then coalesce(nullif(room.title, ''), nullif(pool.name, ''), 'PartyUp event')
        else 'PartyUp' end
    into v_pool_type, v_room_id, v_label
    from public.match_pools pool
    left join public.event_rooms room on pool.pool_type = 'event' and room.id = pool.source_id
    where pool.id = new.source_pool_id;
    new.origin_room_id := v_room_id;
    new.origin_type := coalesce(v_pool_type, 'global');
    new.origin_label := coalesce(v_label, 'PartyUp');
  end if;
  return new;
end;
$$;

drop trigger if exists partyup_connections_normalize_origin on public.partyup_connections;
create trigger partyup_connections_normalize_origin
before insert or update on public.partyup_connections
for each row execute function public.normalize_partyup_connection_origin();

create table if not exists public.partyup_connection_tokens (
  id uuid primary key default gen_random_uuid(),
  creator_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  token_hash text not null unique,
  short_code_hash text not null unique,
  origin_room_id uuid null references public.event_rooms(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  used_at timestamptz null,
  used_by_identity_id uuid null references public.partyup_identities(id) on delete set null,
  connection_id uuid null references public.partyup_connections(id) on delete set null,
  constraint partyup_connection_tokens_hash_length check (
    char_length(token_hash) = 64 and char_length(short_code_hash) = 64
  ),
  constraint partyup_connection_tokens_use_complete check (
    (used_at is null and used_by_identity_id is null and connection_id is null)
    or (used_at is not null and used_by_identity_id is not null and connection_id is not null)
  )
);

create index if not exists partyup_connection_tokens_creator_idx
  on public.partyup_connection_tokens(creator_identity_id, expires_at desc);
create index if not exists partyup_connection_tokens_expiry_idx
  on public.partyup_connection_tokens(expires_at)
  where used_at is null and revoked_at is null;

create table if not exists public.partyup_connection_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null default 'partyup_connection_created',
  connection_id uuid not null references public.partyup_connections(id) on delete cascade,
  identity_a uuid not null references public.partyup_identities(id) on delete cascade,
  identity_b uuid not null references public.partyup_identities(id) on delete cascade,
  user_a_id uuid null references auth.users(id) on delete set null,
  user_b_id uuid null references auth.users(id) on delete set null,
  room_id uuid null references public.event_rooms(id) on delete set null,
  connection_method text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint partyup_connection_events_name_check check (event_name = 'partyup_connection_created'),
  constraint partyup_connection_events_pair_check check (identity_a < identity_b),
  constraint partyup_connection_events_method_check check (connection_method in ('roulette', 'partyup_tap')),
  constraint partyup_connection_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists partyup_connection_events_connection_idx
  on public.partyup_connection_events(connection_id, occurred_at desc);
create index if not exists partyup_connection_events_room_idx
  on public.partyup_connection_events(room_id, occurred_at desc)
  where room_id is not null;

alter table public.partyup_connection_tokens enable row level security;
alter table public.partyup_connection_events enable row level security;
revoke all on public.partyup_connection_tokens from anon, authenticated;
revoke all on public.partyup_connection_events from anon, authenticated;
grant select on public.partyup_connection_events to authenticated;

drop policy if exists partyup_connection_events_select_own on public.partyup_connection_events;
create policy partyup_connection_events_select_own
on public.partyup_connection_events
for select
to authenticated
using (auth.uid() in (user_a_id, user_b_id));

create or replace function public.is_partyup_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_room_id is not null and p_user_id is not null and exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and room.status::text <> 'ended'
      and (
        room.host_id = p_user_id
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = p_user_id
            and attendee.status::text = 'accepted'
        )
      )
  );
$$;

create or replace function public.create_partyup_tap_token(p_origin_room_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_token text;
  v_code text;
  v_room_id uuid;
  v_room_label text;
  v_expires_at timestamptz := now() + interval '60 seconds';
  v_attempt integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select identity.id into v_identity_id
  from public.partyup_identities identity
  where identity.user_id = v_user_id
  limit 1;
  if v_identity_id is null then raise exception 'PartyUp identity not found'; end if;

  if public.is_partyup_room_member(p_origin_room_id, v_user_id) then
    v_room_id := p_origin_room_id;
    select coalesce(nullif(room.title, ''), 'PartyUp event')
    into v_room_label
    from public.event_rooms room
    where room.id = v_room_id;
  end if;

  update public.partyup_connection_tokens
  set revoked_at = now()
  where creator_identity_id = v_identity_id
    and used_at is null and revoked_at is null;

  loop
    v_attempt := v_attempt + 1;
    v_token := encode(gen_random_bytes(24), 'hex');
    v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.partyup_connection_tokens (
        creator_identity_id, token_hash, short_code_hash, origin_room_id, expires_at
      ) values (
        v_identity_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        encode(extensions.digest(v_code, 'sha256'), 'hex'),
        v_room_id,
        v_expires_at
      );
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise exception 'Could not create a temporary connection code'; end if;
    end;
  end loop;

  return jsonb_build_object(
    'token', v_token,
    'short_code', v_code,
    'expires_at', v_expires_at,
    'origin_room_id', v_room_id,
    'origin_label', v_room_label
  );
end;
$$;

create or replace function public.cancel_partyup_tap_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into v_identity_id from public.partyup_identities where user_id = auth.uid() limit 1;
  update public.partyup_connection_tokens
  set revoked_at = coalesce(revoked_at, now())
  where creator_identity_id = v_identity_id
    and token_hash = encode(extensions.digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex')
    and used_at is null;
end;
$$;

create or replace function public.get_partyup_tap_token_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_viewer_identity_id uuid;
  v_profile_name text;
  v_profile_avatar text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into v_viewer_identity_id from public.partyup_identities where user_id = auth.uid() limit 1;

  select * into v_token
  from public.partyup_connection_tokens token
  where token.token_hash = encode(extensions.digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex')
    and token.creator_identity_id = v_viewer_identity_id;

  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if v_token.used_at is not null then
    select profile.username, profile.avatar_url
    into v_profile_name, v_profile_avatar
    from public.partyup_identities identity
    left join public.profiles profile on profile.id = identity.user_id
    where identity.id = v_token.used_by_identity_id;
    return jsonb_build_object(
      'status', 'connected', 'connection_id', v_token.connection_id,
      'person', jsonb_build_object(
        'display_name', coalesce(nullif(v_profile_name, ''), 'PartyUp user'),
        'avatar_url', v_profile_avatar
      )
    );
  end if;
  if v_token.revoked_at is not null then return jsonb_build_object('status', 'cancelled'); end if;
  if v_token.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  return jsonb_build_object('status', 'ready', 'expires_at', v_token.expires_at);
end;
$$;

create or replace function public.redeem_partyup_tap_token(p_token_or_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_scanner_identity_id uuid;
  v_value text := btrim(coalesce(p_token_or_code, ''));
  v_token public.partyup_connection_tokens;
  v_identity_a uuid;
  v_identity_b uuid;
  v_connection public.partyup_connections;
  v_creator_user_id uuid;
  v_room_id uuid;
  v_room_label text;
  v_already_connected boolean := false;
  v_profile_name text;
  v_profile_avatar text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_value = '' then return jsonb_build_object('status', 'invalid'); end if;

  select id into v_scanner_identity_id
  from public.partyup_identities where user_id = v_user_id limit 1;
  if v_scanner_identity_id is null then raise exception 'PartyUp identity not found'; end if;

  select token.* into v_token
  from public.partyup_connection_tokens token
  where token.token_hash = encode(extensions.digest(v_value, 'sha256'), 'hex')
     or token.short_code_hash = encode(extensions.digest(upper(v_value), 'sha256'), 'hex')
  order by token.created_at desc
  limit 1
  for update;

  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if v_token.used_at is not null then
    if v_token.used_by_identity_id = v_scanner_identity_id then
      v_already_connected := true;
    else
      return jsonb_build_object('status', 'expired');
    end if;
  elsif v_token.revoked_at is not null or v_token.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  if v_token.creator_identity_id = v_scanner_identity_id then
    return jsonb_build_object('status', 'self_scan');
  end if;

  select identity.user_id, profile.username, profile.avatar_url
  into v_creator_user_id, v_profile_name, v_profile_avatar
  from public.partyup_identities identity
  left join public.profiles profile on profile.id = identity.user_id
  where identity.id = v_token.creator_identity_id;

  v_identity_a := least(v_token.creator_identity_id, v_scanner_identity_id);
  v_identity_b := greatest(v_token.creator_identity_id, v_scanner_identity_id);

  if not v_already_connected then
    perform pg_advisory_xact_lock(hashtext('partyup-connection:' || v_identity_a::text || ':' || v_identity_b::text));

    select * into v_connection
    from public.partyup_connections connection
    where connection.identity_a = v_identity_a and connection.identity_b = v_identity_b
    for update;

    if found and v_connection.removed_at is null then
      v_already_connected := true;
    else
      if v_token.origin_room_id is not null
         and public.is_partyup_room_member(v_token.origin_room_id, v_creator_user_id)
         and public.is_partyup_room_member(v_token.origin_room_id, v_user_id) then
        v_room_id := v_token.origin_room_id;
        select coalesce(nullif(room.title, ''), 'PartyUp event') into v_room_label
        from public.event_rooms room where room.id = v_room_id;
      end if;

      insert into public.partyup_connections (
        identity_a, identity_b, source_match_session_id, source_pool_id,
        connected_at, origin_type, origin_label, origin_room_id,
        connection_method, removed_at, removed_by_identity
      ) values (
        v_identity_a, v_identity_b, null, null,
        now(), case when v_room_id is null then 'global' else 'event' end,
        coalesce(v_room_label, 'PartyUp'), v_room_id,
        'partyup_tap', null, null
      )
      on conflict (identity_a, identity_b) do update
      set source_match_session_id = null,
          source_pool_id = null,
          connected_at = excluded.connected_at,
          origin_type = excluded.origin_type,
          origin_label = excluded.origin_label,
          origin_room_id = excluded.origin_room_id,
          connection_method = excluded.connection_method,
          removed_at = null,
          removed_by_identity = null
      returning * into v_connection;

      insert into public.partyup_connection_events (
        connection_id, identity_a, identity_b, user_a_id, user_b_id,
        room_id, connection_method, occurred_at, metadata
      )
      select v_connection.id, v_identity_a, v_identity_b,
        identity_a_user.user_id, identity_b_user.user_id,
        v_room_id, 'partyup_tap', v_connection.connected_at,
        jsonb_build_object('source', 'partyup_tap')
      from public.partyup_identities identity_a_user
      join public.partyup_identities identity_b_user on identity_b_user.id = v_identity_b
      where identity_a_user.id = v_identity_a;

      insert into public.mission_completions (mission_id, participant_identity_id, completed_at)
      select mission.id, participant.identity_id, v_connection.connected_at
      from public.room_missions mission
      cross join (values (v_identity_a), (v_identity_b)) participant(identity_id)
      where v_room_id is not null
        and mission.room_id = v_room_id
        and mission.status = 'active'
        and mission.starts_at <= now()
        and (mission.ends_at is null or mission.ends_at > now())
        and (
          mission.mission_type = 'connection'
          or mission.config->>'completion_event' = 'partyup_connection_created'
        )
      on conflict (mission_id, participant_identity_id) do nothing;
    end if;

    update public.partyup_connection_tokens
    set used_at = now(), used_by_identity_id = v_scanner_identity_id,
        connection_id = v_connection.id
    where id = v_token.id;
  else
    select * into v_connection from public.partyup_connections where id = v_token.connection_id;
  end if;

  return jsonb_build_object(
    'status', case when v_already_connected then 'already_connected' else 'connected' end,
    'connection_id', v_connection.id,
    'connected_at', coalesce(v_connection.connected_at, v_connection.created_at),
    'origin_room_id', v_connection.origin_room_id,
    'origin_label', case when v_connection.origin_type = 'event' then v_connection.origin_label else null end,
    'person', jsonb_build_object(
      'profile_user_id', v_creator_user_id,
      'display_name', coalesce(nullif(v_profile_name, ''), 'PartyUp user'),
      'avatar_url', v_profile_avatar
    )
  );
end;
$$;

alter table public.room_missions drop constraint if exists room_missions_mission_type_check;
alter table public.room_missions add constraint room_missions_mission_type_check
  check (mission_type in ('generic', 'animal_pack', 'connection'));

create or replace function public.get_my_connections()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_connections jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into v_identity_id from public.partyup_identities where user_id = auth.uid() limit 1;
  if v_identity_id is null then raise exception 'PartyUp identity not found'; end if;

  select coalesce(jsonb_agg(connection_row order by (connection_row->>'connected_at')::timestamptz desc), '[]'::jsonb)
  into v_connections
  from (
    select jsonb_build_object(
      'id', connection.id,
      'connected_at', coalesce(connection.connected_at, connection.created_at),
      'source_match_session_id', connection.source_match_session_id,
      'source_pool_id', connection.source_pool_id,
      'connection_method', connection.connection_method,
      'origin_room_id', connection.origin_room_id,
      'context', jsonb_build_object(
        'type', coalesce(connection.origin_type, pool.pool_type, 'global'),
        'label', case
          when coalesce(connection.origin_type, pool.pool_type) = 'event'
            then coalesce(nullif(connection.origin_label, ''), nullif(origin_room.title, ''), nullif(pool_room.title, ''), nullif(pool.name, ''), 'PartyUp event')
          else coalesce(nullif(connection.origin_label, ''), 'PartyUp')
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
    ) connection_row
    from public.partyup_connections connection
    join public.partyup_identities other_identity on other_identity.id = case
      when connection.identity_a = v_identity_id then connection.identity_b else connection.identity_a end
    left join public.profiles profile on profile.id = other_identity.user_id
    left join public.match_pools pool on pool.id = connection.source_pool_id
    left join public.event_rooms pool_room on pool.pool_type = 'event' and pool_room.id = pool.source_id
    left join public.event_rooms origin_room on origin_room.id = connection.origin_room_id
    where connection.removed_at is null
      and v_identity_id in (connection.identity_a, connection.identity_b)
  ) rows;
  return v_connections;
end;
$$;

revoke all on function public.is_partyup_room_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.normalize_partyup_connection_origin() from public, anon, authenticated;
revoke all on function public.create_partyup_tap_token(uuid) from public, anon, authenticated;
revoke all on function public.cancel_partyup_tap_token(text) from public, anon, authenticated;
revoke all on function public.get_partyup_tap_token_status(text) from public, anon, authenticated;
revoke all on function public.redeem_partyup_tap_token(text) from public, anon, authenticated;
grant execute on function public.create_partyup_tap_token(uuid) to authenticated;
grant execute on function public.cancel_partyup_tap_token(text) to authenticated;
grant execute on function public.get_partyup_tap_token_status(text) to authenticated;
grant execute on function public.redeem_partyup_tap_token(text) to authenticated;
grant execute on function public.get_my_connections() to authenticated;

notify pgrst, 'reload schema';
