create or replace function public.get_host_reputation_profile(p_host_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer_id uuid := auth.uid();
  v_profile public.profiles;
  v_events_hosted integer := 0;
  v_people_attended integer := 0;
  v_connections_created integer := 0;
  v_memories_created integer := 0;
  v_followers integer := 0;
  v_following integer := 0;
  v_is_following boolean := false;
  v_connected boolean := false;
  v_connection_id uuid := null;
  v_is_live_now boolean := false;
  v_upcoming_events jsonb := '[]'::jsonb;
  v_past_events jsonb := '[]'::jsonb;
begin
  if p_host_user_id is null then
    raise exception 'Host user id is required';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_host_user_id;

  if not found then
    return null;
  end if;

  select count(*)::integer
  into v_events_hosted
  from public.event_rooms room
  where room.host_id = p_host_user_id;

  select count(distinct attendee.user_id)::integer
  into v_people_attended
  from public.event_rooms room
  join public.event_attendees attendee
    on attendee.event_room_id = room.id
   and attendee.status::text = 'accepted'
  where room.host_id = p_host_user_id;

  select count(distinct connection.id)::integer
  into v_connections_created
  from public.event_rooms room
  join public.match_pools pool
    on pool.pool_type = 'event'
   and pool.source_id = room.id
  join public.partyup_connections connection
    on connection.source_pool_id = pool.id
   and connection.removed_at is null
  where room.host_id = p_host_user_id;

  select count(*)::integer
  into v_memories_created
  from public.event_rooms room
  join public.room_memories memory
    on memory.room_id = room.id
   and memory.deleted_at is null
  where room.host_id = p_host_user_id;

  select count(*)::integer
  into v_followers
  from public.follows
  where following_id = p_host_user_id;

  select count(*)::integer
  into v_following
  from public.follows
  where follower_id = p_host_user_id;

  if v_viewer_id is not null then
    select exists (
      select 1
      from public.follows
      where follower_id = v_viewer_id
        and following_id = p_host_user_id
    )
    into v_is_following;

    select connection.id
    into v_connection_id
    from public.partyup_connections connection
    join public.partyup_identities viewer_identity
      on viewer_identity.user_id = v_viewer_id
     and viewer_identity.id in (connection.identity_a, connection.identity_b)
    join public.partyup_identities host_identity
      on host_identity.user_id = p_host_user_id
     and host_identity.id in (connection.identity_a, connection.identity_b)
    where connection.removed_at is null
    limit 1;

    v_connected := v_connection_id is not null;
  end if;

  select exists (
    select 1
    from public.event_rooms room
    where room.host_id = p_host_user_id
      and room.status::text = 'live'
  )
  into v_is_live_now;

  select coalesce(jsonb_agg(event_row order by sort_date asc), '[]'::jsonb)
  into v_upcoming_events
  from (
    select
      coalesce(room.scheduled_at, room.created_at, now()) as sort_date,
      jsonb_build_object(
        'id', room.id,
        'title', coalesce(nullif(room.title, ''), 'PartyUp event'),
        'status', room.status::text,
        'event_date', coalesce(room.scheduled_at, room.created_at),
        'venue_name', to_jsonb(room)->>'venue_name',
        'cover_image_url', coalesce(to_jsonb(room)->>'cover_image', to_jsonb(room)->>'image_url'),
        'people_count', (
          select count(distinct attendee.user_id)::integer
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.status::text = 'accepted'
        ),
        'memory_count', (
          select count(*)::integer
          from public.room_memories memory
          where memory.room_id = room.id
            and memory.deleted_at is null
        ),
        'connection_count', (
          select count(distinct connection.id)::integer
          from public.match_pools pool
          join public.partyup_connections connection
            on connection.source_pool_id = pool.id
           and connection.removed_at is null
          where pool.pool_type = 'event'
            and pool.source_id = room.id
        )
      ) as event_row
    from public.event_rooms room
    where room.host_id = p_host_user_id
      and room.status::text in ('live', 'scheduled')
    order by sort_date asc
    limit 8
  ) rows;

  select coalesce(jsonb_agg(event_row order by sort_date desc), '[]'::jsonb)
  into v_past_events
  from (
    select
      coalesce(room.scheduled_at, room.created_at, now()) as sort_date,
      jsonb_build_object(
        'id', room.id,
        'title', coalesce(nullif(room.title, ''), 'PartyUp event'),
        'status', room.status::text,
        'event_date', coalesce(room.scheduled_at, room.created_at),
        'venue_name', to_jsonb(room)->>'venue_name',
        'cover_image_url', coalesce(to_jsonb(room)->>'cover_image', to_jsonb(room)->>'image_url'),
        'people_count', (
          select count(distinct attendee.user_id)::integer
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.status::text = 'accepted'
        ),
        'memory_count', (
          select count(*)::integer
          from public.room_memories memory
          where memory.room_id = room.id
            and memory.deleted_at is null
        ),
        'connection_count', (
          select count(distinct connection.id)::integer
          from public.match_pools pool
          join public.partyup_connections connection
            on connection.source_pool_id = pool.id
           and connection.removed_at is null
          where pool.pool_type = 'event'
            and pool.source_id = room.id
        )
      ) as event_row
    from public.event_rooms room
    where room.host_id = p_host_user_id
      and room.status::text = 'ended'
    order by sort_date desc
    limit 24
  ) rows;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'display_name', to_jsonb(v_profile)->>'display_name',
      'avatar_url', v_profile.avatar_url,
      'bio', v_profile.bio,
      'location', coalesce(to_jsonb(v_profile)->>'location', to_jsonb(v_profile)->>'city'),
      'is_verified_host', coalesce((to_jsonb(v_profile)->>'is_verified_host')::boolean, false)
    ),
    'social', jsonb_build_object(
      'followers', v_followers,
      'following', v_following,
      'is_following', v_is_following,
      'connected', v_connected,
      'connection_id', v_connection_id
    ),
    'summary', jsonb_build_object(
      'events_hosted', v_events_hosted,
      'people_attended', v_people_attended,
      'connections_created', v_connections_created,
      'memories_created', v_memories_created,
      'is_live_now', v_is_live_now
    ),
    'upcoming_events', v_upcoming_events,
    'past_events', v_past_events
  );
end;
$$;

revoke all on function public.get_host_reputation_profile(uuid) from public, anon, authenticated;
grant execute on function public.get_host_reputation_profile(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
