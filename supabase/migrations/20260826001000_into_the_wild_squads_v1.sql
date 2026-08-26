-- INTO THE WILD - SQUADS V1
-- A temporary cooperative layer over Wild factions and authoritative Mission evidence.

create table public.wild_squads (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.wild_games(id) on delete cascade,
  faction_key text not null check (char_length(faction_key) between 1 and 32),
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete restrict,
  status text not null default 'provisional' check (status in ('provisional', 'active', 'ended')),
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  ended_at timestamptz null,
  constraint wild_squads_activation_state check (
    (status = 'provisional' and activated_at is null and ended_at is null)
    or (status = 'active' and activated_at is not null and ended_at is null)
    or (status = 'ended' and ended_at is not null)
  )
);

create index wild_squads_game_faction_idx
  on public.wild_squads(game_id, faction_key, created_at);

create table public.wild_squad_members (
  squad_id uuid not null references public.wild_squads(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete restrict,
  joined_at timestamptz not null default now(),
  primary key (squad_id, participant_identity_id)
);

create index wild_squad_members_identity_idx
  on public.wild_squad_members(participant_identity_id, joined_at desc);

create table public.wild_squad_mission_completions (
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  squad_id uuid not null references public.wild_squads(id) on delete cascade,
  completed_by_identity_id uuid not null references public.partyup_identities(id) on delete restrict,
  completed_at timestamptz not null default now(),
  primary key (mission_id, squad_id)
);

create index wild_squad_mission_completions_squad_idx
  on public.wild_squad_mission_completions(squad_id, completed_at desc);

-- Formation deliberately reuses the existing hashed, expiring Mission token and
-- verified-pair tables. A row belongs to exactly one Mission or one Wild game.
alter table public.mission_encounter_tokens
  alter column mission_id drop not null,
  add column wild_game_id uuid null references public.wild_games(id) on delete cascade;
alter table public.mission_encounter_tokens
  add constraint mission_encounter_tokens_one_context check (
    (mission_id is not null) <> (wild_game_id is not null)
  );
create unique index mission_encounter_tokens_game_code_idx
  on public.mission_encounter_tokens(wild_game_id, short_code_hash)
  where wild_game_id is not null;
create index mission_encounter_tokens_game_owner_idx
  on public.mission_encounter_tokens(wild_game_id, participant_identity_id, expires_at desc)
  where wild_game_id is not null;

-- Preserve the existing Mission redeemer behind a context-checking wrapper.
-- The old implementation predates nullable mission_id and SQL NULL comparison
-- would otherwise let a squad token fall through as if it matched a Mission.
alter function public.redeem_mission_encounter_token(uuid, text, text)
  rename to redeem_mission_encounter_token_pre_squads;
revoke all on function public.redeem_mission_encounter_token_pre_squads(uuid, text, text)
  from public, anon, authenticated;

create or replace function public.redeem_mission_encounter_token(
  p_mission_id uuid,
  p_token_or_code text,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_value text := btrim(coalesce(p_token_or_code, ''));
  v_token_mission_id uuid;
  v_token_found boolean := false;
begin
  if v_value like 'partyup-mission:%' then v_value := substr(v_value, 17); end if;
  if v_value = '' then return jsonb_build_object('status', 'invalid'); end if;
  select token.mission_id, true
  into v_token_mission_id, v_token_found
  from public.mission_encounter_tokens token
  where token.token_hash = encode(extensions.digest(v_value, 'sha256'), 'hex')
     or token.short_code_hash = encode(extensions.digest(upper(v_value), 'sha256'), 'hex')
  order by token.created_at desc limit 1;
  if v_token_found and v_token_mission_id is null then
    return jsonb_build_object('status', 'wrong_mission');
  end if;
  return public.redeem_mission_encounter_token_pre_squads(
    p_mission_id, p_token_or_code, p_guest_token
  );
end;
$$;

alter table public.mission_encounters
  alter column mission_id drop not null,
  add column wild_game_id uuid null references public.wild_games(id) on delete cascade;
alter table public.mission_encounters
  add constraint mission_encounters_one_context check (
    (mission_id is not null) <> (wild_game_id is not null)
  );
create unique index mission_encounters_game_pair_idx
  on public.mission_encounters(wild_game_id, participant_low_identity_id, participant_high_identity_id)
  where wild_game_id is not null;

-- A reward is owned by either one participant (legacy behavior) or one squad.
alter table public.wild_contributions
  alter column participant_identity_id drop not null,
  add column squad_id uuid null references public.wild_squads(id) on delete cascade;
alter table public.wild_contributions
  drop constraint wild_contributions_once_per_mission;
alter table public.wild_contributions
  add constraint wild_contributions_one_recipient check (
    (participant_identity_id is not null) <> (squad_id is not null)
  );
create unique index wild_contributions_once_per_mission_identity_idx
  on public.wild_contributions(mission_id, participant_identity_id)
  where participant_identity_id is not null;
create unique index wild_contributions_once_per_mission_squad_idx
  on public.wild_contributions(mission_id, squad_id)
  where squad_id is not null;

create or replace function public.validate_wild_squad_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_squad public.wild_squads;
  v_assignment public.wild_faction_assignments;
  v_member_count integer;
begin
  select * into v_squad from public.wild_squads where id = new.squad_id for update;
  if not found then raise exception 'Squad not found'; end if;
  if v_squad.status = 'ended' then raise exception 'This squad is read-only'; end if;

  perform pg_advisory_xact_lock(hashtext(
    'partyup-wild-squad-member:' || v_squad.game_id::text || ':' || new.participant_identity_id::text
  ));

  select * into v_assignment
  from public.wild_faction_assignments
  where game_id = v_squad.game_id
    and participant_identity_id = new.participant_identity_id;
  if not found then raise exception 'Enter the Wild before joining a squad'; end if;
  if v_assignment.faction_key <> v_squad.faction_key then
    raise exception 'Squad members must share a faction';
  end if;
  if exists (
    select 1
    from public.wild_squad_members member
    join public.wild_squads other on other.id = member.squad_id
    where other.game_id = v_squad.game_id
      and member.participant_identity_id = new.participant_identity_id
      and member.squad_id <> new.squad_id
  ) then raise exception 'This player already belongs to another squad'; end if;

  select count(*)::integer into v_member_count
  from public.wild_squad_members where squad_id = new.squad_id;
  if v_member_count >= 5 then raise exception 'A squad can have at most 5 members'; end if;
  return new;
end;
$$;

create trigger wild_squad_members_validate
before insert on public.wild_squad_members
for each row execute function public.validate_wild_squad_member();

create or replace function public.get_wild_squad_id_for_identity(
  p_game_id uuid,
  p_identity_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select squad.id
  from public.wild_squad_members member
  join public.wild_squads squad on squad.id = member.squad_id
  where squad.game_id = p_game_id
    and member.participant_identity_id = p_identity_id
  order by squad.created_at
  limit 1;
$$;

create or replace function public.begin_wild_squad(
  p_game_id uuid,
  p_guest_token text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_squad_id uuid;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_game from public.wild_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Into the Wild has ended'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_identity_id) then
    raise exception 'You must be participating in this room';
  end if;
  select * into v_assignment from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = v_identity_id;
  if not found then raise exception 'Enter the Wild before forming a squad'; end if;

  perform pg_advisory_xact_lock(hashtext(
    'partyup-wild-squad-member:' || p_game_id::text || ':' || v_identity_id::text
  ));
  v_squad_id := public.get_wild_squad_id_for_identity(p_game_id, v_identity_id);
  if v_squad_id is not null then return v_squad_id; end if;

  insert into public.wild_squads(game_id, faction_key, created_by_identity_id)
  values (p_game_id, v_assignment.faction_key, v_identity_id)
  returning id into v_squad_id;
  insert into public.wild_squad_members(squad_id, participant_identity_id)
  values (v_squad_id, v_identity_id);
  return v_squad_id;
end;
$$;

create or replace function public.create_wild_squad_token(
  p_game_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_identity_id uuid;
  v_game public.wild_games;
  v_squad_id uuid;
  v_token text;
  v_code text;
  v_expires_at timestamptz := now() + interval '60 seconds';
  v_attempt integer := 0;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_game from public.wild_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Into the Wild has ended'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_identity_id) then
    raise exception 'You must be participating in this room';
  end if;
  if not exists (select 1 from public.wild_faction_assignments
    where game_id = p_game_id and participant_identity_id = v_identity_id) then
    raise exception 'Enter the Wild before creating a squad code';
  end if;
  v_squad_id := public.begin_wild_squad(p_game_id, p_guest_token);
  if (select count(*) from public.wild_squad_members where squad_id = v_squad_id) >= 5 then
    raise exception 'Your squad is full';
  end if;

  update public.mission_encounter_tokens set revoked_at = now()
  where wild_game_id = p_game_id
    and participant_identity_id = v_identity_id
    and revoked_at is null;
  loop
    v_attempt := v_attempt + 1;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_code := upper(encode(extensions.gen_random_bytes(4), 'hex'));
    begin
      insert into public.mission_encounter_tokens(
        mission_id, wild_game_id, participant_identity_id,
        token_hash, short_code_hash, expires_at
      ) values (
        null, p_game_id, v_identity_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        encode(extensions.digest(v_code, 'sha256'), 'hex'),
        v_expires_at
      );
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise exception 'Could not create a temporary squad code'; end if;
    end;
  end loop;
  return jsonb_build_object(
    'token', v_token,
    'qr_payload', 'partyup-mission:' || v_token,
    'short_code', v_code,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.enqueue_squad_formed_push(p_squad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_squad public.wild_squads;
  v_game public.wild_games;
  v_faction jsonb;
  v_event_id uuid;
  v_title text;
begin
  select * into v_squad from public.wild_squads where id = p_squad_id;
  if not found then return; end if;
  select * into v_game from public.wild_games where id = v_squad.game_id;
  select faction.value into v_faction
  from jsonb_array_elements(v_game.config->'factions') faction(value)
  where faction.value->>'key' = v_squad.faction_key;
  v_title := coalesce(v_faction->>'emoji', '') || ' ' || coalesce(v_faction->>'label', 'Your') || ' squad formed';

  insert into public.push_notification_events(
    event_type, preference_category, source_id, room_id, title, body, data
  ) values (
    'squad_formed', 'missions', v_squad.id, v_game.room_id,
    btrim(v_title), 'Your squad is ready.',
    jsonb_build_object('type', 'squad_formed', 'roomId', v_game.room_id,
      'wildGameId', v_game.id, 'squadId', v_squad.id)
  ) on conflict (event_type, source_id) do update set source_id = excluded.source_id
  returning id into v_event_id;

  insert into public.push_notification_recipients(event_id, identity_id, title, body)
  select v_event_id, member.participant_identity_id, btrim(v_title), 'Your squad is ready.'
  from public.wild_squad_members member where member.squad_id = v_squad.id
  on conflict (event_id, identity_id) do nothing;
end;
$$;

alter table public.push_notification_events
  drop constraint push_notification_events_event_type_check;
alter table public.push_notification_events
  add constraint push_notification_events_event_type_check check (event_type in (
    'mission_started', 'announcement', 'wild_result', 'recap_ready', 'squad_formed'
  ));

create or replace function public.redeem_wild_squad_token(
  p_game_id uuid,
  p_token_or_code text,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_scanner_id uuid;
  v_owner_id uuid;
  v_token_game_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_value text := btrim(coalesce(p_token_or_code, ''));
  v_game public.wild_games;
  v_scanner_faction text;
  v_owner_faction text;
  v_scanner_squad uuid;
  v_owner_squad uuid;
  v_squad_id uuid;
  v_low uuid;
  v_high uuid;
  v_member_count integer;
  v_was_activated boolean := false;
  v_scanner_squad_status text;
  v_owner_squad_status text;
  v_combined_count integer;
begin
  v_scanner_id := public.resolve_mission_participant_identity(p_guest_token);
  if v_value like 'partyup-mission:%' then v_value := substr(v_value, 17); end if;
  if v_value = '' then return jsonb_build_object('status', 'invalid'); end if;

  select token.wild_game_id, token.participant_identity_id, token.expires_at, token.revoked_at
  into v_token_game_id, v_owner_id, v_expires_at, v_revoked_at
  from public.mission_encounter_tokens token
  where token.token_hash = encode(extensions.digest(v_value, 'sha256'), 'hex')
     or token.short_code_hash = encode(extensions.digest(upper(v_value), 'sha256'), 'hex')
  order by (token.wild_game_id = p_game_id) desc, token.created_at desc limit 1;
  if v_owner_id is null then return jsonb_build_object('status', 'expired'); end if;
  if v_token_game_id is null or v_token_game_id <> p_game_id then
    return jsonb_build_object('status', 'wrong_game');
  end if;
  if v_revoked_at is not null or v_expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_scanner_id = v_owner_id then return jsonb_build_object('status', 'self_scan'); end if;

  select * into v_game from public.wild_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then return jsonb_build_object('status', 'game_ended'); end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then return jsonb_build_object('status', 'game_ended'); end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_scanner_id)
     or not public.can_identity_participate_in_mission_room(v_game.room_id, v_owner_id) then
    return jsonb_build_object('status', 'invalid');
  end if;

  select faction_key into v_scanner_faction from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = v_scanner_id;
  select faction_key into v_owner_faction from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = v_owner_id;
  if v_scanner_faction is null or v_owner_faction is null then
    return jsonb_build_object('status', 'wrong_game');
  end if;
  if v_scanner_faction <> v_owner_faction then
    return jsonb_build_object('status', 'wrong_faction');
  end if;

  v_low := least(v_scanner_id, v_owner_id);
  v_high := greatest(v_scanner_id, v_owner_id);
  perform pg_advisory_xact_lock(hashtext(
    'partyup-wild-squad-pair:' || p_game_id::text || ':' || v_low::text || ':' || v_high::text
  ));
  if exists (select 1 from public.mission_encounters
    where wild_game_id = p_game_id
      and participant_low_identity_id = v_low
      and participant_high_identity_id = v_high) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  v_scanner_squad := public.get_wild_squad_id_for_identity(p_game_id, v_scanner_id);
  v_owner_squad := public.get_wild_squad_id_for_identity(p_game_id, v_owner_id);
  if v_scanner_squad is not null and v_owner_squad is not null
     and v_scanner_squad <> v_owner_squad then
    perform 1 from public.wild_squads
    where id in (v_scanner_squad, v_owner_squad)
    order by id for update;
    select status into v_scanner_squad_status from public.wild_squads where id = v_scanner_squad;
    select status into v_owner_squad_status from public.wild_squads where id = v_owner_squad;
    if v_scanner_squad_status <> 'provisional' or v_owner_squad_status <> 'provisional' then
      return jsonb_build_object('status', 'already_in_squad');
    end if;
    select count(*)::integer into v_combined_count from public.wild_squad_members
    where squad_id in (v_scanner_squad, v_owner_squad);
    if v_combined_count > 5 then return jsonb_build_object('status', 'squad_full'); end if;
    -- Two unformed groups may safely converge when their members physically verify.
    update public.wild_squad_members set squad_id = v_scanner_squad
    where squad_id = v_owner_squad;
    delete from public.wild_squads where id = v_owner_squad;
    v_owner_squad := v_scanner_squad;
  end if;
  v_squad_id := coalesce(v_scanner_squad, v_owner_squad);
  if v_squad_id is null then v_squad_id := public.begin_wild_squad(p_game_id, p_guest_token); end if;
  perform 1 from public.wild_squads where id = v_squad_id and status <> 'ended' for update;
  select count(*)::integer into v_member_count from public.wild_squad_members where squad_id = v_squad_id;
  if v_member_count >= 5 and (v_scanner_squad is null or v_owner_squad is null) then
    return jsonb_build_object('status', 'squad_full');
  end if;

  insert into public.wild_squad_members(squad_id, participant_identity_id)
  values (v_squad_id, v_scanner_id), (v_squad_id, v_owner_id)
  on conflict do nothing;
  insert into public.mission_encounters(
    mission_id, wild_game_id, participant_low_identity_id,
    participant_high_identity_id, assignment_key
  ) values (null, p_game_id, v_low, v_high, 'squad_formation');

  select count(*)::integer into v_member_count from public.wild_squad_members where squad_id = v_squad_id;
  update public.wild_squads
  set status = 'active', activated_at = now()
  where id = v_squad_id and status = 'provisional' and v_member_count >= 3;
  get diagnostics v_member_count = row_count;
  v_was_activated := v_member_count > 0;
  select count(*)::integer into v_member_count from public.wild_squad_members where squad_id = v_squad_id;
  if v_was_activated then perform public.enqueue_squad_formed_push(v_squad_id); end if;

  return jsonb_build_object(
    'status', 'valid', 'squad_id', v_squad_id,
    'member_count', v_member_count, 'formed', v_member_count >= 3,
    'just_formed', v_was_activated, 'room_id', v_game.room_id
  );
exception when unique_violation then
  return jsonb_build_object('status', 'already_in_squad');
end;
$$;

create or replace function public.get_my_wild_squad_state(
  p_game_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_squad public.wild_squads;
  v_members jsonb := '[]'::jsonb;
  v_member_count integer := 0;
  v_faction jsonb;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_game from public.wild_games where id = p_game_id;
  if not found then raise exception 'Into the Wild game not found'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_identity_id)
     and not public.is_room_host(v_game.room_id) then raise exception 'You cannot view this squad'; end if;
  select * into v_assignment from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = v_identity_id;
  if v_assignment.id is null then return null; end if;
  select squad.* into v_squad
  from public.wild_squad_members member
  join public.wild_squads squad on squad.id = member.squad_id
  where squad.game_id = p_game_id and member.participant_identity_id = v_identity_id;
  if v_squad.id is null then return null; end if;

  select faction.value into v_faction from jsonb_array_elements(v_game.config->'factions') faction(value)
  where faction.value->>'key' = v_squad.faction_key;
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
    'identity_id', member.participant_identity_id,
    'display_name', coalesce(nullif(to_jsonb(profile)->>'display_name', ''), profile.username,
      'Guest ' || left(member.participant_identity_id::text, 4)),
    'avatar_url', profile.avatar_url,
    'joined_at', member.joined_at,
    'is_you', member.participant_identity_id = v_identity_id
  ) order by member.joined_at, member.participant_identity_id), '[]'::jsonb)
  into v_member_count, v_members
  from public.wild_squad_members member
  join public.partyup_identities identity on identity.id = member.participant_identity_id
  left join public.profiles profile on profile.id = identity.user_id
  where member.squad_id = v_squad.id;

  return jsonb_build_object(
    'id', v_squad.id, 'game_id', v_squad.game_id,
    'faction_key', v_squad.faction_key,
    'label', upper(coalesce(v_faction->>'label', v_squad.faction_key)) || ' SQUAD ' || upper(left(v_squad.id::text, 4)),
    'status', v_squad.status, 'member_count', v_member_count,
    'minimum_members', 3, 'maximum_members', 5,
    'formation_progress', greatest(0, least(2, v_member_count - 1)),
    'members_needed', greatest(0, 3 - v_member_count),
    'members', v_members,
    'can_add_members', v_game.status = 'active' and v_squad.status <> 'ended' and v_member_count < 5
  );
end;
$$;

create or replace function public.get_wild_squads_overview(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_game public.wild_games; v_result jsonb;
begin
  select * into v_game from public.wild_games where id = p_game_id;
  if not found or not public.is_room_host(v_game.room_id) then
    raise exception 'Only the room host can view squad state';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', squad.id, 'faction_key', squad.faction_key, 'status', squad.status,
    'member_count', (select count(*) from public.wild_squad_members member where member.squad_id = squad.id),
    'missions_completed', (select count(*) from public.wild_squad_mission_completions completion where completion.squad_id = squad.id)
  ) order by squad.created_at), '[]'::jsonb) into v_result
  from public.wild_squads squad where squad.game_id = p_game_id;
  return v_result;
end;
$$;

create or replace function public.publish_wild_squad_mission(
  p_game_id uuid,
  p_faction_key text,
  p_territory_key text,
  p_title text,
  p_description text default null,
  p_influence_reward integer default 10,
  p_duration_minutes integer default 20,
  p_verification_type text default 'encounter',
  p_required_progress integer default 3,
  p_encounter_relationship text default null,
  p_target_faction text default null,
  p_required_media_type text default 'any',
  p_live_node_id uuid default null
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.wild_games;
  v_identity_id uuid;
  v_mission public.room_missions;
  v_faction text := coalesce(lower(nullif(btrim(coalesce(p_faction_key, '')), '')), 'all');
  v_verification text := lower(btrim(coalesce(p_verification_type, '')));
  v_started_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_game from public.wild_games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'Active Into the Wild game not found'; end if;
  if not public.is_room_host(v_game.room_id) then raise exception 'Only the room host can launch Wild Missions'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or char_length(btrim(p_title)) > 120 then
    raise exception 'Mission title must be 1 to 120 characters';
  end if;
  if char_length(coalesce(p_description, '')) > 1000 then raise exception 'Mission description is too long'; end if;
  if p_influence_reward not between 1 and 100 then raise exception 'Influence reward must be between 1 and 100'; end if;
  if p_duration_minutes not between 1 and 1440 then raise exception 'Mission duration must be between 1 and 1440 minutes'; end if;
  if p_required_progress not between 1 and 20 then raise exception 'Required progress must be between 1 and 20'; end if;
  if v_verification not in ('encounter', 'match_faction', 'memory_upload', 'live_node') then
    raise exception 'Squad Missions require authoritative verification';
  end if;
  if not exists (select 1 from public.wild_territories
    where game_id = p_game_id and territory_key = p_territory_key) then
    raise exception 'Territory does not belong to this Wild game';
  end if;
  if v_faction <> 'all' and not exists (select 1 from jsonb_array_elements(v_game.config->'factions') faction(value)
    where faction.value->>'key' = v_faction) then raise exception 'Faction does not belong to this Wild game'; end if;
  if v_verification = 'encounter' and p_encounter_relationship not in ('same_faction', 'different_faction', 'specific_faction') then
    raise exception 'Encounter relationship is invalid';
  end if;
  if v_verification = 'memory_upload' and p_required_media_type not in ('any', 'image', 'video') then
    raise exception 'Required media type must be any, image, or video';
  end if;
  if v_verification = 'live_node' and not exists (select 1 from public.live_nodes
    where id = p_live_node_id and room_id = v_game.room_id and status = 'active'
      and (ends_at is null or ends_at > now())) then raise exception 'Choose an active Live Node in this room'; end if;
  if v_verification = 'live_node' and p_required_progress > (
    select node.max_claims - (select count(*) from public.live_node_claims claim where claim.node_id = node.id)
    from public.live_nodes node where node.id = p_live_node_id
  ) then raise exception 'Required progress exceeds the remaining Live Node claims'; end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || v_game.room_id::text));
  perform public.close_expired_room_missions(v_game.room_id);
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = v_game.room_id and status = 'active';

  insert into public.room_missions(
    room_id, created_by_identity_id, title, description, mission_type,
    config, status, starts_at, ends_at
  ) values (
    v_game.room_id, v_identity_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    'wild_faction', jsonb_strip_nulls(jsonb_build_object(
      'game_id', p_game_id, 'faction_key', v_faction,
      'territory_key', p_territory_key, 'influence_reward', p_influence_reward,
      'scope', 'squad', 'progress_mode', 'aggregate',
      'verification_type', v_verification, 'required_progress', p_required_progress,
      'required_encounters', case when v_verification = 'encounter' then p_required_progress else null end,
      'encounter_relationship', case when v_verification = 'encounter' then p_encounter_relationship else null end,
      'target_faction', case when p_encounter_relationship = 'specific_faction' then p_target_faction else null end,
      'required_matches', case when v_verification = 'match_faction' then p_required_progress else null end,
      'match_relationship', case when v_verification = 'match_faction' then 'opposing_faction' else null end,
      'required_memories', case when v_verification = 'memory_upload' then p_required_progress else null end,
      'required_media_type', case when v_verification = 'memory_upload' then p_required_media_type else null end,
      'node_id', case when v_verification = 'live_node' then p_live_node_id else null end
    )), 'active', v_started_at, v_started_at + make_interval(mins => p_duration_minutes)
  ) returning * into v_mission;
  if v_verification = 'live_node' then
    update public.live_nodes set mission_id = v_mission.id where id = p_live_node_id;
  end if;
  return v_mission;
end;
$$;

create or replace function public.get_wild_squad_mission_progress(p_mission_id uuid, p_squad_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_progress integer := 0;
begin
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.config->>'scope' <> 'squad' then return 0; end if;
  if v_mission.config->>'verification_type' = 'encounter' then
    select count(distinct encounter.id)::integer into v_progress
    from public.mission_encounters encounter
    where encounter.mission_id = p_mission_id and exists (
      select 1 from public.wild_squad_members member
      where member.squad_id = p_squad_id
        and member.participant_identity_id in (
          encounter.participant_low_identity_id, encounter.participant_high_identity_id
        )
    );
  elsif v_mission.config->>'verification_type' = 'match_faction' then
    select count(distinct verification.opponent_identity_id)::integer into v_progress
    from public.mission_match_verifications verification
    join public.wild_squad_members member
      on member.squad_id = p_squad_id
     and member.participant_identity_id = verification.participant_identity_id
    where verification.mission_id = p_mission_id;
  elsif v_mission.config->>'verification_type' = 'memory_upload' then
    select count(distinct verification.memory_id)::integer into v_progress
    from public.mission_memory_verifications verification
    join public.wild_squad_members member
      on member.squad_id = p_squad_id
     and member.participant_identity_id = verification.participant_identity_id
    where verification.mission_id = p_mission_id;
  elsif v_mission.config->>'verification_type' = 'live_node' then
    select count(distinct claim.id)::integer into v_progress
    from public.live_node_claims claim
    join public.wild_squad_members member
      on member.squad_id = p_squad_id and member.participant_identity_id = claim.identity_id
    where claim.node_id = (v_mission.config->>'node_id')::uuid
      and claim.claimed_at >= v_mission.starts_at
      and (v_mission.ends_at is null or claim.claimed_at <= v_mission.ends_at);
  end if;
  return coalesce(v_progress, 0);
end;
$$;

create or replace function public.get_wild_squad_member_progress(
  p_mission_id uuid, p_squad_id uuid, p_identity_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_mission public.room_missions; v_progress integer := 0;
begin
  if not exists (select 1 from public.wild_squad_members
    where squad_id = p_squad_id and participant_identity_id = p_identity_id) then return 0; end if;
  select * into v_mission from public.room_missions where id = p_mission_id;
  if v_mission.config->>'verification_type' = 'encounter' then
    select count(*)::integer into v_progress from public.mission_encounters
    where mission_id = p_mission_id
      and p_identity_id in (participant_low_identity_id, participant_high_identity_id);
  elsif v_mission.config->>'verification_type' = 'match_faction' then
    select count(distinct opponent_identity_id)::integer into v_progress
    from public.mission_match_verifications
    where mission_id = p_mission_id and participant_identity_id = p_identity_id;
  elsif v_mission.config->>'verification_type' = 'memory_upload' then
    select count(*)::integer into v_progress from public.mission_memory_verifications
    where mission_id = p_mission_id and participant_identity_id = p_identity_id;
  elsif v_mission.config->>'verification_type' = 'live_node' then
    select count(*)::integer into v_progress from public.live_node_claims
    where node_id = (v_mission.config->>'node_id')::uuid and identity_id = p_identity_id
      and claimed_at >= v_mission.starts_at
      and (v_mission.ends_at is null or claimed_at <= v_mission.ends_at);
  end if;
  return coalesce(v_progress, 0);
end;
$$;

create or replace function public.award_wild_squad_mission(
  p_mission_id uuid,
  p_squad_id uuid,
  p_contributor_identity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_game public.wild_games;
  v_squad public.wild_squads;
  v_territory public.wild_territories;
  v_required integer;
  v_progress integer;
  v_reward integer;
  v_current integer;
  v_max integer;
  v_top_count integer;
  v_controller text;
  v_inserted integer := 0;
begin
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type <> 'wild_faction'
     or v_mission.config->>'scope' <> 'squad' then raise exception 'Squad Mission not found'; end if;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now()) then
    raise exception 'This Mission is no longer active';
  end if;
  select * into v_game from public.wild_games
  where id = (v_mission.config->>'game_id')::uuid for update;
  if not found or v_game.status <> 'active' then raise exception 'Into the Wild has ended'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  select * into v_squad from public.wild_squads where id = p_squad_id for update;
  if not found or v_squad.game_id <> v_game.id or v_squad.status <> 'active' then
    raise exception 'An active squad is required';
  end if;
  if not exists (select 1 from public.wild_squad_members where squad_id = p_squad_id
    and participant_identity_id = p_contributor_identity_id) then raise exception 'Contributor is not in this squad'; end if;
  if v_mission.config->>'faction_key' <> 'all'
     and v_mission.config->>'faction_key' <> v_squad.faction_key then
    raise exception 'This Mission belongs to another faction';
  end if;
  v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_progress')::integer, 1)));
  v_progress := public.get_wild_squad_mission_progress(p_mission_id, p_squad_id);
  if v_progress < v_required then
    return jsonb_build_object('status', 'in_progress', 'progress', v_progress, 'required_progress', v_required);
  end if;

  insert into public.wild_squad_mission_completions(mission_id, squad_id, completed_by_identity_id)
  values (p_mission_id, p_squad_id, p_contributor_identity_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  v_reward := (v_mission.config->>'influence_reward')::integer;
  select * into v_territory from public.wild_territories
  where game_id = v_game.id and territory_key = v_mission.config->>'territory_key' for update;
  if not found or v_reward not between 1 and 100 then raise exception 'Squad Mission reward configuration is invalid'; end if;

  if v_inserted > 0 then
    insert into public.wild_contributions(
      game_id, participant_identity_id, squad_id, faction_key,
      territory_key, mission_id, influence_amount
    ) values (
      v_game.id, null, p_squad_id, v_squad.faction_key,
      v_territory.territory_key, p_mission_id, v_reward
    ) on conflict do nothing;
    v_current := coalesce((v_territory.influence->>v_squad.faction_key)::integer, 0);
    v_territory.influence := jsonb_set(v_territory.influence, array[v_squad.faction_key],
      to_jsonb(v_current + v_reward), true);
    select max(value::integer) into v_max from jsonb_each_text(v_territory.influence);
    select count(*)::integer into v_top_count from jsonb_each_text(v_territory.influence)
      where value::integer = v_max;
    if v_top_count = 1 then
      select key into v_controller from jsonb_each_text(v_territory.influence)
      where value::integer = v_max limit 1;
    else v_controller := null;
    end if;
    update public.wild_territories set influence = v_territory.influence,
      controlling_faction = v_controller where id = v_territory.id;
  end if;
  return jsonb_build_object(
    'status', case when v_inserted > 0 then 'awarded' else 'already_completed' end,
    'progress', v_progress, 'required_progress', v_required,
    'territory_key', v_territory.territory_key, 'influence_reward', v_reward
  );
end;
$$;

-- Existing encounter and Memory paths already converge on this boundary.
-- For squad scope it switches to the one-per-squad transaction above.
create or replace function public.award_wild_mission_for_identity(
  p_mission_id uuid,
  p_identity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_squad_id uuid;
  v_game_id uuid;
begin
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found then raise exception 'Wild Mission not found'; end if;
  if v_mission.config->>'scope' = 'squad' then
    v_game_id := (v_mission.config->>'game_id')::uuid;
    v_squad_id := public.get_wild_squad_id_for_identity(v_game_id, p_identity_id);
    if v_squad_id is null then raise exception 'Join a squad before contributing to this Mission'; end if;
    return public.award_wild_squad_mission(p_mission_id, v_squad_id, p_identity_id);
  end if;
  -- Preserve the original transaction through the public completion RPC by
  -- temporarily using a private session setting to avoid recursion.
  perform set_config('partyup.award_identity', p_identity_id::text, true);
  return public.award_wild_individual_mission(p_mission_id, p_identity_id);
end;
$$;

-- Snapshot of the pre-Squads award routine, kept separate so legacy individual
-- and faction Missions retain their existing behavior exactly.
create or replace function public.award_wild_individual_mission(
  p_mission_id uuid,
  p_identity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions; v_game public.wild_games;
  v_assignment public.wild_faction_assignments; v_territory public.wild_territories;
  v_contribution public.wild_contributions; v_required_faction text; v_reward integer;
  v_progress integer; v_required integer; v_current integer; v_max integer;
  v_top_count integer; v_controller text; v_impact_missions integer; v_impact_influence integer;
begin
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'wild_faction' then raise exception 'Wild Mission not found'; end if;
  perform 1 from public.event_rooms where id = v_mission.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  select * into v_game from public.wild_games where id = (v_mission.config->>'game_id')::uuid for update;
  if not found or v_game.status <> 'active' then raise exception 'Into the Wild has ended'; end if;
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now()) then
    raise exception 'This Mission is no longer active'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, p_identity_id) then
    raise exception 'You must be participating in this room'; end if;
  select * into v_assignment from public.wild_faction_assignments
  where game_id = v_game.id and participant_identity_id = p_identity_id;
  if not found then raise exception 'Enter the Wild before completing a Wild Mission'; end if;
  v_required_faction := v_mission.config->>'faction_key';
  if v_required_faction <> 'all' and v_assignment.faction_key <> v_required_faction then
    raise exception 'This Mission belongs to another faction'; end if;
  if v_mission.config->>'verification_type' = 'encounter' then
    v_required := greatest(1, least(3, coalesce((v_mission.config->>'required_encounters')::integer, 1)));
    v_progress := public.get_wild_verified_encounter_progress(p_mission_id, p_identity_id);
    if v_progress < v_required then raise exception 'Verified encounter required'; end if;
  end if;
  v_reward := (v_mission.config->>'influence_reward')::integer;
  select * into v_territory from public.wild_territories
  where game_id = v_game.id and territory_key = v_mission.config->>'territory_key' for update;
  if not found or v_reward not between 1 and 100 then raise exception 'Wild Mission reward configuration is invalid'; end if;
  insert into public.mission_completions(mission_id, participant_identity_id)
  values (p_mission_id, p_identity_id) on conflict do nothing;
  insert into public.wild_contributions(
    game_id, participant_identity_id, squad_id, faction_key, territory_key, mission_id, influence_amount
  ) values (
    v_game.id, p_identity_id, null, v_assignment.faction_key,
    v_territory.territory_key, p_mission_id, v_reward
  ) on conflict do nothing returning * into v_contribution;
  if v_contribution.id is not null then
    v_current := coalesce((v_territory.influence->>v_assignment.faction_key)::integer, 0);
    v_territory.influence := jsonb_set(v_territory.influence, array[v_assignment.faction_key],
      to_jsonb(v_current + v_reward), true);
    select max(value::integer) into v_max from jsonb_each_text(v_territory.influence);
    select count(*)::integer into v_top_count from jsonb_each_text(v_territory.influence) where value::integer = v_max;
    if v_top_count = 1 then select key into v_controller from jsonb_each_text(v_territory.influence)
      where value::integer = v_max limit 1; else v_controller := null; end if;
    update public.wild_territories set influence = v_territory.influence,
      controlling_faction = v_controller where id = v_territory.id returning * into v_territory;
  end if;
  select count(*)::integer, coalesce(sum(influence_amount), 0)::integer
  into v_impact_missions, v_impact_influence from public.wild_contributions
  where game_id = v_game.id and participant_identity_id = p_identity_id;
  return jsonb_build_object(
    'status', case when v_contribution.id is null then 'already_completed' else 'awarded' end,
    'territory_key', v_territory.territory_key, 'controlling_faction', v_territory.controlling_faction,
    'influence', v_territory.influence,
    'impact', jsonb_build_object('missions_completed', v_impact_missions, 'influence_added', v_impact_influence)
  );
end;
$$;

create or replace function public.get_my_wild_squad_mission_state(
  p_mission_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid; v_mission public.room_missions; v_game public.wild_games;
  v_squad public.wild_squads; v_progress integer := 0; v_personal integer := 0;
  v_required integer := 1; v_completed boolean := false;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.config->>'scope' <> 'squad' then raise exception 'Squad Mission not found'; end if;
  select * into v_game from public.wild_games where id = (v_mission.config->>'game_id')::uuid;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id)
     and not public.is_room_host(v_mission.room_id) then raise exception 'You cannot view this Mission'; end if;
  select squad.* into v_squad from public.wild_squad_members member
  join public.wild_squads squad on squad.id = member.squad_id
  where squad.game_id = v_game.id and member.participant_identity_id = v_identity_id;
  v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_progress')::integer, 1)));
  if v_squad.id is not null then
    v_progress := public.get_wild_squad_mission_progress(p_mission_id, v_squad.id);
    v_personal := public.get_wild_squad_member_progress(p_mission_id, v_squad.id, v_identity_id);
    select exists (select 1 from public.wild_squad_mission_completions
      where mission_id = p_mission_id and squad_id = v_squad.id) into v_completed;
  end if;
  return jsonb_build_object(
    'squad_id', v_squad.id, 'progress', v_progress, 'required_progress', v_required,
    'personal_progress', v_personal, 'completed', v_completed,
    'eligible', v_squad.id is not null and v_squad.status = 'active' and (
      v_mission.config->>'faction_key' = 'all' or v_mission.config->>'faction_key' = v_squad.faction_key),
    'verification_type', v_mission.config->>'verification_type',
    'mission_active', v_mission.status = 'active' and v_game.status = 'active'
      and v_mission.starts_at <= now() and (v_mission.ends_at is null or v_mission.ends_at > now())
  );
end;
$$;

create or replace function public.apply_encounter_squad_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_game_id uuid;
  v_identity_id uuid;
  v_squad_id uuid;
begin
  if new.mission_id is null then return new; end if;
  select * into v_mission from public.room_missions where id = new.mission_id;
  if v_mission.config->>'scope' <> 'squad'
     or v_mission.config->>'verification_type' <> 'encounter' then return new; end if;
  v_game_id := (v_mission.config->>'game_id')::uuid;
  foreach v_identity_id in array array[
    new.participant_low_identity_id, new.participant_high_identity_id
  ] loop
    select squad.id into v_squad_id
    from public.wild_squad_members member
    join public.wild_squads squad on squad.id = member.squad_id
    where squad.game_id = v_game_id and squad.status = 'active'
      and (v_mission.config->>'faction_key' = 'all'
        or v_mission.config->>'faction_key' = squad.faction_key)
      and member.participant_identity_id = v_identity_id;
    if v_squad_id is not null then
      perform public.award_wild_squad_mission(new.mission_id, v_squad_id, v_identity_id);
    end if;
  end loop;
  return new;
end;
$$;
create trigger mission_encounters_apply_squad_progress
after insert on public.mission_encounters
for each row execute function public.apply_encounter_squad_progress();

-- Match insertion is authoritative. For squad scope, evaluate aggregate progress
-- after every newly recorded participant-side verification.
create or replace function public.record_wild_match_mission_for_identity(
  p_match_session_id uuid, p_room_id uuid, p_game_id uuid,
  p_participant_identity_id uuid, p_opponent_identity_id uuid,
  p_verified_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_assignment public.wild_faction_assignments;
  v_opponent_assignment public.wild_faction_assignments;
  v_mission public.room_missions; v_verification_id uuid;
  v_required integer; v_progress integer; v_squad_id uuid;
begin
  if p_participant_identity_id = p_opponent_identity_id then return; end if;
  if not public.can_identity_participate_in_mission_room(p_room_id, p_participant_identity_id)
     or not public.can_identity_participate_in_mission_room(p_room_id, p_opponent_identity_id) then return; end if;
  select * into v_participant_assignment from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = p_participant_identity_id and created_at <= p_verified_at;
  select * into v_opponent_assignment from public.wild_faction_assignments
  where game_id = p_game_id and participant_identity_id = p_opponent_identity_id and created_at <= p_verified_at;
  if v_participant_assignment.id is null or v_opponent_assignment.id is null
     or v_participant_assignment.faction_key = v_opponent_assignment.faction_key then return; end if;
  for v_mission in select mission.* from public.room_missions mission
    where mission.room_id = p_room_id and mission.mission_type = 'wild_faction'
      and mission.status = 'active' and mission.config->>'game_id' = p_game_id::text
      and mission.config->>'verification_type' = 'match_faction'
      and mission.config->>'match_relationship' = 'opposing_faction'
      and mission.starts_at <= p_verified_at and (mission.ends_at is null or mission.ends_at > p_verified_at)
      and (mission.config->>'faction_key' = 'all'
        or mission.config->>'faction_key' = v_participant_assignment.faction_key)
  loop
    v_verification_id := null;
    insert into public.mission_match_verifications(
      mission_id, participant_identity_id, opponent_identity_id, match_session_id,
      participant_faction_key, opponent_faction_key, verified_at
    ) values (
      v_mission.id, p_participant_identity_id, p_opponent_identity_id, p_match_session_id,
      v_participant_assignment.faction_key, v_opponent_assignment.faction_key, p_verified_at
    ) on conflict do nothing returning id into v_verification_id;
    if v_verification_id is not null then
      if v_mission.config->>'scope' = 'squad' then
        select squad.id into v_squad_id
        from public.wild_squad_members member
        join public.wild_squads squad on squad.id = member.squad_id
        where squad.game_id = p_game_id and squad.status = 'active'
          and member.participant_identity_id = p_participant_identity_id;
        if v_squad_id is not null then perform public.award_wild_squad_mission(
          v_mission.id, v_squad_id, p_participant_identity_id); end if;
      else
        v_required := greatest(1, least(20, coalesce((v_mission.config->>'required_matches')::integer, 1)));
        v_progress := public.get_wild_verified_match_progress(v_mission.id, p_participant_identity_id);
        if v_progress >= v_required then perform public.award_wild_mission_for_identity(
          v_mission.id, p_participant_identity_id); end if;
      end if;
    end if;
  end loop;
end;
$$;

-- A Live Node claim contributes through the same squad award boundary.
create or replace function public.apply_live_node_squad_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_node public.live_nodes; v_mission public.room_missions; v_game_id uuid; v_squad_id uuid;
begin
  select * into v_node from public.live_nodes where id = new.node_id;
  if v_node.mission_id is null then return new; end if;
  select * into v_mission from public.room_missions where id = v_node.mission_id;
  if v_mission.config->>'scope' = 'squad' and v_mission.status = 'active' then
    v_game_id := (v_mission.config->>'game_id')::uuid;
    select squad.id into v_squad_id
    from public.wild_squad_members member
    join public.wild_squads squad on squad.id = member.squad_id
    where squad.game_id = v_game_id and squad.status = 'active'
      and (v_mission.config->>'faction_key' = 'all'
        or v_mission.config->>'faction_key' = squad.faction_key)
      and member.participant_identity_id = new.identity_id;
    if v_squad_id is not null then perform public.award_wild_squad_mission(
      v_mission.id, v_squad_id, new.identity_id); end if;
  end if;
  return new;
end;
$$;
create trigger live_node_claims_apply_squad_progress
after insert on public.live_node_claims
for each row execute function public.apply_live_node_squad_progress();

create or replace function public.end_squads_with_wild()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    update public.wild_squads set status = 'ended', ended_at = coalesce(new.ended_at, now())
    where game_id = new.id and status <> 'ended';
  end if;
  return new;
end;
$$;
create trigger wild_games_end_squads
after update of status on public.wild_games
for each row execute function public.end_squads_with_wild();

alter table public.wild_squads enable row level security;
alter table public.wild_squad_members enable row level security;
alter table public.wild_squad_mission_completions enable row level security;
revoke all on public.wild_squads from anon, authenticated;
revoke all on public.wild_squad_members from anon, authenticated;
revoke all on public.wild_squad_mission_completions from anon, authenticated;
grant select on public.wild_squads, public.wild_squad_members,
  public.wild_squad_mission_completions to authenticated;

create or replace function public.can_view_wild_squad(p_squad_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wild_squad_members member
    where member.squad_id = p_squad_id
      and member.participant_identity_id = public.current_partyup_identity_id()
  ) or exists (
    select 1 from public.wild_squads squad
    join public.wild_games game on game.id = squad.game_id
    where squad.id = p_squad_id and public.is_room_host(game.room_id)
  );
$$;

create policy wild_squads_select_member_or_host on public.wild_squads
for select to authenticated using (public.can_view_wild_squad(id));
create policy wild_squad_members_select_squad_or_host on public.wild_squad_members
for select to authenticated using (public.can_view_wild_squad(squad_id));
create policy wild_squad_completions_select_member_or_host on public.wild_squad_mission_completions
for select to authenticated using (public.can_view_wild_squad(squad_id));

revoke all on function public.validate_wild_squad_member() from public, anon, authenticated;
revoke all on function public.redeem_mission_encounter_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_wild_squad_id_for_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_squad_formed_push(uuid) from public, anon, authenticated;
revoke all on function public.get_wild_squad_mission_progress(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_wild_squad_member_progress(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.award_wild_squad_mission(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.award_wild_individual_mission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_live_node_squad_progress() from public, anon, authenticated;
revoke all on function public.apply_encounter_squad_progress() from public, anon, authenticated;
revoke all on function public.end_squads_with_wild() from public, anon, authenticated;
revoke all on function public.can_view_wild_squad(uuid) from public, anon, authenticated;
revoke all on function public.begin_wild_squad(uuid, text) from public, anon, authenticated;
revoke all on function public.create_wild_squad_token(uuid, text) from public, anon, authenticated;
revoke all on function public.redeem_wild_squad_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_my_wild_squad_state(uuid, text) from public, anon, authenticated;
revoke all on function public.get_wild_squads_overview(uuid) from public, anon, authenticated;
revoke all on function public.publish_wild_squad_mission(uuid, text, text, text, text, integer, integer, text, integer, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.get_my_wild_squad_mission_state(uuid, text) from public, anon, authenticated;

grant execute on function public.begin_wild_squad(uuid, text) to anon, authenticated;
grant execute on function public.redeem_mission_encounter_token(uuid, text, text) to anon, authenticated;
grant execute on function public.create_wild_squad_token(uuid, text) to anon, authenticated;
grant execute on function public.redeem_wild_squad_token(uuid, text, text) to anon, authenticated;
grant execute on function public.get_my_wild_squad_state(uuid, text) to anon, authenticated;
grant execute on function public.get_wild_squads_overview(uuid) to authenticated;
grant execute on function public.publish_wild_squad_mission(uuid, text, text, text, text, integer, integer, text, integer, text, text, text, uuid) to authenticated;
grant execute on function public.get_my_wild_squad_mission_state(uuid, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'wild_squads') then
      alter publication supabase_realtime add table public.wild_squads;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'wild_squad_members') then
      alter publication supabase_realtime add table public.wild_squad_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'wild_squad_mission_completions') then
      alter publication supabase_realtime add table public.wild_squad_mission_completions;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
