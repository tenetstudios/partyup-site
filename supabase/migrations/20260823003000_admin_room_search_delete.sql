create or replace function public.get_site_admin_dashboard_v2(
  p_user_search text default null,
  p_room_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_search text := left(lower(btrim(coalesce(p_user_search, ''))), 100);
  v_room_search text := left(lower(btrim(coalesce(p_room_search, ''))), 100);
begin
  if not public.is_site_admin() then
    raise exception 'Site administrator access required';
  end if;

  return jsonb_build_object(
    'counts', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'open_reports', (select count(*) from public.room_message_reports report where report.status = 'open'),
      'active_rooms', (select count(*) from public.event_rooms room where room.status::text <> 'ended'),
      'live_rooms', (select count(*) from public.room_live_state state where state.is_live),
      'failed_deletions', (select count(*) from public.account_deletion_requests request where request.status = 'failed')
    ),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(report_row) order by report_row.created_at desc)
      from (
        select
          report.id,
          report.room_id,
          report.message_id,
          report.reported_user_id,
          report.reason,
          report.details,
          report.message_snapshot,
          report.display_name_snapshot,
          report.status,
          report.resolution,
          report.created_at,
          report.reviewed_at,
          coalesce(to_jsonb(room)->>'title', to_jsonb(room)->>'name', 'Event room') as room_title
        from public.room_message_reports report
        left join public.event_rooms room on room.id = report.room_id
        order by case when report.status = 'open' then 0 else 1 end, report.created_at desc
        limit 50
      ) report_row
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(to_jsonb(user_row) order by user_row.created_at desc)
      from (
        select
          account.id,
          account.email,
          account.created_at,
          account.last_sign_in_at,
          profile.username,
          profile.avatar_url,
          administrator.role as admin_role
        from auth.users account
        left join public.profiles profile on profile.id = account.id
        left join public.site_admins administrator on administrator.user_id = account.id
        where v_user_search = ''
          or lower(coalesce(account.email, '')) like '%' || v_user_search || '%'
          or lower(coalesce(profile.username, '')) like '%' || v_user_search || '%'
          or account.id::text = v_user_search
        order by account.created_at desc
        limit 12
      ) user_row
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(to_jsonb(room_row) order by room_row.last_active_at desc nulls last)
      from (
        select
          room.id,
          room.host_id,
          room.status::text as status,
          coalesce(to_jsonb(room)->>'title', to_jsonb(room)->>'name', 'Event room') as title,
          coalesce(room.is_private, false) as is_private,
          coalesce(room.current_users, 0) as current_users,
          coalesce(room.queue_count, 0) as queue_count,
          room.last_active_at,
          profile.username as host_username,
          coalesce(live_state.is_live, false) as is_live,
          coalesce(live_state.active_publisher_count, 0) as active_publisher_count,
          live_state.signal_source,
          live_state.updated_at as live_state_updated_at
        from public.event_rooms room
        left join public.profiles profile on profile.id = room.host_id
        left join public.room_live_state live_state on live_state.room_id = room.id
        where v_room_search = ''
          or lower(coalesce(to_jsonb(room)->>'title', to_jsonb(room)->>'name', '')) like '%' || v_room_search || '%'
          or lower(coalesce(profile.username, '')) like '%' || v_room_search || '%'
          or room.id::text = v_room_search
          or lower(room.status::text) = v_room_search
        order by
          case when room.status::text <> 'ended' then 0 else 1 end,
          room.last_active_at desc nulls last
        limit 15
      ) room_row
    ), '[]'::jsonb),
    'deletion_requests', coalesce((
      select jsonb_agg(to_jsonb(deletion_row) order by deletion_row.requested_at desc)
      from (
        select
          request.request_id,
          left(request.account_fingerprint, 12) as account_fingerprint,
          request.status,
          request.requested_at,
          request.completed_at,
          request.last_error
        from public.account_deletion_requests request
        order by request.requested_at desc
        limit 30
      ) deletion_row
    ), '[]'::jsonb),
    'audit_log', coalesce((
      select jsonb_agg(to_jsonb(audit_row) order by audit_row.created_at desc)
      from (
        select
          audit.id,
          audit.admin_user_id,
          account.email as admin_email,
          audit.action,
          audit.target_type,
          audit.target_id,
          audit.reason,
          audit.metadata,
          audit.created_at
        from public.site_admin_audit_log audit
        left join auth.users account on account.id = audit.admin_user_id
        order by audit.created_at desc
        limit 50
      ) audit_row
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_delete_event_room(
  p_room_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_user_id uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_room public.event_rooms;
  v_memory_paths jsonb := '[]'::jsonb;
  v_idle_media_path text;
  v_title text;
  v_cover_image text;
begin
  if not public.is_site_admin() then
    raise exception 'Site administrator access required';
  end if;

  if char_length(v_reason) not between 5 and 500 then
    raise exception 'An audit reason between 5 and 500 characters is required';
  end if;

  select room.* into v_room
  from public.event_rooms room
  where room.id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  v_title := coalesce(to_jsonb(v_room)->>'title', to_jsonb(v_room)->>'name', 'Event room');
  v_cover_image := to_jsonb(v_room)->>'cover_image';

  select coalesce(jsonb_agg(path.value) filter (where path.value is not null), '[]'::jsonb)
  into v_memory_paths
  from public.room_memories memory
  cross join lateral (
    values (memory.media_path), (memory.thumbnail_path)
  ) path(value)
  where memory.room_id = p_room_id;

  select idle.media_path into v_idle_media_path
  from public.room_idle_media idle
  where idle.room_id = p_room_id;

  -- The original room schema does not cascade attendee rows, so remove them
  -- explicitly before deleting the room. Newer room-owned records cascade.
  delete from public.event_attendees where event_room_id = p_room_id;

  delete from public.event_rooms where id = p_room_id;

  insert into public.site_admin_audit_log (
    admin_user_id, action, target_type, target_id, reason, metadata
  ) values (
    v_admin_user_id,
    'delete_room',
    'event_room',
    p_room_id::text,
    v_reason,
    jsonb_build_object(
      'title', v_title,
      'host_id', v_room.host_id,
      'status', v_room.status::text,
      'memory_object_count', jsonb_array_length(v_memory_paths),
      'had_idle_media', v_idle_media_path is not null,
      'had_cover_image', v_cover_image is not null
    )
  );

  return jsonb_build_object(
    'room_id', p_room_id,
    'title', v_title,
    'memory_paths', v_memory_paths,
    'idle_media_path', v_idle_media_path,
    'cover_image', v_cover_image,
    'deleted_at', now()
  );
end;
$$;

revoke all on function public.get_site_admin_dashboard_v2(text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_event_room(uuid, text) from public, anon, authenticated;

grant execute on function public.get_site_admin_dashboard_v2(text, text) to authenticated;
grant execute on function public.admin_delete_event_room(uuid, text) to authenticated;

notify pgrst, 'reload schema';
