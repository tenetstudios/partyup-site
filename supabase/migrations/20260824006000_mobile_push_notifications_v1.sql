-- PartyUp mobile push notifications V1. Activity remains the durable user-facing
-- source of truth; these tables add private device delivery and idempotent fanout.

alter table public.notifications
  add column if not exists source_event_key text null,
  add column if not exists data jsonb not null default '{}'::jsonb;

create unique index if not exists notifications_user_source_event_key_idx
  on public.notifications(user_id, source_event_key)
  where source_event_key is not null;

create table if not exists public.notification_preferences (
  identity_id uuid primary key references public.partyup_identities(id) on delete cascade,
  missions_enabled boolean not null default true,
  announcements_enabled boolean not null default true,
  recaps_enabled boolean not null default true,
  connections_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  enabled boolean not null default true,
  app_version text null,
  device_label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz null,
  disabled_reason text null
);

create index if not exists push_devices_identity_enabled_idx
  on public.push_devices(identity_id, enabled);

create table if not exists public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'mission_started', 'announcement', 'wild_result', 'recap_ready'
  )),
  preference_category text not null check (preference_category in (
    'missions', 'announcements', 'recaps'
  )),
  source_id uuid not null,
  room_id uuid null references public.event_rooms(id) on delete cascade,
  target_identity_id uuid null references public.partyup_identities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 240),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint push_notification_events_source_unique unique (event_type, source_id)
);

create index if not exists push_notification_events_room_created_idx
  on public.push_notification_events(room_id, created_at desc);

create table if not exists public.push_notification_recipients (
  event_id uuid not null references public.push_notification_events(id) on delete cascade,
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  activity_notification_id uuid null references public.notifications(id) on delete set null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, identity_id)
);

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.push_notification_events(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'sent', 'delivered', 'failed', 'dead'
  )),
  expo_ticket_id text null,
  error_code text null,
  error_message text null,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz null,
  receipt_checked_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint push_notification_deliveries_once unique (event_id, device_id)
);

create index if not exists push_notification_deliveries_receipts_idx
  on public.push_notification_deliveries(status, sent_at)
  where expo_ticket_id is not null and receipt_checked_at is null;

alter table public.notification_preferences enable row level security;
alter table public.push_devices enable row level security;
alter table public.push_notification_events enable row level security;
alter table public.push_notification_recipients enable row level security;
alter table public.push_notification_deliveries enable row level security;

revoke all on public.notification_preferences from anon, authenticated;
revoke all on public.push_devices from anon, authenticated;
revoke all on public.push_notification_events from anon, authenticated;
revoke all on public.push_notification_recipients from anon, authenticated;
revoke all on public.push_notification_deliveries from anon, authenticated;

grant select on public.notification_preferences to authenticated;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
on public.notification_preferences for select to authenticated
using (
  exists (
    select 1 from public.partyup_identities identity
    where identity.id = notification_preferences.identity_id
      and identity.user_id = auth.uid()
  )
);

create or replace function public.resolve_push_identity(p_guest_token text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if auth.uid() is not null then
    select id into v_identity_id
    from public.partyup_identities
    where user_id = auth.uid()
    limit 1;
  elsif nullif(btrim(coalesce(p_guest_token, '')), '') is not null then
    v_identity_id := public.resolve_guest_identity(p_guest_token);
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp identity required';
  end if;
  return v_identity_id;
end;
$$;

create or replace function public.register_push_device(
  p_expo_push_token text,
  p_platform text,
  p_app_version text default null,
  p_device_label text default null,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_device public.push_devices;
begin
  v_identity_id := public.resolve_push_identity(p_guest_token);
  if p_expo_push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$' then
    raise exception 'Invalid Expo push token';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'Unsupported push platform';
  end if;

  insert into public.notification_preferences(identity_id)
  values (v_identity_id)
  on conflict (identity_id) do nothing;

  insert into public.push_devices (
    identity_id, expo_push_token, platform, enabled, app_version, device_label,
    last_seen_at, disabled_at, disabled_reason
  ) values (
    v_identity_id, p_expo_push_token, p_platform, true,
    nullif(btrim(coalesce(p_app_version, '')), ''),
    nullif(btrim(coalesce(p_device_label, '')), ''),
    now(), null, null
  )
  on conflict (expo_push_token) do update
    set identity_id = excluded.identity_id,
        platform = excluded.platform,
        enabled = true,
        app_version = excluded.app_version,
        device_label = excluded.device_label,
        last_seen_at = now(),
        updated_at = now(),
        disabled_at = null,
        disabled_reason = null
  returning * into v_device;

  return jsonb_build_object(
    'device_id', v_device.id,
    'identity_id', v_identity_id,
    'enabled', v_device.enabled
  );
end;
$$;

create or replace function public.disable_push_device(
  p_expo_push_token text,
  p_guest_token text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.resolve_push_identity(p_guest_token);
begin
  update public.push_devices
  set enabled = false,
      disabled_at = now(),
      disabled_reason = 'user_disabled',
      updated_at = now()
  where expo_push_token = p_expo_push_token
    and identity_id = v_identity_id;
  return found;
end;
$$;

create or replace function public.get_my_notification_preferences(
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.resolve_push_identity(p_guest_token);
  v_preferences public.notification_preferences;
  v_enabled_devices integer;
begin
  insert into public.notification_preferences(identity_id)
  values (v_identity_id)
  on conflict (identity_id) do nothing;

  select * into v_preferences
  from public.notification_preferences
  where identity_id = v_identity_id;

  select count(*)::integer into v_enabled_devices
  from public.push_devices
  where identity_id = v_identity_id and enabled;

  return jsonb_build_object(
    'missions', v_preferences.missions_enabled,
    'announcements', v_preferences.announcements_enabled,
    'recaps', v_preferences.recaps_enabled,
    'connections', v_preferences.connections_enabled,
    'enabled_devices', v_enabled_devices
  );
end;
$$;

create or replace function public.set_my_notification_preferences(
  p_missions boolean,
  p_announcements boolean,
  p_recaps boolean,
  p_connections boolean,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid := public.resolve_push_identity(p_guest_token);
begin
  insert into public.notification_preferences (
    identity_id, missions_enabled, announcements_enabled, recaps_enabled, connections_enabled, updated_at
  ) values (
    v_identity_id, p_missions, p_announcements, p_recaps, p_connections, now()
  )
  on conflict (identity_id) do update
    set missions_enabled = excluded.missions_enabled,
        announcements_enabled = excluded.announcements_enabled,
        recaps_enabled = excluded.recaps_enabled,
        connections_enabled = excluded.connections_enabled,
        updated_at = now();

  return public.get_my_notification_preferences(p_guest_token);
end;
$$;

-- Claiming an existing guest identity keeps the same identity_id. When an
-- account identity already exists, the existing claim flow revokes the guest
-- session; this trigger safely moves device ownership and preserves explicit
-- account preferences.
create or replace function public.reassign_push_on_guest_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_identity_id uuid;
begin
  if old.revoked_at is not null or new.revoked_at is null or auth.uid() is null then
    return new;
  end if;

  select id into v_account_identity_id
  from public.partyup_identities
  where user_id = auth.uid()
  limit 1;

  if v_account_identity_id is null or v_account_identity_id = new.identity_id then
    return new;
  end if;

  update public.push_devices
  set identity_id = v_account_identity_id, updated_at = now()
  where identity_id = new.identity_id;

  insert into public.notification_preferences (
    identity_id, missions_enabled, announcements_enabled, recaps_enabled, connections_enabled
  )
  select v_account_identity_id, missions_enabled, announcements_enabled, recaps_enabled, connections_enabled
  from public.notification_preferences
  where identity_id = new.identity_id
  on conflict (identity_id) do nothing;

  delete from public.notification_preferences where identity_id = new.identity_id;
  return new;
end;
$$;

drop trigger if exists partyup_guest_sessions_reassign_push on public.partyup_guest_sessions;
create trigger partyup_guest_sessions_reassign_push
after update of revoked_at on public.partyup_guest_sessions
for each row execute function public.reassign_push_on_guest_claim();

create or replace function public.room_push_participant_identities(p_room_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct identity.id
  from public.partyup_identities identity
  join public.event_rooms room on room.id = p_room_id
  where identity.user_id = room.host_id
     or exists (
       select 1 from public.event_attendees attendee
       where attendee.event_room_id = p_room_id
         and attendee.user_id = identity.user_id
         and attendee.status::text = 'accepted'
     )
     or exists (
       select 1 from public.room_analytics_events event
       where event.room_id = p_room_id
         and event.identity_id = identity.id
         and event.event_type = 'room_entry'
     );
$$;

create or replace function public.populate_push_event_recipients(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.push_notification_events;
  v_mission public.room_missions;
  v_game public.wild_games;
  v_identity_id uuid;
  v_user_id uuid;
  v_actor_id uuid;
  v_activity_id uuid;
  v_title text;
  v_body text;
  v_assignment_faction text;
  v_faction jsonb;
  v_source_key text;
begin
  select * into v_event from public.push_notification_events where id = p_event_id;
  if not found then return; end if;

  v_source_key := v_event.event_type || ':' || v_event.source_id::text;
  select host_id into v_actor_id from public.event_rooms where id = v_event.room_id;
  v_actor_id := coalesce(v_event.created_by_user_id, v_actor_id);

  if v_event.event_type = 'mission_started' then
    select * into v_mission from public.room_missions where id = v_event.source_id;
    if not found then return; end if;
    if v_mission.mission_type = 'wild_faction' then
      for v_identity_id in
        select assignment.participant_identity_id
        from public.wild_faction_assignments assignment
        where assignment.game_id = (v_mission.config->>'game_id')::uuid
          and (
            v_mission.config->>'faction_key' = 'all'
            or assignment.faction_key = v_mission.config->>'faction_key'
          )
      loop
        insert into public.push_notification_recipients(event_id, identity_id, title, body)
        values (v_event.id, v_identity_id, v_event.title, v_event.body)
        on conflict (event_id, identity_id) do nothing;
      end loop;
    else
      for v_identity_id in select * from public.room_push_participant_identities(v_event.room_id)
      loop
        insert into public.push_notification_recipients(event_id, identity_id, title, body)
        values (v_event.id, v_identity_id, v_event.title, v_event.body)
        on conflict (event_id, identity_id) do nothing;
      end loop;
    end if;
  elsif v_event.event_type = 'announcement' then
    for v_identity_id in select * from public.room_push_participant_identities(v_event.room_id)
    loop
      insert into public.push_notification_recipients(event_id, identity_id, title, body)
      values (v_event.id, v_identity_id, v_event.title, v_event.body)
      on conflict (event_id, identity_id) do nothing;
    end loop;
  elsif v_event.event_type = 'wild_result' then
    select * into v_game from public.wild_games where id = v_event.source_id;
    if not found or v_game.status <> 'ended' then return; end if;
    for v_identity_id, v_assignment_faction in
      select assignment.participant_identity_id, assignment.faction_key
      from public.wild_faction_assignments assignment
      where assignment.game_id = v_game.id
    loop
      select faction.value into v_faction
      from jsonb_array_elements(v_game.config->'factions') faction(value)
      where faction.value->>'key' = v_assignment_faction;
      if exists (
        select 1 from jsonb_array_elements(coalesce(v_game.winner_summary->'winners', '[]'::jsonb)) winner(value)
        where winner.value->>'faction_key' = v_assignment_faction
      ) then
        v_title := coalesce(v_faction->>'emoji', '') || ' ' || coalesce(v_faction->>'label', 'Your faction') || ' won the Wild';
      else
        v_title := 'The Wild has ended';
      end if;
      v_body := 'See how your faction finished.';
      insert into public.push_notification_recipients(event_id, identity_id, title, body)
      values (v_event.id, v_identity_id, btrim(v_title), v_body)
      on conflict (event_id, identity_id) do nothing;
    end loop;
  elsif v_event.event_type = 'recap_ready' and v_event.target_identity_id is not null then
    insert into public.push_notification_recipients(event_id, identity_id, title, body)
    values (v_event.id, v_event.target_identity_id, v_event.title, v_event.body)
    on conflict (event_id, identity_id) do nothing;
  end if;

  for v_identity_id in
    select recipient.identity_id
    from public.push_notification_recipients recipient
    where recipient.event_id = v_event.id
  loop
    select user_id into v_user_id from public.partyup_identities where id = v_identity_id;
    if v_user_id is null then continue; end if;
    select title, body into v_title, v_body
    from public.push_notification_recipients
    where event_id = v_event.id and identity_id = v_identity_id;

    if v_event.event_type = 'recap_ready' then
      insert into public.notifications (
        user_id, actor_id, type, title, body, room_id, recap_room_id,
        is_read, source_event_key, data
      ) values (
        v_user_id, v_actor_id, 'recap_ready', v_title, v_body,
        v_event.room_id, v_event.room_id, false, v_source_key, v_event.data
      )
      on conflict (user_id, recap_room_id) where recap_room_id is not null
      do update set
        type = excluded.type,
        title = excluded.title,
        body = excluded.body,
        source_event_key = excluded.source_event_key,
        data = excluded.data
      returning id into v_activity_id;
    else
      insert into public.notifications (
        user_id, actor_id, type, title, body, room_id,
        is_read, source_event_key, data
      ) values (
        v_user_id, v_actor_id, v_event.event_type, v_title, v_body,
        v_event.room_id, false, v_source_key, v_event.data
      )
      on conflict (user_id, source_event_key) where source_event_key is not null
      do update set title = excluded.title, body = excluded.body, data = excluded.data
      returning id into v_activity_id;
    end if;

    update public.push_notification_recipients
    set activity_notification_id = v_activity_id
    where event_id = v_event.id and identity_id = v_identity_id;
  end loop;
end;
$$;

create or replace function public.create_push_notification_event(
  p_event_type text,
  p_preference_category text,
  p_source_id uuid,
  p_room_id uuid,
  p_title text,
  p_body text,
  p_data jsonb,
  p_target_identity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.push_notification_events (
    event_type, preference_category, source_id, room_id, target_identity_id,
    title, body, data, created_by_user_id
  ) values (
    p_event_type, p_preference_category, p_source_id, p_room_id,
    p_target_identity_id, left(p_title, 120), left(p_body, 240),
    coalesce(p_data, '{}'::jsonb), auth.uid()
  )
  on conflict (event_type, source_id) do update set source_id = excluded.source_id
  returning id into v_event_id;

  perform public.populate_push_event_recipients(v_event_id);
  return v_event_id;
end;
$$;

create or replace function public.enqueue_mission_started_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_title text;
begin
  if new.status <> 'active' then return new; end if;
  select coalesce(nullif(title, ''), 'PartyUp event') into v_room_title
  from public.event_rooms where id = new.room_id and status::text <> 'ended';
  if not found then return new; end if;
  perform public.create_push_notification_event(
    'mission_started', 'missions', new.id, new.room_id,
    'New Mission at ' || v_room_title,
    coalesce(nullif(left(new.description, 180), ''), left(new.title, 180)),
    jsonb_build_object(
      'type', 'mission_started', 'roomId', new.room_id,
      'missionId', new.id, 'missionType', new.mission_type
    )
  );
  return new;
end;
$$;

drop trigger if exists room_missions_enqueue_push on public.room_missions;
create trigger room_missions_enqueue_push
after insert on public.room_missions
for each row execute function public.enqueue_mission_started_push();

alter table public.room_announcements
  add column if not exists notify_attendees boolean not null default false;

create or replace function public.publish_room_announcement_with_push(
  p_room_id uuid,
  p_title text,
  p_message text default null,
  p_cta_label text default null,
  p_cta_url text default null,
  p_expires_at timestamptz default null,
  p_notify_attendees boolean default false
)
returns public.room_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.room_announcements;
begin
  v_announcement := public.publish_room_announcement(
    p_room_id, p_title, p_message, p_cta_label, p_cta_url, p_expires_at
  );
  update public.room_announcements
  set notify_attendees = coalesce(p_notify_attendees, false)
  where id = v_announcement.id
  returning * into v_announcement;
  return v_announcement;
end;
$$;

create or replace function public.enqueue_announcement_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_title text;
begin
  if not new.is_active or not new.notify_attendees then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.notify_attendees, false) then return new; end if;
  select coalesce(nullif(title, ''), 'PartyUp event') into v_room_title
  from public.event_rooms where id = new.room_id and status::text <> 'ended';
  if not found then return new; end if;
  perform public.create_push_notification_event(
    'announcement', 'announcements', new.id, new.room_id,
    v_room_title,
    coalesce(nullif(left(new.message, 220), ''), left(new.title, 220)),
    jsonb_build_object(
      'type', 'announcement', 'roomId', new.room_id,
      'announcementId', new.id
    )
  );
  return new;
end;
$$;

drop trigger if exists room_announcements_enqueue_push on public.room_announcements;
create trigger room_announcements_enqueue_push
after insert or update on public.room_announcements
for each row execute function public.enqueue_announcement_push();

create or replace function public.enqueue_wild_result_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    perform public.create_push_notification_event(
      'wild_result', 'missions', new.id, new.room_id,
      'The Wild has ended', 'See the final results.',
      jsonb_build_object('type', 'wild_result', 'roomId', new.room_id, 'wildGameId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists wild_games_enqueue_result_push on public.wild_games;
create trigger wild_games_enqueue_result_push
after update of status on public.wild_games
for each row execute function public.enqueue_wild_result_push();

create or replace function public.enqueue_recap_ready_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_push_notification_event(
    'recap_ready', 'recaps', new.id, new.room_id,
    'Your night at ' || new.room_title || ' is ready',
    'See the Memories, people you kept, and what happened.',
    jsonb_build_object('type', 'recap_ready', 'roomId', new.room_id, 'recapId', new.id),
    new.identity_id
  );
  return new;
end;
$$;

drop trigger if exists event_recaps_enqueue_push on public.event_recaps;
create trigger event_recaps_enqueue_push
after insert on public.event_recaps
for each row execute function public.enqueue_recap_ready_push();

revoke all on function public.resolve_push_identity(text) from public, anon, authenticated;
revoke all on function public.register_push_device(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.disable_push_device(text, text) from public, anon, authenticated;
revoke all on function public.get_my_notification_preferences(text) from public, anon, authenticated;
revoke all on function public.set_my_notification_preferences(boolean, boolean, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.reassign_push_on_guest_claim() from public, anon, authenticated;
revoke all on function public.room_push_participant_identities(uuid) from public, anon, authenticated;
revoke all on function public.populate_push_event_recipients(uuid) from public, anon, authenticated;
revoke all on function public.create_push_notification_event(text, text, uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_mission_started_push() from public, anon, authenticated;
revoke all on function public.enqueue_announcement_push() from public, anon, authenticated;
revoke all on function public.enqueue_wild_result_push() from public, anon, authenticated;
revoke all on function public.enqueue_recap_ready_push() from public, anon, authenticated;

grant execute on function public.register_push_device(text, text, text, text, text) to anon, authenticated;
grant execute on function public.disable_push_device(text, text) to anon, authenticated;
grant execute on function public.get_my_notification_preferences(text) to anon, authenticated;
grant execute on function public.set_my_notification_preferences(boolean, boolean, boolean, boolean, text) to anon, authenticated;
revoke all on function public.publish_room_announcement_with_push(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.publish_room_announcement_with_push(uuid, text, text, text, text, timestamptz, boolean) to authenticated;

notify pgrst, 'reload schema';
