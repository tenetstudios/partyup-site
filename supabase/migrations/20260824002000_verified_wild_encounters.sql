-- Generalize PartyUp's existing Mission encounter primitive for verified
-- Into the Wild faction Missions. Existing Animal Pack behavior is preserved.

drop function if exists public.publish_wild_faction_mission(uuid, text, text, text, text, integer, integer);

create function public.publish_wild_faction_mission(
  p_game_id uuid,
  p_faction_key text,
  p_territory_key text,
  p_title text,
  p_description text default null,
  p_influence_reward integer default 10,
  p_duration_minutes integer default 10,
  p_verification_type text default 'none',
  p_encounter_relationship text default null,
  p_required_encounters integer default 1,
  p_target_faction text default null
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_game public.wild_games;
  v_mission public.room_missions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_required_faction text := coalesce(lower(nullif(btrim(coalesce(p_faction_key, '')), '')), 'all');
  v_verification_type text := coalesce(lower(nullif(btrim(coalesce(p_verification_type, '')), '')), 'none');
  v_relationship text := lower(nullif(btrim(coalesce(p_encounter_relationship, '')), ''));
  v_target_faction text := lower(nullif(btrim(coalesce(p_target_faction, '')), ''));
  v_starts_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_game from public.wild_games where id = p_game_id and status = 'active';
  if not found then raise exception 'Active Into the Wild game not found'; end if;
  if not public.is_room_host(v_game.room_id) then raise exception 'Only the room host can launch Wild Missions'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;
  select * into v_game from public.wild_games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'Into the Wild has ended'; end if;

  if v_title is null or char_length(v_title) > 120 then raise exception 'Mission title must be 1 to 120 characters'; end if;
  if v_description is not null and char_length(v_description) > 1000 then raise exception 'Mission description is too long'; end if;
  if p_influence_reward is null or p_influence_reward < 1 or p_influence_reward > 100 then
    raise exception 'Influence reward must be between 1 and 100';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Mission duration must be between 1 and 1440 minutes';
  end if;
  if not exists (select 1 from public.wild_territories where game_id = p_game_id and territory_key = p_territory_key) then
    raise exception 'Territory does not belong to this Wild game';
  end if;
  if v_required_faction <> 'all' and not exists (
    select 1 from jsonb_array_elements(v_game.config->'factions') faction(value)
    where faction.value->>'key' = v_required_faction
  ) then raise exception 'Faction does not belong to this Wild game'; end if;

  if v_verification_type not in ('none', 'encounter') then
    raise exception 'Verification type must be none or encounter';
  end if;
  if v_verification_type = 'encounter' then
    if v_relationship not in ('same_faction', 'different_faction', 'specific_faction') then
      raise exception 'Encounter relationship is invalid';
    end if;
    if p_required_encounters is null or p_required_encounters < 1 or p_required_encounters > 3 then
      raise exception 'Required encounters must be between 1 and 3';
    end if;
    if v_relationship = 'specific_faction' and not exists (
      select 1 from jsonb_array_elements(v_game.config->'factions') faction(value)
      where faction.value->>'key' = v_target_faction
    ) then raise exception 'Target faction does not belong to this Wild game'; end if;
  else
    v_relationship := null;
    v_target_faction := null;
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || v_game.room_id::text));
  perform public.close_expired_room_missions(v_game.room_id);
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = v_game.room_id and status = 'active';

  insert into public.room_missions (
    room_id, created_by_identity_id, title, description, mission_type, config,
    status, starts_at, ends_at
  ) values (
    v_game.room_id, v_identity_id, v_title, v_description, 'wild_faction',
    jsonb_build_object(
      'game_id', p_game_id,
      'faction_key', v_required_faction,
      'territory_key', p_territory_key,
      'influence_reward', p_influence_reward,
      'verification_type', v_verification_type,
      'encounter_relationship', v_relationship,
      'required_encounters', case when v_verification_type = 'encounter' then p_required_encounters else 0 end,
      'target_faction', v_target_faction
    ),
    'active', v_starts_at, v_starts_at + make_interval(mins => p_duration_minutes)
  ) returning * into v_mission;
  return v_mission;
end;
$$;

create or replace function public.get_wild_verified_encounter_progress(
  p_mission_id uuid,
  p_identity_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_game_id uuid;
  v_relationship text;
  v_target_faction text;
  v_progress integer := 0;
begin
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'wild_faction'
     or v_mission.config->>'verification_type' <> 'encounter' then return 0; end if;
  v_game_id := (v_mission.config->>'game_id')::uuid;
  v_relationship := v_mission.config->>'encounter_relationship';
  v_target_faction := v_mission.config->>'target_faction';

  select count(distinct case
    when encounter.participant_low_identity_id = p_identity_id then encounter.participant_high_identity_id
    else encounter.participant_low_identity_id
  end)::integer
  into v_progress
  from public.mission_encounters encounter
  join public.wild_faction_assignments self_assignment
    on self_assignment.game_id = v_game_id and self_assignment.participant_identity_id = p_identity_id
  join public.wild_faction_assignments partner_assignment
    on partner_assignment.game_id = v_game_id
   and partner_assignment.participant_identity_id = case
     when encounter.participant_low_identity_id = p_identity_id then encounter.participant_high_identity_id
     else encounter.participant_low_identity_id
   end
  where encounter.mission_id = p_mission_id
    and p_identity_id in (encounter.participant_low_identity_id, encounter.participant_high_identity_id)
    and (
      (v_relationship = 'same_faction' and partner_assignment.faction_key = self_assignment.faction_key)
      or (v_relationship = 'different_faction' and partner_assignment.faction_key <> self_assignment.faction_key)
      or (v_relationship = 'specific_faction' and partner_assignment.faction_key = v_target_faction)
    );
  return coalesce(v_progress, 0);
end;
$$;

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
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_territory public.wild_territories;
  v_contribution public.wild_contributions;
  v_required_faction text;
  v_territory_key text;
  v_reward integer;
  v_required_encounters integer;
  v_progress integer;
  v_current integer;
  v_max integer;
  v_top_count integer;
  v_controller text;
  v_impact_missions integer;
  v_impact_influence integer;
begin
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'wild_faction' then raise exception 'Wild Mission not found'; end if;
  perform 1 from public.event_rooms where id = v_mission.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;

  select * into v_game from public.wild_games
  where id = (v_mission.config->>'game_id')::uuid for update;
  if not found or v_game.status <> 'active' then raise exception 'Into the Wild has ended'; end if;
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if v_mission.status <> 'active' or v_mission.starts_at > now() then raise exception 'This Mission is no longer active'; end if;
  if v_mission.ends_at is not null and v_mission.ends_at <= now() then
    update public.room_missions set status = 'ended', ended_at = ends_at, ended_reason = 'expired'
    where id = v_mission.id;
    raise exception 'This Mission has expired';
  end if;
  if v_game.room_id <> v_mission.room_id then raise exception 'Wild Mission game does not match its room'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, p_identity_id) then
    raise exception 'You must be participating in this room to complete its Mission';
  end if;

  select * into v_assignment from public.wild_faction_assignments
  where game_id = v_game.id and participant_identity_id = p_identity_id;
  if not found then raise exception 'Enter the Wild before completing a Wild Mission'; end if;
  v_required_faction := v_mission.config->>'faction_key';
  v_territory_key := v_mission.config->>'territory_key';
  v_reward := (v_mission.config->>'influence_reward')::integer;
  if v_required_faction <> 'all' and v_assignment.faction_key <> v_required_faction then
    raise exception 'This Mission belongs to another faction';
  end if;
  if v_reward < 1 or v_reward > 100 then raise exception 'Wild Mission reward configuration is invalid'; end if;

  if v_mission.config->>'verification_type' = 'encounter' then
    v_required_encounters := greatest(1, least(3, coalesce((v_mission.config->>'required_encounters')::integer, 1)));
    v_progress := public.get_wild_verified_encounter_progress(v_mission.id, p_identity_id);
    if v_progress < v_required_encounters then
      raise exception 'Verified encounter required (% of % complete)', v_progress, v_required_encounters;
    end if;
  end if;

  select * into v_territory from public.wild_territories
  where game_id = v_game.id and territory_key = v_territory_key for update;
  if not found then raise exception 'Wild Mission territory is invalid'; end if;

  insert into public.mission_completions (mission_id, participant_identity_id)
  values (v_mission.id, p_identity_id)
  on conflict (mission_id, participant_identity_id) do nothing;
  insert into public.wild_contributions (
    game_id, participant_identity_id, faction_key, territory_key, mission_id, influence_amount
  ) values (
    v_game.id, p_identity_id, v_assignment.faction_key, v_territory_key, v_mission.id, v_reward
  ) on conflict (mission_id, participant_identity_id) do nothing
  returning * into v_contribution;

  if v_contribution.id is not null then
    v_current := coalesce((v_territory.influence->>v_assignment.faction_key)::integer, 0);
    v_territory.influence := jsonb_set(v_territory.influence, array[v_assignment.faction_key], to_jsonb(v_current + v_reward), true);
    select max(value::integer) into v_max from jsonb_each_text(v_territory.influence);
    select count(*)::integer into v_top_count from jsonb_each_text(v_territory.influence) where value::integer = v_max;
    if v_top_count = 1 then
      select key into v_controller from jsonb_each_text(v_territory.influence) where value::integer = v_max limit 1;
    else v_controller := null;
    end if;
    update public.wild_territories set influence = v_territory.influence, controlling_faction = v_controller
    where id = v_territory.id returning * into v_territory;
  end if;

  select count(*)::integer, coalesce(sum(influence_amount), 0)::integer
  into v_impact_missions, v_impact_influence from public.wild_contributions
  where game_id = v_game.id and participant_identity_id = p_identity_id;
  return jsonb_build_object(
    'status', case when v_contribution.id is null then 'already_completed' else 'awarded' end,
    'territory_key', v_territory.territory_key,
    'controlling_faction', v_territory.controlling_faction,
    'influence', v_territory.influence,
    'impact', jsonb_build_object('missions_completed', v_impact_missions, 'influence_added', v_impact_influence)
  );
end;
$$;

create or replace function public.complete_wild_faction_mission(
  p_mission_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  return public.award_wild_mission_for_identity(p_mission_id, v_identity_id);
end;
$$;

create or replace function public.get_my_wild_encounter_state(
  p_mission_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_progress integer := 0;
  v_required integer := 1;
  v_completed boolean := false;
  v_aggregate integer := 0;
  v_completion_count integer := 0;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type <> 'wild_faction'
     or v_mission.config->>'verification_type' <> 'encounter' then
    raise exception 'Verified Wild Mission not found';
  end if;
  select * into v_game from public.wild_games where id = (v_mission.config->>'game_id')::uuid;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id)
     and not public.is_room_host(v_mission.room_id) then raise exception 'You cannot view this encounter state'; end if;
  select * into v_assignment from public.wild_faction_assignments
  where game_id = v_game.id and participant_identity_id = v_identity_id;
  v_required := greatest(1, least(3, coalesce((v_mission.config->>'required_encounters')::integer, 1)));
  if v_assignment.id is not null then
    v_progress := public.get_wild_verified_encounter_progress(p_mission_id, v_identity_id);
  end if;
  select exists (select 1 from public.mission_completions
    where mission_id = p_mission_id and participant_identity_id = v_identity_id) into v_completed;
  if public.is_room_host(v_mission.room_id) then
    select count(*)::integer into v_aggregate from public.mission_encounters where mission_id = p_mission_id;
    select count(*)::integer into v_completion_count from public.mission_completions where mission_id = p_mission_id;
  end if;
  return jsonb_build_object(
    'progress', v_progress,
    'required_encounters', v_required,
    'completed', v_completed,
    'eligible', v_assignment.id is not null and (
      v_mission.config->>'faction_key' = 'all' or v_mission.config->>'faction_key' = v_assignment.faction_key
    ),
    'verification_type', 'encounter',
    'encounter_relationship', v_mission.config->>'encounter_relationship',
    'target_faction', v_mission.config->>'target_faction',
    'verified_encounter_count', v_aggregate,
    'mission_completion_count', v_completion_count,
    'mission_active', v_mission.status = 'active' and v_game.status = 'active'
      and v_mission.starts_at <= now() and (v_mission.ends_at is null or v_mission.ends_at > now())
  );
end;
$$;

create or replace function public.create_mission_encounter_token(
  p_mission_id uuid,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_game_id uuid;
  v_token text;
  v_code text;
  v_expires_at timestamptz := now() + interval '60 seconds';
  v_attempt integer := 0;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if not found or v_mission.mission_type not in ('animal_pack', 'wild_faction') then raise exception 'Verified Mission not found'; end if;
  if v_mission.mission_type = 'wild_faction' and v_mission.config->>'verification_type' <> 'encounter' then
    raise exception 'This Wild Mission does not require an encounter';
  end if;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now())
     or exists (select 1 from public.event_rooms where id = v_mission.room_id and status::text = 'ended') then
    raise exception 'This Mission is no longer active';
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_identity_id) then
    raise exception 'You must be participating in this room';
  end if;
  if v_mission.mission_type = 'animal_pack' and not exists (
    select 1 from public.mission_participant_assignments
    where mission_id = p_mission_id and participant_identity_id = v_identity_id
  ) then raise exception 'Join this Mission before creating a code'; end if;
  if v_mission.mission_type = 'wild_faction' then
    v_game_id := (v_mission.config->>'game_id')::uuid;
    if not exists (select 1 from public.wild_games where id = v_game_id and status = 'active') then
      raise exception 'Into the Wild has ended';
    end if;
    if not exists (select 1 from public.wild_faction_assignments
      where game_id = v_game_id and participant_identity_id = v_identity_id) then
      raise exception 'Enter the Wild before creating a code';
    end if;
  end if;

  update public.mission_encounter_tokens set revoked_at = now()
  where mission_id = p_mission_id and participant_identity_id = v_identity_id and revoked_at is null;
  loop
    v_attempt := v_attempt + 1;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_code := upper(encode(extensions.gen_random_bytes(4), 'hex'));
    begin
      insert into public.mission_encounter_tokens (
        mission_id, participant_identity_id, token_hash, short_code_hash, expires_at
      ) values (
        p_mission_id, v_identity_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        encode(extensions.digest(v_code, 'sha256'), 'hex'),
        v_expires_at
      );
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise exception 'Could not create a temporary Mission code'; end if;
    end;
  end loop;
  return jsonb_build_object('token', v_token, 'qr_payload', 'partyup-mission:' || v_token, 'short_code', v_code, 'expires_at', v_expires_at);
end;
$$;

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
  v_scanner_id uuid;
  v_owner_id uuid;
  v_token_mission_id uuid;
  v_token_expires_at timestamptz;
  v_token_revoked_at timestamptz;
  v_value text := btrim(coalesce(p_token_or_code, ''));
  v_mission public.room_missions;
  v_token_mission public.room_missions;
  v_game public.wild_games;
  v_scanner_assignment text;
  v_owner_assignment text;
  v_low uuid;
  v_high uuid;
  v_target integer;
  v_scanner_progress integer;
  v_owner_progress integer;
  v_inserted_rows integer := 0;
  v_relationship text;
  v_required_faction text;
  v_target_faction text;
  v_scanner_eligible boolean;
  v_owner_eligible boolean;
  v_scanner_completed boolean := false;
  v_owner_completed boolean := false;
begin
  v_scanner_id := public.resolve_mission_participant_identity(p_guest_token);
  if v_value like 'partyup-mission:%' then v_value := substr(v_value, 17); end if;
  if v_value = '' then return jsonb_build_object('status', 'invalid'); end if;

  select token.mission_id, token.participant_identity_id, token.expires_at, token.revoked_at
  into v_token_mission_id, v_owner_id, v_token_expires_at, v_token_revoked_at
  from public.mission_encounter_tokens token
  where token.token_hash = encode(extensions.digest(v_value, 'sha256'), 'hex')
     or token.short_code_hash = encode(extensions.digest(upper(v_value), 'sha256'), 'hex')
  order by (token.mission_id = p_mission_id) desc, token.created_at desc limit 1;
  if v_owner_id is null then return jsonb_build_object('status', 'expired'); end if;
  if v_token_mission_id <> p_mission_id then
    select * into v_mission from public.room_missions where id = p_mission_id;
    select * into v_token_mission from public.room_missions where id = v_token_mission_id;
    if v_mission.mission_type = 'wild_faction' and v_token_mission.mission_type = 'wild_faction' then
      if v_mission.room_id <> v_token_mission.room_id then return jsonb_build_object('status', 'wrong_room'); end if;
      if v_mission.config->>'game_id' <> v_token_mission.config->>'game_id' then return jsonb_build_object('status', 'wrong_game'); end if;
    end if;
    return jsonb_build_object('status', 'wrong_mission');
  end if;
  if v_token_revoked_at is not null or v_token_expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;

  select * into v_mission from public.room_missions where id = p_mission_id;
  if not found or v_mission.mission_type not in ('animal_pack', 'wild_faction') then return jsonb_build_object('status', 'wrong_mission'); end if;
  perform 1 from public.event_rooms where id = v_mission.room_id and status::text <> 'ended' for share;
  if not found then return jsonb_build_object('status', 'mission_ended'); end if;
  if v_mission.mission_type = 'wild_faction' then
    if v_mission.config->>'verification_type' <> 'encounter' then return jsonb_build_object('status', 'wrong_mission'); end if;
    select * into v_game from public.wild_games where id = (v_mission.config->>'game_id')::uuid for update;
    if not found or v_game.status <> 'active' then return jsonb_build_object('status', 'game_ended'); end if;
  end if;
  select * into v_mission from public.room_missions where id = p_mission_id for update;
  if v_mission.status <> 'active' or v_mission.starts_at > now()
     or (v_mission.ends_at is not null and v_mission.ends_at <= now()) then
    return jsonb_build_object('status', 'mission_ended');
  end if;
  if not public.can_identity_participate_in_mission_room(v_mission.room_id, v_scanner_id)
     or not public.can_identity_participate_in_mission_room(v_mission.room_id, v_owner_id) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_scanner_id = v_owner_id then return jsonb_build_object('status', 'self_scan'); end if;

  if v_mission.mission_type = 'animal_pack' then
    select assignment_key into v_scanner_assignment from public.mission_participant_assignments
    where mission_id = p_mission_id and participant_identity_id = v_scanner_id;
    select assignment_key into v_owner_assignment from public.mission_participant_assignments
    where mission_id = p_mission_id and participant_identity_id = v_owner_id;
    if v_scanner_assignment is null or v_owner_assignment is null then return jsonb_build_object('status', 'invalid'); end if;
    if v_scanner_assignment <> v_owner_assignment then return jsonb_build_object('status', 'wrong_animal'); end if;
  else
    select faction_key into v_scanner_assignment from public.wild_faction_assignments
    where game_id = v_game.id and participant_identity_id = v_scanner_id;
    select faction_key into v_owner_assignment from public.wild_faction_assignments
    where game_id = v_game.id and participant_identity_id = v_owner_id;
    if v_scanner_assignment is null or v_owner_assignment is null then return jsonb_build_object('status', 'wrong_game'); end if;

    v_relationship := v_mission.config->>'encounter_relationship';
    v_required_faction := v_mission.config->>'faction_key';
    v_target_faction := v_mission.config->>'target_faction';
    v_scanner_eligible := v_required_faction = 'all' or v_scanner_assignment = v_required_faction;
    v_owner_eligible := v_required_faction = 'all' or v_owner_assignment = v_required_faction;
    if not v_scanner_eligible and not v_owner_eligible then return jsonb_build_object('status', 'wrong_faction'); end if;
    if v_relationship = 'same_faction' and v_scanner_assignment <> v_owner_assignment then
      return jsonb_build_object('status', 'same_faction_required');
    elsif v_relationship = 'different_faction' and v_scanner_assignment = v_owner_assignment then
      return jsonb_build_object('status', 'different_faction_required');
    elsif v_relationship = 'specific_faction' and not (
      (v_scanner_eligible and v_owner_assignment = v_target_faction)
      or (v_owner_eligible and v_scanner_assignment = v_target_faction)
    ) then return jsonb_build_object('status', 'specific_faction_required');
    elsif v_relationship not in ('same_faction', 'different_faction', 'specific_faction') then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;

  v_low := least(v_scanner_id, v_owner_id);
  v_high := greatest(v_scanner_id, v_owner_id);
  perform pg_advisory_xact_lock(hashtext('partyup-mission-pair:' || p_mission_id::text || ':' || v_low::text || ':' || v_high::text));
  insert into public.mission_encounters (
    mission_id, participant_low_identity_id, participant_high_identity_id, assignment_key
  ) values (
    p_mission_id, v_low, v_high,
    case when v_mission.mission_type = 'animal_pack' then v_scanner_assignment else v_relationship end
  ) on conflict (mission_id, participant_low_identity_id, participant_high_identity_id) do nothing;
  get diagnostics v_inserted_rows = row_count;
  if v_inserted_rows = 0 then return jsonb_build_object('status', 'duplicate'); end if;

  if v_mission.mission_type = 'animal_pack' then
    select count(*)::integer into v_scanner_progress from public.mission_encounters
    where mission_id = p_mission_id and v_scanner_id in (participant_low_identity_id, participant_high_identity_id);
    select count(*)::integer into v_owner_progress from public.mission_encounters
    where mission_id = p_mission_id and v_owner_id in (participant_low_identity_id, participant_high_identity_id);
    v_target := greatest(1, coalesce((v_mission.config->>'target_encounters')::integer, 3));
    if v_scanner_progress >= v_target then insert into public.mission_completions(mission_id, participant_identity_id)
      values (p_mission_id, v_scanner_id) on conflict (mission_id, participant_identity_id) do nothing; end if;
    if v_owner_progress >= v_target then insert into public.mission_completions(mission_id, participant_identity_id)
      values (p_mission_id, v_owner_id) on conflict (mission_id, participant_identity_id) do nothing; end if;
    return jsonb_build_object('status', 'valid', 'progress', v_scanner_progress, 'target_encounters', v_target, 'completed', v_scanner_progress >= v_target);
  end if;

  v_target := greatest(1, least(3, coalesce((v_mission.config->>'required_encounters')::integer, 1)));
  v_scanner_progress := public.get_wild_verified_encounter_progress(p_mission_id, v_scanner_id);
  v_owner_progress := public.get_wild_verified_encounter_progress(p_mission_id, v_owner_id);
  if v_scanner_eligible and v_scanner_progress >= v_target then
    perform public.award_wild_mission_for_identity(p_mission_id, v_scanner_id);
    v_scanner_completed := true;
  end if;
  if v_owner_eligible and v_owner_progress >= v_target then
    perform public.award_wild_mission_for_identity(p_mission_id, v_owner_id);
    v_owner_completed := true;
  end if;
  return jsonb_build_object(
    'status', 'valid', 'progress', v_scanner_progress, 'target_encounters', v_target,
    'completed', v_scanner_completed, 'owner_completed', v_owner_completed
  );
end;
$$;

revoke all on function public.publish_wild_faction_mission(uuid, text, text, text, text, integer, integer, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.get_wild_verified_encounter_progress(uuid, uuid) from public, anon, authenticated;
revoke all on function public.award_wild_mission_for_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_my_wild_encounter_state(uuid, text) from public, anon, authenticated;
revoke all on function public.create_mission_encounter_token(uuid, text) from public, anon, authenticated;
revoke all on function public.redeem_mission_encounter_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_wild_faction_mission(uuid, text) from public, anon, authenticated;

grant execute on function public.publish_wild_faction_mission(uuid, text, text, text, text, integer, integer, text, text, integer, text) to authenticated;
grant execute on function public.get_my_wild_encounter_state(uuid, text) to anon, authenticated;
grant execute on function public.create_mission_encounter_token(uuid, text) to anon, authenticated;
grant execute on function public.redeem_mission_encounter_token(uuid, text, text) to anon, authenticated;
grant execute on function public.complete_wild_faction_mission(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
