create extension if not exists pgcrypto;

alter table public.room_messages
  add column if not exists removed_at timestamptz null,
  add column if not exists removed_by uuid null references auth.users(id) on delete set null,
  add column if not exists removal_reason text null;

create index if not exists room_messages_visible_room_created_idx
  on public.room_messages(room_id, created_at)
  where removed_at is null;

create table if not exists public.room_moderation_settings (
  room_id uuid primary key references public.event_rooms(id) on delete cascade,
  preset text not null default 'relaxed',
  slow_mode_seconds integer not null default 0,
  links_mode text not null default 'everyone',
  duplicate_filter_enabled boolean not null default true,
  chat_mode text not null default 'everyone',
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint room_moderation_settings_preset_check
    check (preset in ('relaxed', 'social', 'host_only')),
  constraint room_moderation_settings_slow_mode_check
    check (slow_mode_seconds in (0, 5)),
  constraint room_moderation_settings_links_mode_check
    check (links_mode in ('everyone', 'hosts_only')),
  constraint room_moderation_settings_chat_mode_check
    check (chat_mode in ('everyone', 'host_only')),
  constraint room_moderation_settings_canonical_preset_check
    check (
      duplicate_filter_enabled = true
      and (
        (preset = 'relaxed' and slow_mode_seconds = 0 and chat_mode = 'everyone')
        or (preset = 'social' and slow_mode_seconds = 5 and chat_mode = 'everyone')
        or (preset = 'host_only' and slow_mode_seconds = 0 and chat_mode = 'host_only')
      )
    )
);

create table if not exists public.room_chat_mutes (
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  muted_until timestamptz not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  reason text null,
  created_at timestamptz not null default now(),
  primary key (room_id, target_user_id),
  constraint room_chat_mutes_future_check check (muted_until > created_at)
);

create index if not exists room_chat_mutes_expiry_idx
  on public.room_chat_mutes(muted_until);

create table if not exists public.room_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  message_id uuid null,
  -- Keep immutable actor/target IDs even if an auth account is later deleted.
  target_user_id uuid null,
  moderator_user_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_moderation_actions_action_check
    check (action in ('settings_changed', 'message_removed', 'user_muted_5m')),
  constraint room_moderation_actions_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists room_moderation_actions_room_created_idx
  on public.room_moderation_actions(room_id, created_at desc);

alter table public.room_moderation_settings enable row level security;
alter table public.room_chat_mutes enable row level security;
alter table public.room_moderation_actions enable row level security;

revoke all on public.room_moderation_settings from anon, authenticated;
revoke all on public.room_chat_mutes from anon, authenticated;
revoke all on public.room_moderation_actions from anon, authenticated;

create or replace function public.get_room_moderation_settings(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_settings public.room_moderation_settings;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and (
        coalesce(room.is_private, false) = false
        or room.host_id = auth.uid()
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = auth.uid()
            and attendee.status::text = 'accepted'
        )
      )
  ) then
    raise exception 'Room not found or unavailable';
  end if;

  select settings.*
  into v_settings
  from public.room_moderation_settings settings
  where settings.room_id = p_room_id;

  return jsonb_build_object(
    'room_id', p_room_id,
    'preset', coalesce(v_settings.preset, 'relaxed'),
    'slow_mode_seconds', coalesce(v_settings.slow_mode_seconds, 0),
    'links_mode', coalesce(v_settings.links_mode, 'everyone'),
    'duplicate_filter_enabled', coalesce(v_settings.duplicate_filter_enabled, true),
    'chat_mode', coalesce(v_settings.chat_mode, 'everyone'),
    'updated_at', v_settings.updated_at
  );
end;
$$;

create or replace function public.set_room_moderation_settings(
  p_room_id uuid,
  p_preset text,
  p_links_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_preset text := lower(btrim(coalesce(p_preset, '')));
  v_links_mode text := lower(btrim(coalesce(p_links_mode, '')));
  v_slow_mode_seconds integer;
  v_chat_mode text;
  v_settings public.room_moderation_settings;
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
    raise exception 'Only the room host can change chat moderation settings';
  end if;

  if v_preset not in ('relaxed', 'social', 'host_only') then
    raise exception 'Choose Relaxed, Social, or Host Only';
  end if;

  if v_links_mode not in ('everyone', 'hosts_only') then
    raise exception 'Choose Everyone or Hosts and bouncers only for links';
  end if;

  v_slow_mode_seconds := case when v_preset = 'social' then 5 else 0 end;
  v_chat_mode := case when v_preset = 'host_only' then 'host_only' else 'everyone' end;

  insert into public.room_moderation_settings (
    room_id,
    preset,
    slow_mode_seconds,
    links_mode,
    duplicate_filter_enabled,
    chat_mode,
    updated_by,
    updated_at
  ) values (
    p_room_id,
    v_preset,
    v_slow_mode_seconds,
    v_links_mode,
    true,
    v_chat_mode,
    auth.uid(),
    now()
  )
  on conflict (room_id) do update
  set preset = excluded.preset,
      slow_mode_seconds = excluded.slow_mode_seconds,
      links_mode = excluded.links_mode,
      duplicate_filter_enabled = true,
      chat_mode = excluded.chat_mode,
      updated_by = auth.uid(),
      updated_at = now()
  returning * into v_settings;

  insert into public.room_moderation_actions (
    room_id,
    moderator_user_id,
    action,
    metadata
  ) values (
    p_room_id,
    auth.uid(),
    'settings_changed',
    jsonb_build_object(
      'preset', v_settings.preset,
      'links_mode', v_settings.links_mode,
      'slow_mode_seconds', v_settings.slow_mode_seconds,
      'chat_mode', v_settings.chat_mode
    )
  );

  return jsonb_build_object(
    'room_id', v_settings.room_id,
    'preset', v_settings.preset,
    'slow_mode_seconds', v_settings.slow_mode_seconds,
    'links_mode', v_settings.links_mode,
    'duplicate_filter_enabled', v_settings.duplicate_filter_enabled,
    'chat_mode', v_settings.chat_mode,
    'updated_at', v_settings.updated_at
  );
end;
$$;

create or replace function public.send_room_message(
  p_room_id uuid,
  p_message text
)
returns public.room_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.event_rooms;
  v_message_text text := btrim(coalesce(p_message, ''));
  v_normalized_message text;
  v_display_name text;
  v_is_host boolean := false;
  v_is_bouncer boolean := false;
  v_is_accepted boolean := false;
  v_slow_mode_seconds integer := 0;
  v_links_mode text := 'everyone';
  v_duplicate_filter_enabled boolean := true;
  v_chat_mode text := 'everyone';
  v_muted_until timestamptz;
  v_last_message_at timestamptz;
  v_wait_seconds integer;
  v_column_max_length integer;
  v_inserted public.room_messages;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_message_text = '' then
    raise exception 'Enter a message first';
  end if;

  select case when attribute.atttypmod > 4 then attribute.atttypmod - 4 else null end
  into v_column_max_length
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.room_messages'::regclass
    and attribute.attname = 'message'
    and not attribute.attisdropped;

  if v_column_max_length is not null
     and char_length(v_message_text) > v_column_max_length then
    raise exception 'Message must be % characters or fewer', v_column_max_length;
  end if;

  select room.*
  into v_room
  from public.event_rooms room
  where room.id = p_room_id;

  if not found then
    raise exception 'Room not found';
  end if;

  if v_room.status::text = 'ended' then
    raise exception 'This event has ended. Chat is now read-only.';
  end if;

  v_is_host := v_room.host_id = v_user_id;

  select
    coalesce(bool_or(attendee.status::text = 'accepted'), false),
    coalesce(bool_or(
      attendee.status::text = 'accepted'
      and attendee.room_role::text in ('bouncer', 'admin')
    ), false)
  into v_is_accepted, v_is_bouncer
  from public.event_attendees attendee
  where attendee.event_room_id = p_room_id
    and attendee.user_id = v_user_id;

  if coalesce(v_room.is_private, false)
     and not v_is_host
     and not v_is_accepted then
    raise exception 'You are not allowed to chat in this private room';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text || ':' || v_user_id::text, 0)
  );

  delete from public.room_chat_mutes mute
  where mute.room_id = p_room_id
    and mute.target_user_id = v_user_id
    and mute.muted_until <= now();

  select mute.muted_until
  into v_muted_until
  from public.room_chat_mutes mute
  where mute.room_id = p_room_id
    and mute.target_user_id = v_user_id
    and mute.muted_until > now();

  if v_muted_until is not null then
    raise exception 'You are muted in this room until %.',
      to_char(v_muted_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"');
  end if;

  select
    settings.slow_mode_seconds,
    settings.links_mode,
    settings.duplicate_filter_enabled,
    settings.chat_mode
  into
    v_slow_mode_seconds,
    v_links_mode,
    v_duplicate_filter_enabled,
    v_chat_mode
  from public.room_moderation_settings settings
  where settings.room_id = p_room_id;

  if not found then
    v_slow_mode_seconds := 0;
    v_links_mode := 'everyone';
    v_duplicate_filter_enabled := true;
    v_chat_mode := 'everyone';
  end if;

  if v_chat_mode = 'host_only' and not (v_is_host or v_is_bouncer) then
    raise exception 'Chat is currently limited to hosts and bouncers.';
  end if;

  if v_slow_mode_seconds > 0 then
    select max(message.created_at)
    into v_last_message_at
    from public.room_messages message
    where message.room_id = p_room_id
      and message.user_id = v_user_id
      and message.removed_at is null;

    if v_last_message_at is not null
       and v_last_message_at > now() - make_interval(secs => v_slow_mode_seconds) then
      v_wait_seconds := greatest(
        1,
        ceil(extract(epoch from (
          v_last_message_at + make_interval(secs => v_slow_mode_seconds) - now()
        )))::integer
      );
      raise exception 'Slow mode is on. You can send another message in % seconds.', v_wait_seconds;
    end if;
  end if;

  v_normalized_message := lower(regexp_replace(v_message_text, '[[:space:]]+', ' ', 'g'));

  if v_duplicate_filter_enabled and exists (
    select 1
    from public.room_messages message
    where message.room_id = p_room_id
      and message.user_id = v_user_id
      and message.removed_at is null
      and message.created_at > now() - interval '30 seconds'
      and lower(regexp_replace(btrim(message.message), '[[:space:]]+', ' ', 'g')) = v_normalized_message
  ) then
    raise exception 'That looks like a repeated message. Try saying something new.';
  end if;

  if v_links_mode = 'hosts_only'
     and not (v_is_host or v_is_bouncer)
     and v_message_text ~* '(^|[^[:alnum:]])(https?://|www\.)' then
    raise exception 'Links are currently limited to hosts and bouncers.';
  end if;

  select coalesce(
    nullif(btrim(profile.username), ''),
    'Guest ' || left(v_user_id::text, 4)
  )
  into v_display_name
  from public.profiles profile
  where profile.id = v_user_id;

  v_display_name := coalesce(v_display_name, 'Guest ' || left(v_user_id::text, 4));

  insert into public.room_messages (
    room_id,
    user_id,
    message,
    display_name
  ) values (
    p_room_id,
    v_user_id,
    v_message_text,
    v_display_name
  )
  returning * into v_inserted;

  return v_inserted;
end;
$$;

create or replace function public.moderate_room_message(
  p_message_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_message public.room_messages;
  v_room public.event_rooms;
  v_is_host boolean := false;
  v_is_bouncer boolean := false;
  v_muted_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_action not in ('remove', 'mute_5m') then
    raise exception 'Unsupported moderation action';
  end if;

  select message.*
  into v_message
  from public.room_messages message
  where message.id = p_message_id
    and message.removed_at is null
  for update;

  if not found then
    raise exception 'Message not found';
  end if;

  select room.*
  into v_room
  from public.event_rooms room
  where room.id = v_message.room_id;

  v_is_host := v_room.host_id = auth.uid();
  v_is_bouncer := exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_room_id = v_message.room_id
      and attendee.user_id = auth.uid()
      and attendee.status::text = 'accepted'
      and attendee.room_role::text in ('bouncer', 'admin')
  );

  if not (v_is_host or v_is_bouncer) then
    raise exception 'Only the room host or a bouncer can moderate messages';
  end if;

  if v_action = 'mute_5m' then
    if not v_is_host then
      raise exception 'Only the room host can mute participants';
    end if;

    if v_message.user_id = v_room.host_id then
      raise exception 'The room host cannot be muted';
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
      v_message.room_id,
      v_message.user_id,
      v_muted_until,
      auth.uid(),
      'Muted from a room message',
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
      v_message.room_id,
      v_message.id,
      v_message.user_id,
      auth.uid(),
      'user_muted_5m',
      jsonb_build_object('muted_until', v_muted_until)
    );

    return jsonb_build_object(
      'status', 'muted',
      'room_id', v_message.room_id,
      'message_id', v_message.id,
      'target_user_id', v_message.user_id,
      'muted_until', v_muted_until
    );
  end if;

  insert into public.room_moderation_actions (
    room_id,
    message_id,
    target_user_id,
    moderator_user_id,
    action,
    metadata
  ) values (
    v_message.room_id,
    v_message.id,
    v_message.user_id,
    auth.uid(),
    'message_removed',
    jsonb_build_object('display_name', v_message.display_name)
  );

  -- Scrub content so existing permissive SELECT policies cannot recover it.
  -- Clients filter removed rows and receive the change through realtime UPDATE.
  update public.room_messages message
  set message = '[removed]',
      removed_at = now(),
      removed_by = auth.uid(),
      removal_reason = 'moderator_removed'
  where message.id = v_message.id;

  return jsonb_build_object(
    'status', 'removed',
    'room_id', v_message.room_id,
    'message_id', v_message.id
  );
end;
$$;

revoke all on function public.get_room_moderation_settings(uuid) from public, anon, authenticated;
revoke all on function public.set_room_moderation_settings(uuid, text, text) from public, anon, authenticated;
revoke all on function public.send_room_message(uuid, text) from public, anon, authenticated;
revoke all on function public.moderate_room_message(uuid, text) from public, anon, authenticated;

grant execute on function public.get_room_moderation_settings(uuid) to authenticated;
grant execute on function public.set_room_moderation_settings(uuid, text, text) to authenticated;
grant execute on function public.send_room_message(uuid, text) to authenticated;
grant execute on function public.moderate_room_message(uuid, text) to authenticated;

-- Clients must use send_room_message so moderation cannot be bypassed.
revoke insert, update, delete on public.room_messages from public, anon, authenticated;

notify pgrst, 'reload schema';
