create extension if not exists pgcrypto;

-- This table intentionally survives account deletion. It contains only a one-way
-- account fingerprint, operational state, and storage paths needed to finish a retry.
create table if not exists public.account_deletion_requests (
  account_fingerprint text primary key,
  request_id uuid not null unique,
  status text not null default 'processing',
  requested_at timestamptz not null default now(),
  completed_at timestamptz null,
  last_error text null,
  pending_storage_paths jsonb not null default '{}'::jsonb,
  constraint account_deletion_requests_status_check
    check (status in ('processing', 'prepared', 'completed', 'failed')),
  constraint account_deletion_requests_storage_paths_check
    check (jsonb_typeof(pending_storage_paths) = 'object')
);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;

-- Shared records must be able to outlive the account that originally authored them.
alter table public.event_rooms alter column host_id drop not null;
alter table public.room_messages alter column user_id drop not null;
alter table public.room_announcements alter column created_by drop not null;
alter table public.room_recap_messages alter column updated_by drop not null;
alter table public.notifications alter column actor_id drop not null;
alter table public.match_sessions alter column participant_a_identity drop not null;
alter table public.match_sessions alter column participant_b_identity drop not null;

create or replace function public.prepare_account_deletion(
  p_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_fingerprint text;
  v_identity_ids uuid[];
  v_memory_paths jsonb := '[]'::jsonb;
  v_existing_paths jsonb := '{}'::jsonb;
  v_result_paths jsonb;
  v_room_id uuid;
  v_ended_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_user_id is null or p_request_id is null then
    raise exception 'User and request identifiers are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-deletion:' || p_user_id::text, 0)
  );

  v_fingerprint := encode(extensions.digest(p_user_id::text, 'sha256'), 'hex');

  select request.pending_storage_paths
  into v_existing_paths
  from public.account_deletion_requests request
  where request.account_fingerprint = v_fingerprint;

  v_existing_paths := coalesce(v_existing_paths, '{}'::jsonb);

  insert into public.account_deletion_requests (
    account_fingerprint,
    request_id,
    status,
    requested_at,
    completed_at,
    last_error,
    pending_storage_paths
  ) values (
    v_fingerprint,
    p_request_id,
    'processing',
    now(),
    null,
    null,
    v_existing_paths
  )
  on conflict (account_fingerprint) do update
  set request_id = excluded.request_id,
      status = case
        when public.account_deletion_requests.status = 'completed' then 'completed'
        else 'processing'
      end,
      requested_at = case
        when public.account_deletion_requests.status = 'completed'
          then public.account_deletion_requests.requested_at
        else now()
      end,
      last_error = null;

  if exists (
    select 1
    from public.account_deletion_requests request
    where request.account_fingerprint = v_fingerprint
      and request.status = 'completed'
  ) then
    return jsonb_build_object(
      'status', 'completed',
      'request_id', p_request_id,
      'storage_paths', v_existing_paths
    );
  end if;

  select coalesce(array_agg(identity.id), '{}'::uuid[])
  into v_identity_ids
  from public.partyup_identities identity
  where identity.user_id = p_user_id;

  if cardinality(v_identity_ids) > 0 then
    select coalesce(jsonb_agg(path.value), '[]'::jsonb)
    into v_memory_paths
    from public.room_memories memory
    cross join lateral (
      values (memory.media_path), (memory.thumbnail_path)
    ) path(value)
    where memory.uploader_identity_id = any(v_identity_ids)
      and path.value is not null;
  end if;

  v_result_paths := jsonb_build_object(
    'room-memories', coalesce(v_existing_paths->'room-memories', '[]'::jsonb) || v_memory_paths,
    'event-images-prefixes', coalesce(v_existing_paths->'event-images-prefixes', '[]'::jsonb) || jsonb_build_array(p_user_id::text)
  );

  update public.account_deletion_requests
  set pending_storage_paths = v_result_paths
  where account_fingerprint = v_fingerprint;

  -- End hosted rooms through the normal status transition so lifecycle triggers run,
  -- then remove credentials and disassociate the deleted host.
  for v_room_id in
    select room.id
    from public.event_rooms room
    where room.host_id = p_user_id
      and room.status::text <> 'ended'
    for update
  loop
    v_ended_at := now();

    update public.event_attendees
    set can_stream = false,
        stream_status = 'off',
        status = case
          when status::text in ('waiting', 'pending', 'requested', 'queued') then 'left'
          else status
        end
    where event_room_id = v_room_id;

    delete from public.match_queue queue
    using public.match_pools pool
    where queue.pool_id = pool.id
      and pool.pool_type::text = 'event'
      and pool.source_id = v_room_id;

    update public.match_sessions session
    set status = 'ended',
        ended_at = coalesce(session.ended_at, v_ended_at),
        ended_reason = coalesce(session.ended_reason, 'event_ended')
    from public.match_pools pool
    where session.pool_id = pool.id
      and pool.pool_type::text = 'event'
      and pool.source_id = v_room_id
      and session.status::text <> 'ended';

    update public.match_pools
    set status = 'ended',
        expires_at = v_ended_at
    where pool_type::text = 'event'
      and source_id = v_room_id;

    update public.room_announcements
    set is_active = false,
        updated_at = v_ended_at
    where room_id = v_room_id
      and is_active = true;

    if to_regclass('public.room_presence') is not null then
      execute 'delete from public.room_presence where room_id = $1' using v_room_id;
    end if;

    if to_regclass('public.room_typing') is not null then
      execute 'delete from public.room_typing where room_id = $1' using v_room_id;
    end if;

    delete from public.room_stream_keys where room_id = v_room_id;

    perform set_config('partyup.ending_room_id', v_room_id::text, true);

    update public.event_rooms
    set status = 'ended',
        current_users = 0,
        queue_count = 0,
        last_active_at = v_ended_at
    where id = v_room_id;
  end loop;

  delete from public.room_stream_keys key
  using public.event_rooms room
  where key.room_id = room.id
    and room.host_id = p_user_id;

  update public.event_rooms
  set host_id = null,
      cover_image = null
  where host_id = p_user_id;

  -- Retain shared conversation and moderation history without an account link.
  update public.room_messages
  set user_id = null,
      display_name = 'Deleted user'
  where user_id = p_user_id;

  update public.room_announcements
  set created_by = null
  where created_by = p_user_id;

  update public.room_recap_messages
  set updated_by = null
  where updated_by = p_user_id;

  update public.event_recaps
  set host_user_id = null,
      cover_image_url = null
  where host_user_id = p_user_id;

  update public.notifications
  set actor_id = null
  where actor_id = p_user_id;

  delete from public.notifications where user_id = p_user_id;
  delete from public.follows where follower_id = p_user_id or following_id = p_user_id;
  delete from public.event_attendees where user_id = p_user_id;
  delete from public.room_chat_mutes
  where target_user_id = p_user_id or created_by = p_user_id;

  if cardinality(v_identity_ids) > 0 then
    delete from public.match_queue where identity_id = any(v_identity_ids);
    delete from public.match_connection_votes where identity_id = any(v_identity_ids);
    delete from public.match_pair_blocks
    where identity_a = any(v_identity_ids) or identity_b = any(v_identity_ids);
    delete from public.partyup_connections
    where identity_a = any(v_identity_ids) or identity_b = any(v_identity_ids);

    update public.match_sessions
    set status = 'ended',
        ended_at = coalesce(ended_at, now()),
        ended_reason = coalesce(ended_reason, 'event_ended'),
        participant_a_identity = case
          when participant_a_identity = any(v_identity_ids) then null
          else participant_a_identity
        end,
        participant_b_identity = case
          when participant_b_identity = any(v_identity_ids) then null
          else participant_b_identity
        end
    where participant_a_identity = any(v_identity_ids)
       or participant_b_identity = any(v_identity_ids);

    delete from public.saved_memories where user_identity_id = any(v_identity_ids);
    delete from public.room_memories where uploader_identity_id = any(v_identity_ids);
    delete from public.event_recaps where identity_id = any(v_identity_ids);
    delete from public.series_follows where identity_id = any(v_identity_ids);

    -- Remaining identity-owned rows use cascades by design, including hosted
    -- Series and Mission participation. Analytics retains a null identity.
    delete from public.partyup_identities where id = any(v_identity_ids);
  end if;

  delete from public.profiles where id = p_user_id;

  update public.account_deletion_requests
  set status = 'prepared'
  where account_fingerprint = v_fingerprint;

  return jsonb_build_object(
    'status', 'prepared',
    'request_id', p_request_id,
    'storage_paths', v_result_paths
  );
end;
$$;

create or replace function public.set_account_deletion_result(
  p_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_fingerprint text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid account deletion result';
  end if;

  v_fingerprint := encode(extensions.digest(p_user_id::text, 'sha256'), 'hex');

  update public.account_deletion_requests
  set status = p_status,
      completed_at = case when p_status = 'completed' then now() else null end,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'Unknown failure'), 500) else null end,
      pending_storage_paths = case when p_status = 'completed' then '{}'::jsonb else pending_storage_paths end
  where account_fingerprint = v_fingerprint
    and request_id = p_request_id;
end;
$$;

revoke all on function public.prepare_account_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_account_deletion_result(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid, uuid) to service_role;
grant execute on function public.set_account_deletion_result(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
