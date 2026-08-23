create extension if not exists pgcrypto;

create table if not exists public.room_message_reports (
  id uuid primary key default gen_random_uuid(),
  -- Keep the originating IDs and evidence even if a room or message is deleted.
  room_id uuid not null,
  message_id uuid not null,
  reporter_user_id uuid null references auth.users(id) on delete set null,
  -- Retain the reported account identifier as moderation evidence after deletion.
  reported_user_id uuid null,
  reason text not null,
  details text null,
  message_snapshot text not null,
  display_name_snapshot text null,
  message_created_at timestamptz not null,
  status text not null default 'open',
  resolution text null,
  reviewed_by_user_id uuid null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  constraint room_message_reports_reason_check check (
    reason in (
      'harassment',
      'hate',
      'sexual_content',
      'threats',
      'spam_scam',
      'personal_information',
      'other'
    )
  ),
  constraint room_message_reports_details_length_check
    check (details is null or char_length(details) <= 500),
  constraint room_message_reports_status_check
    check (status in ('open', 'resolved', 'dismissed')),
  constraint room_message_reports_resolution_check check (
    resolution is null or resolution in (
      'dismissed',
      'message_removed',
      'message_already_removed',
      'user_muted_5m'
    )
  ),
  constraint room_message_reports_review_state_check check (
    (status = 'open' and resolution is null and reviewed_at is null)
    or
    (status in ('resolved', 'dismissed') and resolution is not null and reviewed_at is not null)
  )
);

create unique index if not exists room_message_reports_reporter_message_idx
  on public.room_message_reports(reporter_user_id, message_id)
  where reporter_user_id is not null;

create index if not exists room_message_reports_room_status_created_idx
  on public.room_message_reports(room_id, status, created_at desc);

create index if not exists room_message_reports_reporter_rate_idx
  on public.room_message_reports(reporter_user_id, created_at desc)
  where reporter_user_id is not null;

alter table public.room_message_reports enable row level security;
revoke all on public.room_message_reports from public, anon, authenticated;

alter table public.room_moderation_actions
  drop constraint if exists room_moderation_actions_action_check;

alter table public.room_moderation_actions
  add constraint room_moderation_actions_action_check
  check (action in (
    'settings_changed',
    'message_removed',
    'user_muted_5m',
    'report_dismissed',
    'report_resolved'
  ));

create or replace function public.submit_room_message_report(
  p_message_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_message public.room_messages;
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to report a message';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat-report:' || v_user_id::text, 0)
  );

  if v_reason not in (
    'harassment',
    'hate',
    'sexual_content',
    'threats',
    'spam_scam',
    'personal_information',
    'other'
  ) then
    raise exception 'Choose a report reason';
  end if;

  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'Report details must be 500 characters or fewer';
  end if;

  select message.*
  into v_message
  from public.room_messages message
  where message.id = p_message_id
    and message.removed_at is null;

  if not found then
    raise exception 'This message is no longer available';
  end if;

  if v_message.user_id is null then
    raise exception 'This message cannot be reported';
  end if;

  if v_message.user_id = v_user_id then
    raise exception 'You cannot report your own message';
  end if;

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = v_message.room_id
      and (
        coalesce(room.is_private, false) = false
        or room.host_id = v_user_id
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = v_user_id
            and attendee.status::text = 'accepted'
        )
      )
  ) then
    raise exception 'You cannot report messages in this room';
  end if;

  if exists (
    select 1
    from public.room_message_reports report
    where report.reporter_user_id = v_user_id
      and report.message_id = p_message_id
  ) then
    raise exception 'You already reported this message';
  end if;

  if (
    select count(*)
    from public.room_message_reports report
    where report.reporter_user_id = v_user_id
      and report.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'You have submitted too many reports. Try again later.';
  end if;

  insert into public.room_message_reports (
    room_id,
    message_id,
    reporter_user_id,
    reported_user_id,
    reason,
    details,
    message_snapshot,
    display_name_snapshot,
    message_created_at
  ) values (
    v_message.room_id,
    v_message.id,
    v_user_id,
    v_message.user_id,
    v_reason,
    v_details,
    v_message.message,
    v_message.display_name,
    v_message.created_at
  )
  returning id into v_report_id;

  return jsonb_build_object(
    'id', v_report_id,
    'status', 'open',
    'message_id', v_message.id
  );
end;
$$;

create or replace function public.get_room_message_reports(p_room_id uuid)
returns table (
  id uuid,
  message_id uuid,
  reported_user_id uuid,
  reason text,
  details text,
  message_snapshot text,
  display_name_snapshot text,
  message_created_at timestamptz,
  status text,
  resolution text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and room.host_id = auth.uid()
  ) then
    raise exception 'Only the room host can view reports';
  end if;

  return query
  select
    report.id,
    report.message_id,
    report.reported_user_id,
    report.reason,
    report.details,
    report.message_snapshot,
    report.display_name_snapshot,
    report.message_created_at,
    report.status,
    report.resolution,
    report.created_at,
    report.reviewed_at
  from public.room_message_reports report
  where report.room_id = p_room_id
  order by
    case when report.status = 'open' then 0 else 1 end,
    report.created_at desc
  limit 100;
end;
$$;

create or replace function public.get_my_room_message_report_ids(p_room_id uuid)
returns table (message_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select report.message_id
  from public.room_message_reports report
  where report.room_id = p_room_id
    and report.reporter_user_id = auth.uid();
$$;

create or replace function public.review_room_message_report(
  p_report_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_report public.room_message_reports;
  v_room public.event_rooms;
  v_message public.room_messages;
  v_resolution text;
  v_muted_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_action not in ('dismiss', 'remove_message', 'mute_5m') then
    raise exception 'Unsupported report action';
  end if;

  select report.*
  into v_report
  from public.room_message_reports report
  where report.id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found';
  end if;

  select room.*
  into v_room
  from public.event_rooms room
  where room.id = v_report.room_id;

  if v_room.host_id is distinct from auth.uid() then
    raise exception 'Only the room host can review reports';
  end if;

  if v_report.status <> 'open' then
    return jsonb_build_object(
      'id', v_report.id,
      'status', v_report.status,
      'resolution', v_report.resolution,
      'already_reviewed', true
    );
  end if;

  if v_action = 'dismiss' then
    v_resolution := 'dismissed';
  elsif v_action = 'remove_message' then
    select message.*
    into v_message
    from public.room_messages message
    where message.id = v_report.message_id;

    if not found or v_message.removed_at is not null then
      v_resolution := 'message_already_removed';
    else
      perform public.moderate_room_message(v_report.message_id, 'remove');
      v_resolution := 'message_removed';
    end if;
  else
    if v_report.reported_user_id is null then
      raise exception 'The reported account is no longer available';
    end if;

    if v_report.reported_user_id = v_room.host_id then
      raise exception 'The room host cannot be muted';
    end if;

    if not exists (
      select 1 from auth.users account where account.id = v_report.reported_user_id
    ) then
      raise exception 'The reported account is no longer available';
    end if;

    v_muted_until := now() + interval '5 minutes';

    insert into public.room_chat_mutes (
      room_id,
      target_user_id,
      muted_until,
      created_by,
      reason,
      created_at
    ) values (
      v_report.room_id,
      v_report.reported_user_id,
      v_muted_until,
      auth.uid(),
      'Muted from a message report',
      now()
    )
    on conflict (room_id, target_user_id) do update
    set muted_until = excluded.muted_until,
        created_by = excluded.created_by,
        reason = excluded.reason,
        created_at = now();

    insert into public.room_moderation_actions (
      room_id,
      message_id,
      target_user_id,
      moderator_user_id,
      action,
      metadata
    ) values (
      v_report.room_id,
      v_report.message_id,
      v_report.reported_user_id,
      auth.uid(),
      'user_muted_5m',
      jsonb_build_object('muted_until', v_muted_until, 'report_id', v_report.id)
    );

    v_resolution := 'user_muted_5m';
  end if;

  update public.room_message_reports
  set status = case when v_action = 'dismiss' then 'dismissed' else 'resolved' end,
      resolution = v_resolution,
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now()
  where id = v_report.id;

  insert into public.room_moderation_actions (
    room_id,
    message_id,
    target_user_id,
    moderator_user_id,
    action,
    metadata
  ) values (
    v_report.room_id,
    v_report.message_id,
    v_report.reported_user_id,
    auth.uid(),
    case when v_action = 'dismiss' then 'report_dismissed' else 'report_resolved' end,
    jsonb_build_object('report_id', v_report.id, 'resolution', v_resolution)
  );

  return jsonb_build_object(
    'id', v_report.id,
    'status', case when v_action = 'dismiss' then 'dismissed' else 'resolved' end,
    'resolution', v_resolution,
    'muted_until', v_muted_until,
    'already_reviewed', false
  );
end;
$$;

revoke all on function public.submit_room_message_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_room_message_reports(uuid) from public, anon, authenticated;
revoke all on function public.get_my_room_message_report_ids(uuid) from public, anon, authenticated;
revoke all on function public.review_room_message_report(uuid, text) from public, anon, authenticated;

grant execute on function public.submit_room_message_report(uuid, text, text) to authenticated;
grant execute on function public.get_room_message_reports(uuid) to authenticated;
grant execute on function public.get_my_room_message_report_ids(uuid) to authenticated;
grant execute on function public.review_room_message_report(uuid, text) to authenticated;

notify pgrst, 'reload schema';
