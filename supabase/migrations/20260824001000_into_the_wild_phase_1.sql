-- INTO THE WILD — NIGHT 1 / PHASE 1
-- Room-scoped, temporary factions driven by the existing PartyUp Missions system.

alter table public.room_missions drop constraint if exists room_missions_mission_type_check;
alter table public.room_missions add constraint room_missions_mission_type_check
  check (mission_type in ('generic', 'animal_pack', 'connection', 'wild_faction'));

create table if not exists public.wild_games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  status text not null default 'draft',
  config jsonb not null,
  winner_summary jsonb null,
  started_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wild_games_status_check check (status in ('draft', 'active', 'ended')),
  constraint wild_games_config_object_check check (jsonb_typeof(config) = 'object'),
  constraint wild_games_active_started_check check (status <> 'active' or started_at is not null),
  constraint wild_games_ended_at_check check (status <> 'ended' or ended_at is not null)
);

create unique index if not exists wild_games_one_active_per_room_idx
  on public.wild_games(room_id) where status = 'active';
create index if not exists wild_games_room_created_idx
  on public.wild_games(room_id, created_at desc);

create table if not exists public.wild_faction_assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.wild_games(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  faction_key text not null,
  created_at timestamptz not null default now(),
  constraint wild_faction_assignments_once unique (game_id, participant_identity_id),
  constraint wild_faction_key_length check (char_length(faction_key) between 1 and 32)
);

create index if not exists wild_faction_assignments_population_idx
  on public.wild_faction_assignments(game_id, faction_key);
create index if not exists wild_faction_assignments_identity_idx
  on public.wild_faction_assignments(participant_identity_id, game_id);

create table if not exists public.wild_territories (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.wild_games(id) on delete cascade,
  territory_key text not null,
  display_name text not null,
  influence jsonb not null default '{}'::jsonb,
  controlling_faction text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wild_territories_once unique (game_id, territory_key),
  constraint wild_territory_key_length check (char_length(territory_key) between 1 and 32),
  constraint wild_territory_name_length check (char_length(display_name) between 1 and 80),
  constraint wild_territory_influence_object check (jsonb_typeof(influence) = 'object')
);

create index if not exists wild_territories_game_idx on public.wild_territories(game_id);

create table if not exists public.wild_contributions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.wild_games(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  faction_key text not null,
  territory_key text not null,
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  influence_amount integer not null,
  created_at timestamptz not null default now(),
  constraint wild_contributions_once_per_mission unique (mission_id, participant_identity_id),
  constraint wild_contributions_positive check (influence_amount between 1 and 100),
  constraint wild_contributions_territory_fk foreign key (game_id, territory_key)
    references public.wild_territories(game_id, territory_key) on delete cascade
);

create index if not exists wild_contributions_identity_idx
  on public.wild_contributions(game_id, participant_identity_id, created_at desc);

create or replace function public.set_wild_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wild_games_set_updated_at on public.wild_games;
create trigger wild_games_set_updated_at before update on public.wild_games
for each row execute function public.set_wild_updated_at();

drop trigger if exists wild_territories_set_updated_at on public.wild_territories;
create trigger wild_territories_set_updated_at before update on public.wild_territories
for each row execute function public.set_wild_updated_at();

create or replace function public.start_wild_game(p_room_id uuid)
returns public.wild_games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_game public.wild_games;
  v_config jsonb := jsonb_build_object(
    'factions', jsonb_build_array(
      jsonb_build_object('key', 'marsh', 'label', 'Marsh', 'emoji', '🐸', 'color', '#34d399'),
      jsonb_build_object('key', 'pride', 'label', 'Pride', 'emoji', '🦁', 'color', '#f59e0b'),
      jsonb_build_object('key', 'pack', 'label', 'Pack', 'emoji', '🐺', 'color', '#a78bfa')
    ),
    'territories', jsonb_build_array(
      jsonb_build_object('key', 'grove', 'label', 'The Grove'),
      jsonb_build_object('key', 'well', 'label', 'The Well'),
      jsonb_build_object('key', 'summit', 'label', 'The Summit')
    )
  );
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can start Into the Wild'; end if;
  perform 1 from public.event_rooms where id = p_room_id and status::text <> 'ended' for share;
  if not found then
    raise exception 'Into the Wild cannot start in an ended or missing room';
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-wild-room:' || p_room_id::text));

  select * into v_game from public.wild_games
  where room_id = p_room_id and status = 'active'
  order by started_at desc limit 1 for update;
  if found then return v_game; end if;

  insert into public.wild_games (
    room_id, created_by_identity_id, status, config, started_at
  ) values (
    p_room_id, v_identity_id, 'active', v_config, now()
  ) returning * into v_game;

  insert into public.wild_territories (
    game_id, territory_key, display_name, influence, controlling_faction
  )
  select v_game.id, territory.value->>'key', territory.value->>'label',
    (select jsonb_object_agg(faction.value->>'key', 0)
      from jsonb_array_elements(v_config->'factions') faction(value)),
    null
  from jsonb_array_elements(v_config->'territories') territory(value);

  return v_game;
end;
$$;

create or replace function public.enter_wild_game(
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
  v_faction_key text;
  v_faction jsonb;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_game from public.wild_games where id = p_game_id;
  if not found then raise exception 'Into the Wild game not found'; end if;
  perform 1 from public.event_rooms where id = v_game.room_id and status::text <> 'ended' for share;
  if not found then raise exception 'This event has ended'; end if;

  perform pg_advisory_xact_lock(hashtext('partyup-wild-assignment:' || p_game_id::text));
  select * into v_game from public.wild_games where id = p_game_id for update;
  if v_game.status <> 'active' then raise exception 'Into the Wild is no longer accepting players'; end if;
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_identity_id) then
    raise exception 'You must be participating in this room to enter the Wild';
  end if;

  select assignment.faction_key into v_faction_key
  from public.wild_faction_assignments assignment
  where assignment.game_id = p_game_id and assignment.participant_identity_id = v_identity_id;

  if v_faction_key is null then
    select candidate.faction_key into v_faction_key
    from (
      select faction.value->>'key' as faction_key, count(assignment.id) as population
      from jsonb_array_elements(v_game.config->'factions') faction(value)
      left join public.wild_faction_assignments assignment
        on assignment.game_id = p_game_id
       and assignment.faction_key = faction.value->>'key'
      group by faction.value->>'key'
    ) candidate
    order by candidate.population asc, random()
    limit 1;

    if v_faction_key is null then raise exception 'Wild faction configuration is invalid'; end if;

    insert into public.wild_faction_assignments (
      game_id, participant_identity_id, faction_key
    ) values (
      p_game_id, v_identity_id, v_faction_key
    ) on conflict (game_id, participant_identity_id) do nothing;

    update public.wild_games set updated_at = now() where id = p_game_id;
  end if;

  select faction.value into v_faction
  from jsonb_array_elements(v_game.config->'factions') faction(value)
  where faction.value->>'key' = v_faction_key;

  return jsonb_build_object(
    'game_id', p_game_id,
    'participant_identity_id', v_identity_id,
    'faction', v_faction
  );
end;
$$;

create or replace function public.publish_wild_faction_mission(
  p_game_id uuid,
  p_faction_key text,
  p_territory_key text,
  p_title text,
  p_description text default null,
  p_influence_reward integer default 10,
  p_duration_minutes integer default 10
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
  ) then
    raise exception 'Faction does not belong to this Wild game';
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || v_game.room_id::text));
  perform public.close_expired_room_missions(v_game.room_id);

  update public.room_missions
  set status = 'ended', ended_at = now(), ended_reason = 'replaced'
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
      'influence_reward', p_influence_reward
    ),
    'active', v_starts_at, v_starts_at + make_interval(mins => p_duration_minutes)
  ) returning * into v_mission;

  return v_mission;
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
  v_mission public.room_missions;
  v_game public.wild_games;
  v_assignment public.wild_faction_assignments;
  v_territory public.wild_territories;
  v_contribution public.wild_contributions;
  v_required_faction text;
  v_territory_key text;
  v_reward integer;
  v_current integer;
  v_max integer;
  v_top_count integer;
  v_controller text;
  v_impact_missions integer;
  v_impact_influence integer;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);

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
  if not public.can_identity_participate_in_mission_room(v_game.room_id, v_identity_id) then
    raise exception 'You must be participating in this room to complete its Mission';
  end if;

  select * into v_assignment from public.wild_faction_assignments
  where game_id = v_game.id and participant_identity_id = v_identity_id;
  if not found then raise exception 'Enter the Wild before completing a Wild Mission'; end if;

  v_required_faction := v_mission.config->>'faction_key';
  v_territory_key := v_mission.config->>'territory_key';
  v_reward := (v_mission.config->>'influence_reward')::integer;
  if v_required_faction <> 'all' and v_assignment.faction_key <> v_required_faction then
    raise exception 'This Mission belongs to another faction';
  end if;
  if v_reward < 1 or v_reward > 100 then raise exception 'Wild Mission reward configuration is invalid'; end if;

  select * into v_territory from public.wild_territories
  where game_id = v_game.id and territory_key = v_territory_key for update;
  if not found then raise exception 'Wild Mission territory is invalid'; end if;

  insert into public.mission_completions (mission_id, participant_identity_id)
  values (v_mission.id, v_identity_id)
  on conflict (mission_id, participant_identity_id) do nothing;

  insert into public.wild_contributions (
    game_id, participant_identity_id, faction_key, territory_key, mission_id, influence_amount
  ) values (
    v_game.id, v_identity_id, v_assignment.faction_key, v_territory_key, v_mission.id, v_reward
  )
  on conflict (mission_id, participant_identity_id) do nothing
  returning * into v_contribution;

  if v_contribution.id is not null then
    v_current := coalesce((v_territory.influence->>v_assignment.faction_key)::integer, 0);
    v_territory.influence := jsonb_set(
      v_territory.influence,
      array[v_assignment.faction_key],
      to_jsonb(v_current + v_reward),
      true
    );

    select max(value::integer) into v_max from jsonb_each_text(v_territory.influence);
    select count(*)::integer into v_top_count
    from jsonb_each_text(v_territory.influence) where value::integer = v_max;
    if v_top_count = 1 then
      select key into v_controller from jsonb_each_text(v_territory.influence)
      where value::integer = v_max limit 1;
    else
      v_controller := null;
    end if;

    update public.wild_territories
    set influence = v_territory.influence, controlling_faction = v_controller
    where id = v_territory.id
    returning * into v_territory;
  end if;

  select count(*)::integer, coalesce(sum(influence_amount), 0)::integer
  into v_impact_missions, v_impact_influence
  from public.wild_contributions
  where game_id = v_game.id and participant_identity_id = v_identity_id;

  return jsonb_build_object(
    'status', case when v_contribution.id is null then 'already_completed' else 'awarded' end,
    'territory_key', v_territory.territory_key,
    'controlling_faction', v_territory.controlling_faction,
    'influence', v_territory.influence,
    'impact', jsonb_build_object(
      'missions_completed', v_impact_missions,
      'influence_added', v_impact_influence
    )
  );
end;
$$;

create or replace function public.finalize_wild_game(
  p_game_id uuid,
  p_ended_at timestamptz default now()
)
returns public.wild_games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.wild_games;
  v_scores jsonb;
  v_winners jsonb;
  v_max_territories integer;
  v_max_influence integer;
begin
  select * into v_game from public.wild_games where id = p_game_id for update;
  if not found then raise exception 'Into the Wild game not found'; end if;
  if v_game.status = 'ended' then return v_game; end if;

  with faction_scores as (
    select faction.value->>'key' as faction_key,
      faction.value->>'label' as label,
      faction.value->>'emoji' as emoji,
      count(territory.id) filter (where territory.controlling_faction = faction.value->>'key')::integer as territories_controlled,
      coalesce(sum(coalesce((territory.influence->>(faction.value->>'key'))::integer, 0)), 0)::integer as total_influence
    from jsonb_array_elements(v_game.config->'factions') faction(value)
    left join public.wild_territories territory on territory.game_id = v_game.id
    group by faction.value
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'faction_key', faction_key,
    'label', label,
    'emoji', emoji,
    'territories_controlled', territories_controlled,
    'total_influence', total_influence
  ) order by faction_key), '[]'::jsonb),
  max(territories_controlled)
  into v_scores, v_max_territories
  from faction_scores;

  select max((score.value->>'total_influence')::integer) into v_max_influence
  from jsonb_array_elements(v_scores) score(value)
  where (score.value->>'territories_controlled')::integer = v_max_territories;

  select coalesce(jsonb_agg(score.value order by score.value->>'faction_key'), '[]'::jsonb)
  into v_winners
  from jsonb_array_elements(v_scores) score(value)
  where (score.value->>'territories_controlled')::integer = v_max_territories
    and (score.value->>'total_influence')::integer = v_max_influence;

  update public.wild_games
  set status = 'ended', ended_at = p_ended_at,
      winner_summary = jsonb_build_object('winners', v_winners, 'scores', v_scores)
  where id = v_game.id
  returning * into v_game;

  return v_game;
end;
$$;

create or replace function public.end_wild_game(p_game_id uuid)
returns public.wild_games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.wild_games;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_game from public.wild_games where id = p_game_id;
  if not found then raise exception 'Into the Wild game not found'; end if;
  if not public.is_room_host(v_game.room_id) then raise exception 'Only the room host can end Into the Wild'; end if;

  v_game := public.finalize_wild_game(p_game_id, now());

  update public.room_missions
  set status = 'ended', ended_at = now(), ended_reason = 'manual'
  where room_id = v_game.room_id and status = 'active' and mission_type = 'wild_faction'
    and config->>'game_id' = p_game_id::text;

  return v_game;
end;
$$;

create or replace function public.get_wild_room_state(
  p_room_id uuid,
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
  v_assignment jsonb;
  v_territories jsonb;
  v_populations jsonb;
  v_impact jsonb;
  v_mission jsonb;
  v_can_manage boolean := false;
  v_room_closed boolean := false;
begin
  if auth.uid() is not null or nullif(btrim(coalesce(p_guest_token, '')), '') is not null then
    v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  end if;

  v_can_manage := public.is_room_host(p_room_id);
  select status::text = 'ended' into v_room_closed from public.event_rooms where id = p_room_id;

  if not public.can_view_room_missions(p_room_id)
     and (v_identity_id is null or not public.can_identity_participate_in_mission_room(p_room_id, v_identity_id))
     and not exists (
       select 1
       from public.wild_games prior_game
       join public.wild_faction_assignments prior_assignment on prior_assignment.game_id = prior_game.id
       where prior_game.room_id = p_room_id
         and prior_assignment.participant_identity_id = v_identity_id
     )
     and not v_can_manage then
    raise exception 'You cannot view Into the Wild in this room';
  end if;

  select * into v_game from public.wild_games
  where room_id = p_room_id
  order by (status = 'active') desc, started_at desc nulls last, created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('game', null, 'can_manage', v_can_manage, 'room_closed', coalesce(v_room_closed, true));
  end if;

  if v_identity_id is not null then
    select faction.value into v_assignment
    from public.wild_faction_assignments assignment
    join lateral jsonb_array_elements(v_game.config->'factions') faction(value)
      on faction.value->>'key' = assignment.faction_key
    where assignment.game_id = v_game.id and assignment.participant_identity_id = v_identity_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', territory.id,
    'key', territory.territory_key,
    'display_name', territory.display_name,
    'influence', territory.influence,
    'controlling_faction', territory.controlling_faction,
    'updated_at', territory.updated_at
  ) order by territory.created_at), '[]'::jsonb)
  into v_territories
  from public.wild_territories territory where territory.game_id = v_game.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'faction_key', faction.value->>'key',
    'label', faction.value->>'label',
    'emoji', faction.value->>'emoji',
    'population', (select count(*) from public.wild_faction_assignments assignment
      where assignment.game_id = v_game.id and assignment.faction_key = faction.value->>'key')
  ) order by faction.ordinality), '[]'::jsonb)
  into v_populations
  from jsonb_array_elements(v_game.config->'factions') with ordinality faction(value, ordinality);

  select jsonb_build_object(
    'missions_completed', count(*)::integer,
    'influence_added', coalesce(sum(contribution.influence_amount), 0)::integer
  ) into v_impact
  from public.wild_contributions contribution
  where contribution.game_id = v_game.id and contribution.participant_identity_id = v_identity_id;

  select jsonb_build_object(
    'id', mission.id,
    'title', mission.title,
    'description', mission.description,
    'starts_at', mission.starts_at,
    'ends_at', mission.ends_at,
    'config', mission.config,
    'viewer_completed', exists (
      select 1 from public.mission_completions completion
      where completion.mission_id = mission.id and completion.participant_identity_id = v_identity_id
    ),
    'eligible', v_assignment is not null and (
      mission.config->>'faction_key' = 'all'
      or mission.config->>'faction_key' = v_assignment->>'key'
    )
  ) into v_mission
  from public.room_missions mission
  where mission.room_id = p_room_id and mission.status = 'active'
    and mission.mission_type = 'wild_faction'
    and mission.config->>'game_id' = v_game.id::text
    and mission.starts_at <= now() and (mission.ends_at is null or mission.ends_at > now())
  order by mission.starts_at desc limit 1;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', v_game.id,
      'room_id', v_game.room_id,
      'status', v_game.status,
      'config', v_game.config,
      'started_at', v_game.started_at,
      'ended_at', v_game.ended_at,
      'winner_summary', v_game.winner_summary
    ),
    'assignment', v_assignment,
    'territories', v_territories,
    'populations', case when v_can_manage then v_populations else '[]'::jsonb end,
    'impact', coalesce(v_impact, jsonb_build_object('missions_completed', 0, 'influence_added', 0)),
    'mission', v_mission,
    'can_manage', v_can_manage,
    'room_closed', coalesce(v_room_closed, true)
  );
end;
$$;

create or replace function public.close_wild_games_when_event_ends()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  if old.status::text <> 'ended' and new.status::text = 'ended' then
    for v_game_id in select id from public.wild_games where room_id = new.id and status = 'active'
    loop
      perform public.finalize_wild_game(v_game_id, now());
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists event_rooms_close_wild_on_end on public.event_rooms;
create trigger event_rooms_close_wild_on_end
after update of status on public.event_rooms
for each row execute function public.close_wild_games_when_event_ends();

alter table public.wild_games enable row level security;
alter table public.wild_faction_assignments enable row level security;
alter table public.wild_territories enable row level security;
alter table public.wild_contributions enable row level security;

revoke all on public.wild_games from anon, authenticated;
revoke all on public.wild_faction_assignments from anon, authenticated;
revoke all on public.wild_territories from anon, authenticated;
revoke all on public.wild_contributions from anon, authenticated;
grant select on public.wild_games to anon, authenticated;
grant select on public.wild_territories to anon, authenticated;
grant select on public.wild_faction_assignments to authenticated;
grant select on public.wild_contributions to authenticated;

drop policy if exists wild_games_select_room on public.wild_games;
create policy wild_games_select_room on public.wild_games for select to anon, authenticated
using (public.can_view_room_missions(room_id));

drop policy if exists wild_territories_select_room on public.wild_territories;
create policy wild_territories_select_room on public.wild_territories for select to anon, authenticated
using (exists (
  select 1 from public.wild_games game
  where game.id = wild_territories.game_id and public.can_view_room_missions(game.room_id)
));

drop policy if exists wild_assignments_select_own_or_host on public.wild_faction_assignments;
drop policy if exists wild_assignments_select_own on public.wild_faction_assignments;
create policy wild_assignments_select_own on public.wild_faction_assignments
for select to authenticated using (
  participant_identity_id = public.current_partyup_identity_id()
);

drop policy if exists wild_contributions_select_own_or_host on public.wild_contributions;
drop policy if exists wild_contributions_select_own on public.wild_contributions;
create policy wild_contributions_select_own on public.wild_contributions
for select to authenticated using (
  participant_identity_id = public.current_partyup_identity_id()
);

revoke all on function public.start_wild_game(uuid) from public, anon, authenticated;
revoke all on function public.enter_wild_game(uuid, text) from public, anon, authenticated;
revoke all on function public.publish_wild_faction_mission(uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_wild_faction_mission(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_wild_game(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.end_wild_game(uuid) from public, anon, authenticated;
revoke all on function public.get_wild_room_state(uuid, text) from public, anon, authenticated;

grant execute on function public.start_wild_game(uuid) to authenticated;
grant execute on function public.enter_wild_game(uuid, text) to anon, authenticated;
grant execute on function public.publish_wild_faction_mission(uuid, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.complete_wild_faction_mission(uuid, text) to anon, authenticated;
grant execute on function public.end_wild_game(uuid) to authenticated;
grant execute on function public.get_wild_room_state(uuid, text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.wild_games;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.wild_territories;
exception when duplicate_object then null; when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
