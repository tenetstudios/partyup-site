-- Squad formation is a host-deployed Wild Mission. Formation is unavailable
-- outside an active, faction-eligible Mission and awards its territory once
-- when a provisional squad reaches three members.

alter table public.wild_squads
  add column formation_mission_id uuid null references public.room_missions(id) on delete set null;

create or replace function public.get_active_wild_formation_mission(
  p_game_id uuid,
  p_faction_key text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select mission.id
  from public.room_missions mission
  join public.wild_games game
    on game.id = p_game_id
   and game.room_id = mission.room_id
  join public.event_rooms room on room.id = game.room_id
  where game.status = 'active'
    and room.status::text <> 'ended'
    and mission.mission_type = 'wild_faction'
    and mission.status = 'active'
    and mission.config->>'game_id' = p_game_id::text
    and mission.config->>'scope' = 'squad'
    and mission.config->>'verification_type' = 'form_squad'
    and mission.starts_at <= now()
    and (mission.ends_at is null or mission.ends_at > now())
    and (mission.config->>'faction_key' = 'all'
      or mission.config->>'faction_key' = p_faction_key)
  order by mission.starts_at desc
  limit 1;
$$;

create or replace function public.require_active_wild_formation_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_faction_key text;
  v_active_mission_id uuid;
  v_formation_mission_id uuid;
begin
  if tg_table_name = 'wild_squads' then
    v_game_id := new.game_id;
    v_faction_key := new.faction_key;
  else
    select squad.game_id, squad.faction_key, squad.formation_mission_id
    into v_game_id, v_faction_key, v_formation_mission_id
    from public.wild_squads squad
    where squad.id = new.squad_id;
  end if;

  v_active_mission_id := public.get_active_wild_formation_mission(v_game_id, v_faction_key);
  if v_game_id is null or v_active_mission_id is null then
    raise exception 'The host must launch a Form a Squad Mission before squads can be formed';
  end if;
  if tg_table_name = 'wild_squads' then
    new.formation_mission_id := v_active_mission_id;
  elsif v_formation_mission_id is distinct from v_active_mission_id then
    raise exception 'This squad belongs to an earlier Form a Squad Mission';
  end if;
  return new;
end;
$$;

drop trigger if exists wild_squads_require_formation_mission on public.wild_squads;
create trigger wild_squads_require_formation_mission
before insert on public.wild_squads
for each row execute function public.require_active_wild_formation_mission();

drop trigger if exists wild_squad_members_require_formation_mission on public.wild_squad_members;
create trigger wild_squad_members_require_formation_mission
before insert on public.wild_squad_members
for each row execute function public.require_active_wild_formation_mission();

create or replace function public.require_active_wild_formation_token_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_faction_key text;
  v_active_mission_id uuid;
  v_formation_mission_id uuid;
begin
  if new.wild_game_id is null then return new; end if;
  select assignment.faction_key into v_faction_key
  from public.wild_faction_assignments assignment
  where assignment.game_id = new.wild_game_id
    and assignment.participant_identity_id = new.participant_identity_id;
  v_active_mission_id := public.get_active_wild_formation_mission(new.wild_game_id, v_faction_key);
  select squad.formation_mission_id into v_formation_mission_id
  from public.wild_squad_members member
  join public.wild_squads squad on squad.id = member.squad_id
  where squad.game_id = new.wild_game_id
    and member.participant_identity_id = new.participant_identity_id;
  if v_active_mission_id is null
     or (v_formation_mission_id is not null
       and v_formation_mission_id is distinct from v_active_mission_id) then
    raise exception 'The host must launch a Form a Squad Mission before squad codes can be created';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_encounter_tokens_require_formation_mission on public.mission_encounter_tokens;
create trigger mission_encounter_tokens_require_formation_mission
before insert on public.mission_encounter_tokens
for each row execute function public.require_active_wild_formation_token_mission();

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
  v_required_progress integer;
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
  if v_verification not in ('encounter', 'match_faction', 'memory_upload', 'live_node', 'form_squad') then
    raise exception 'Squad Mission verification type is invalid';
  end if;
  v_required_progress := case when v_verification = 'form_squad' then 1 else p_required_progress end;
  if v_required_progress not between 1 and 20 then raise exception 'Required progress must be between 1 and 20'; end if;
  if not exists (select 1 from public.wild_territories
    where game_id = p_game_id and territory_key = p_territory_key) then
    raise exception 'Territory does not belong to this Wild game';
  end if;
  if v_faction <> 'all' and not exists (
    select 1 from jsonb_array_elements(v_game.config->'factions') faction(value)
    where faction.value->>'key' = v_faction
  ) then raise exception 'Faction does not belong to this Wild game'; end if;
  if v_verification = 'encounter'
     and p_encounter_relationship not in ('same_faction', 'different_faction', 'specific_faction') then
    raise exception 'Encounter relationship is invalid';
  end if;
  if v_verification = 'memory_upload' and p_required_media_type not in ('any', 'image', 'video') then
    raise exception 'Required media type must be any, image, or video';
  end if;
  if v_verification = 'live_node' and not exists (
    select 1 from public.live_nodes
    where id = p_live_node_id and room_id = v_game.room_id and status = 'active'
      and (ends_at is null or ends_at > now())
  ) then raise exception 'Choose an active Live Node in this room'; end if;
  if v_verification = 'live_node' and v_required_progress > (
    select node.max_claims - (select count(*) from public.live_node_claims claim where claim.node_id = node.id)
    from public.live_nodes node where node.id = p_live_node_id
  ) then raise exception 'Required progress exceeds the remaining Live Node claims'; end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || v_game.room_id::text));
  perform public.close_expired_room_missions(v_game.room_id);
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = v_game.room_id and status = 'active';
  update public.mission_encounter_tokens set revoked_at = now()
  where wild_game_id = p_game_id and revoked_at is null;

  insert into public.room_missions(
    room_id, created_by_identity_id, title, description, mission_type,
    config, status, starts_at, ends_at
  ) values (
    v_game.room_id, v_identity_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    'wild_faction', jsonb_strip_nulls(jsonb_build_object(
      'game_id', p_game_id, 'faction_key', v_faction,
      'territory_key', p_territory_key, 'influence_reward', p_influence_reward,
      'scope', 'squad', 'progress_mode', 'aggregate',
      'verification_type', v_verification, 'required_progress', v_required_progress,
      'formation_min_members', case when v_verification = 'form_squad' then 3 else null end,
      'required_encounters', case when v_verification = 'encounter' then v_required_progress else null end,
      'encounter_relationship', case when v_verification = 'encounter' then p_encounter_relationship else null end,
      'target_faction', case when p_encounter_relationship = 'specific_faction' then p_target_faction else null end,
      'required_matches', case when v_verification = 'match_faction' then v_required_progress else null end,
      'match_relationship', case when v_verification = 'match_faction' then 'opposing_faction' else null end,
      'required_memories', case when v_verification = 'memory_upload' then v_required_progress else null end,
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
  if v_mission.config->>'verification_type' = 'form_squad' then
    select case when squad.status = 'active'
      and squad.formation_mission_id = p_mission_id
      and squad.activated_at >= v_mission.starts_at
      and (v_mission.ends_at is null or squad.activated_at <= v_mission.ends_at)
      then 1 else 0 end
    into v_progress
    from public.wild_squads squad
    where squad.id = p_squad_id;
  elsif v_mission.config->>'verification_type' = 'encounter' then
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

create or replace function public.award_formed_wild_squad_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission_id uuid;
begin
  if old.status = 'provisional' and new.status = 'active' then
    v_mission_id := public.get_active_wild_formation_mission(new.game_id, new.faction_key);
    if v_mission_id is null or new.formation_mission_id is distinct from v_mission_id then
      raise exception 'The Form a Squad Mission is no longer active';
    end if;
    perform public.award_wild_squad_mission(v_mission_id, new.id, new.created_by_identity_id);
  end if;
  return new;
end;
$$;

drop trigger if exists wild_squads_award_formation_mission on public.wild_squads;
create trigger wild_squads_award_formation_mission
after update of status on public.wild_squads
for each row execute function public.award_formed_wild_squad_mission();

revoke all on function public.get_active_wild_formation_mission(uuid, text) from public, anon, authenticated;
revoke all on function public.require_active_wild_formation_mission() from public, anon, authenticated;
revoke all on function public.require_active_wild_formation_token_mission() from public, anon, authenticated;
revoke all on function public.award_formed_wild_squad_mission() from public, anon, authenticated;
