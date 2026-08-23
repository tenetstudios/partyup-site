create index if not exists partyup_connection_events_room_identity_a_idx
  on public.partyup_connection_events(room_id, identity_a, occurred_at desc)
  where room_id is not null and connection_method = 'partyup_tap';

create index if not exists partyup_connection_events_room_identity_b_idx
  on public.partyup_connection_events(room_id, identity_b, occurred_at desc)
  where room_id is not null and connection_method = 'partyup_tap';

create or replace function public.publish_connection_mission(
  p_room_id uuid,
  p_target_connections integer,
  p_duration_minutes integer
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_starts_at timestamptz := now();
  v_title text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can publish Missions'; end if;
  if exists (select 1 from public.event_rooms where id = p_room_id and status::text = 'ended') then
    raise exception 'Missions cannot be published after the event ends';
  end if;
  if p_target_connections is null or p_target_connections < 1 or p_target_connections > 20 then
    raise exception 'Connection target must be between 1 and 20 people';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Connection Mission duration must be between 1 and 1440 minutes';
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  v_title := 'Meet ' || p_target_connections::text || ' new '
    || case when p_target_connections = 1 then 'person' else 'people' end
    || ' on PartyUp';

  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || p_room_id::text));
  perform public.close_expired_room_missions(p_room_id);

  update public.room_missions
  set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = p_room_id and status = 'active';

  insert into public.room_missions (
    room_id, created_by_identity_id, title, description, mission_type, config,
    status, starts_at, ends_at
  ) values (
    p_room_id,
    v_identity_id,
    v_title,
    'Use PartyUp Tap to make new connections with people in this room.',
    'connection',
    jsonb_build_object(
      'target_connections', p_target_connections,
      'completion_event', 'partyup_connection_created'
    ),
    'active',
    v_starts_at,
    v_starts_at + make_interval(mins => p_duration_minutes)
  ) returning * into v_mission;

  return v_mission;
end;
$$;

create or replace function public.get_my_connection_mission_state(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_progress integer := 0;
  v_target integer;
  v_completed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  select * into v_mission from public.room_missions where id = p_mission_id;

  if not found or v_mission.mission_type <> 'connection' then
    raise exception 'Connection Mission not found';
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id)
     and not public.is_room_host(v_mission.room_id) then
    raise exception 'You cannot view this Mission state';
  end if;

  v_target := greatest(1, least(20, coalesce((v_mission.config->>'target_connections')::integer, 1)));

  select count(distinct case
    when connection_event.identity_a = v_identity_id then connection_event.identity_b
    else connection_event.identity_a
  end)::integer
  into v_progress
  from public.partyup_connection_events connection_event
  where connection_event.room_id = v_mission.room_id
    and connection_event.connection_method = 'partyup_tap'
    and v_identity_id in (connection_event.identity_a, connection_event.identity_b)
    and connection_event.occurred_at >= v_mission.starts_at
    and (v_mission.ends_at is null or connection_event.occurred_at < v_mission.ends_at)
    and coalesce(connection_event.metadata->>'mission_eligible', 'true') = 'true';

  select completed_at into v_completed_at
  from public.mission_completions
  where mission_id = p_mission_id and participant_identity_id = v_identity_id;

  return jsonb_build_object(
    'progress', v_progress,
    'target_connections', v_target,
    'completed', v_completed_at is not null,
    'completed_at', v_completed_at,
    'mission_active', v_mission.status = 'active'
      and v_mission.starts_at <= now()
      and (v_mission.ends_at is null or v_mission.ends_at > now())
      and exists (
        select 1 from public.event_rooms
        where id = v_mission.room_id and status::text <> 'ended'
      )
  );
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
  v_is_new_connection boolean := false;
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
      v_is_new_connection := not found;

      if v_token.origin_room_id is not null
         and public.is_partyup_room_member(v_token.origin_room_id, v_creator_user_id)
         and public.is_partyup_room_member(v_token.origin_room_id, v_user_id) then
        v_room_id := v_token.origin_room_id;
        select coalesce(nullif(room.title, ''), 'PartyUp event') into v_room_label
        from public.event_rooms room where room.id = v_room_id;
      end if;

      -- Serialize Mission progress for either participant. Without this,
      -- simultaneous Taps involving the same person could each miss the
      -- other's uncommitted event at the completion threshold.
      if v_is_new_connection and v_room_id is not null then
        perform pg_advisory_xact_lock(hashtext(
          'partyup-connection-mission:' || v_room_id::text || ':' || v_identity_a::text
        ));
        perform pg_advisory_xact_lock(hashtext(
          'partyup-connection-mission:' || v_room_id::text || ':' || v_identity_b::text
        ));
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
        jsonb_build_object(
          'source', 'partyup_tap',
          'mission_eligible', v_is_new_connection
        )
      from public.partyup_identities identity_a_user
      join public.partyup_identities identity_b_user on identity_b_user.id = v_identity_b
      where identity_a_user.id = v_identity_a;

      if v_is_new_connection and v_room_id is not null then
        insert into public.mission_completions (mission_id, participant_identity_id, completed_at)
        select mission.id, participant.identity_id, v_connection.connected_at
        from public.room_missions mission
        cross join (values (v_identity_a), (v_identity_b)) participant(identity_id)
        where mission.room_id = v_room_id
          and mission.status = 'active'
          and mission.starts_at <= v_connection.connected_at
          and (mission.ends_at is null or mission.ends_at > v_connection.connected_at)
          and (
            mission.mission_type = 'connection'
            or mission.config->>'completion_event' = 'partyup_connection_created'
          )
          and (
            select count(distinct case
              when progress_event.identity_a = participant.identity_id then progress_event.identity_b
              else progress_event.identity_a
            end)
            from public.partyup_connection_events progress_event
            where progress_event.room_id = mission.room_id
              and progress_event.connection_method = 'partyup_tap'
              and participant.identity_id in (progress_event.identity_a, progress_event.identity_b)
              and progress_event.occurred_at >= mission.starts_at
              and (mission.ends_at is null or progress_event.occurred_at < mission.ends_at)
              and coalesce(progress_event.metadata->>'mission_eligible', 'true') = 'true'
          ) >= greatest(1, least(20, coalesce((mission.config->>'target_connections')::integer, 1)))
        on conflict (mission_id, participant_identity_id) do nothing;

        update public.room_missions mission
        set updated_at = now()
        where mission.room_id = v_room_id
          and mission.status = 'active'
          and mission.starts_at <= v_connection.connected_at
          and (mission.ends_at is null or mission.ends_at > v_connection.connected_at)
          and (
            mission.mission_type = 'connection'
            or mission.config->>'completion_event' = 'partyup_connection_created'
          );
      end if;
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

revoke all on function public.publish_connection_mission(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_my_connection_mission_state(uuid) from public, anon, authenticated;
grant execute on function public.publish_connection_mission(uuid, integer, integer) to authenticated;
grant execute on function public.get_my_connection_mission_state(uuid) to authenticated;
