create table if not exists public.room_analytics_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  event_type text not null,
  identity_id uuid null references public.partyup_identities(id) on delete set null,
  session_id uuid null references public.match_sessions(id) on delete set null,
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_analytics_events_type_check
    check (
      event_type in (
        'qr_scan',
        'room_entry',
        'match_started',
        'match_connected',
        'match_next',
        'keep_in_touch',
        'mutual_connection',
        'context_return',
        'context_leave'
      )
    )
);

create unique index if not exists room_analytics_events_idempotency_key_idx
  on public.room_analytics_events(idempotency_key)
  where idempotency_key is not null;

create index if not exists room_analytics_events_room_type_created_idx
  on public.room_analytics_events(room_id, event_type, created_at);

create index if not exists room_analytics_events_session_id_idx
  on public.room_analytics_events(session_id)
  where session_id is not null;

alter table public.room_analytics_events enable row level security;
revoke all on public.room_analytics_events from anon, authenticated;

create or replace function public.record_room_analytics_event(
  p_room_id uuid,
  p_event_type text,
  p_session_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
begin
  if p_event_type not in (
    'qr_scan',
    'room_entry',
    'match_started',
    'match_connected',
    'match_next',
    'keep_in_touch',
    'mutual_connection',
    'context_return',
    'context_leave'
  ) then
    raise exception 'Unsupported room analytics event type';
  end if;

  if not exists (select 1 from public.event_rooms where id = p_room_id) then
    raise exception 'Room not found';
  end if;

  if v_user_id is not null then
    select id
    into v_identity_id
    from public.partyup_identities
    where user_id = v_user_id
    limit 1;
  end if;

  insert into public.room_analytics_events (
    room_id,
    event_type,
    identity_id,
    session_id,
    idempotency_key,
    metadata
  )
  values (
    p_room_id,
    p_event_type,
    v_identity_id,
    p_session_id,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
end;
$$;

revoke all on function public.record_room_analytics_event(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_room_analytics_event(uuid, text, uuid, text, jsonb) to anon, authenticated;

create or replace function public.get_room_host_dashboard(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.event_rooms;
  v_pool_id uuid;
  v_window_start timestamptz;
  v_here_now integer := 0;
  v_matching integer := 0;
  v_active_matches integer := 0;
  v_connections integer := 0;
  v_waiting_to_stream integer := 0;
  v_streamers integer := 0;
  v_bouncers integer := 0;
  v_obs_ready boolean := false;
  v_active_announcement jsonb := null;
  v_funnel jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_room
  from public.event_rooms
  where id = p_room_id;

  if not found then
    raise exception 'Room not found';
  end if;

  if v_room.host_id <> v_user_id then
    raise exception 'Only the room host can view this dashboard';
  end if;

  v_window_start := coalesce(v_room.scheduled_at, v_room.created_at, now() - interval '12 hours');

  select count(*)::integer
  into v_here_now
  from public.room_presence
  where room_id = p_room_id
    and last_seen > now() - interval '60 seconds';

  select count(*)::integer
  into v_waiting_to_stream
  from public.event_attendees
  where event_room_id = p_room_id
    and status::text in ('pending', 'waiting', 'requested', 'queued');

  select count(*)::integer
  into v_streamers
  from public.event_attendees
  where event_room_id = p_room_id
    and stream_status is not null
    and stream_status::text <> 'off';

  select count(*)::integer
  into v_bouncers
  from public.event_attendees
  where event_room_id = p_room_id
    and room_role::text = 'bouncer';

  select exists (
    select 1
    from public.room_stream_keys
    where room_id = p_room_id
  )
  into v_obs_ready;

  select id
  into v_pool_id
  from public.match_pools
  where pool_type = 'event'
    and source_id = p_room_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_pool_id is not null then
    select count(*)::integer
    into v_matching
    from public.match_queue
    where pool_id = v_pool_id
      and status = 'waiting';

    select count(*)::integer
    into v_active_matches
    from public.match_sessions
    where pool_id = v_pool_id
      and status in ('created', 'connecting', 'active')
      and (expires_at is null or expires_at > now());

    select count(*)::integer
    into v_connections
    from public.partyup_connections
    where source_pool_id = v_pool_id
      and created_at >= v_window_start;
  end if;

  select to_jsonb(announcements)
  into v_active_announcement
  from public.get_active_room_announcement(p_room_id) announcements
  limit 1;

  select coalesce(
    jsonb_object_agg(event_type, event_count),
    '{}'::jsonb
  )
  into v_funnel
  from (
    select event_type, count(*)::integer as event_count
    from public.room_analytics_events
    where room_id = p_room_id
      and created_at >= v_window_start
    group by event_type
  ) events;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'title', coalesce(v_room.title, 'Live Room'),
      'status', v_room.status,
      'current_users', v_room.current_users,
      'created_at', v_room.created_at,
      'scheduled_at', v_room.scheduled_at
    ),
    'window_start', v_window_start,
    'event_pool_id', v_pool_id,
    'live', jsonb_build_object(
      'here_now', v_here_now,
      'matching', v_matching,
      'active_matches', v_active_matches,
      'connections', v_connections,
      'waiting_to_stream', v_waiting_to_stream,
      'streamers', v_streamers,
      'bouncers', v_bouncers,
      'obs_ready', v_obs_ready
    ),
    'announcement', v_active_announcement,
    'funnel', v_funnel
  );
end;
$$;

revoke all on function public.get_room_host_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.get_room_host_dashboard(uuid) to authenticated;

notify pgrst, 'reload schema';
