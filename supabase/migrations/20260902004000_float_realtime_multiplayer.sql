-- PARTYUP FLOAT PHASE 8.1
-- Authenticated two-player transport for the canonical @partyup/balloon-core match.
-- This is intentionally isolated from PartyUp's social/video match_sessions model.

create table public.float_matches (
  id uuid primary key default gen_random_uuid(),
  match_code text not null unique check (match_code ~ '^[A-Z2-9]{6}$'),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'complete', 'abandoned')),
  player_a_id uuid not null references auth.users(id) on delete restrict,
  player_b_id uuid null references auth.users(id) on delete restrict,
  player_a_ready boolean not null default false,
  player_b_ready boolean not null default false,
  match_seed bigint not null,
  game_version text not null,
  core_version text not null,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  state_revision bigint not null default 0 check (state_revision >= 0),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  result text null check (result in ('player_a', 'player_b', 'draw', 'abandoned')),
  winner_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  player_a_last_seen_at timestamptz not null default now(),
  player_b_last_seen_at timestamptz null,
  constraint float_matches_distinct_players check (player_b_id is null or player_a_id <> player_b_id),
  constraint float_matches_winner_is_participant check (winner_user_id is null or winner_user_id in (player_a_id, player_b_id)),
  constraint float_matches_completion_shape check (
    (status in ('waiting', 'active') and result is null and winner_user_id is null and completed_at is null)
    or (status = 'complete' and result in ('player_a', 'player_b', 'draw') and completed_at is not null)
    or (status = 'abandoned' and result = 'abandoned' and winner_user_id is null and completed_at is not null)
  )
);

create index float_matches_player_a_idx on public.float_matches(player_a_id, updated_at desc);
create index float_matches_player_b_idx on public.float_matches(player_b_id, updated_at desc) where player_b_id is not null;
create index float_matches_status_idx on public.float_matches(status, updated_at desc);

create table public.float_match_actions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.float_matches(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_player_id text not null check (actor_player_id in ('playerA', 'playerB')),
  action_type text not null check (action_type in (
    'PLACE_WALL', 'REMOVE_WALL', 'PLACE_NAILS', 'REMOVE_NAILS',
    'PLACE_GLUE', 'REMOVE_GLUE', 'REPAIR_WALL', 'SEND_BALLOON', 'POP_BALLOON'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  client_action_id uuid not null,
  simulation_time_ms bigint not null check (simulation_time_ms >= 0),
  created_at timestamptz not null default now(),
  unique (match_id, sequence),
  unique (match_id, client_action_id)
);

create index float_match_actions_recovery_idx on public.float_match_actions(match_id, sequence);

alter table public.float_matches enable row level security;
alter table public.float_match_actions enable row level security;

revoke all on public.float_matches from public, anon, authenticated;
revoke all on public.float_match_actions from public, anon, authenticated;
grant select on public.float_matches to authenticated;
grant select on public.float_match_actions to authenticated;

create policy float_matches_participant_select
on public.float_matches
for select
to authenticated
using (auth.uid() in (player_a_id, player_b_id));

create policy float_match_actions_participant_select
on public.float_match_actions
for select
to authenticated
using (
  exists (
    select 1 from public.float_matches match
    where match.id = float_match_actions.match_id
      and auth.uid() in (match.player_a_id, match.player_b_id)
  )
);

create or replace function public.float_server_create_match(
  p_user_id uuid,
  p_match_id uuid,
  p_match_code text,
  p_match_seed bigint,
  p_game_version text,
  p_core_version text,
  p_initial_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_match public.float_matches;
begin
  if p_user_id is null then raise exception 'Authenticated user required'; end if;
  if p_match_code !~ '^[A-Z2-9]{6}$' then raise exception 'Invalid Float match code'; end if;
  if nullif(btrim(p_game_version), '') is null or nullif(btrim(p_core_version), '') is null then
    raise exception 'Float version metadata required';
  end if;
  if jsonb_typeof(p_initial_state) <> 'object' then raise exception 'Canonical initial state required'; end if;

  insert into public.float_matches (
    id, match_code, player_a_id, match_seed, game_version, core_version, state
  ) values (
    p_match_id, p_match_code, p_user_id, p_match_seed, p_game_version, p_core_version, p_initial_state
  ) returning * into v_match;
  return to_jsonb(v_match);
end;
$$;

create or replace function public.float_server_join_match(
  p_user_id uuid,
  p_match_code text,
  p_game_version text,
  p_core_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_match public.float_matches;
begin
  select * into v_match from public.float_matches
  where match_code = upper(btrim(p_match_code))
  for update;
  if not found then raise exception 'Float match not found'; end if;
  if v_match.game_version <> p_game_version or v_match.core_version <> p_core_version then
    raise exception 'FLOAT UPDATE REQUIRED';
  end if;
  if p_user_id = v_match.player_a_id or p_user_id = v_match.player_b_id then return to_jsonb(v_match); end if;
  if v_match.status <> 'waiting' or v_match.player_b_id is not null then raise exception 'Float match is full'; end if;

  update public.float_matches set
    player_b_id = p_user_id,
    player_b_last_seen_at = now(),
    updated_at = now()
  where id = v_match.id returning * into v_match;
  return to_jsonb(v_match);
end;
$$;

create or replace function public.float_server_set_ready(
  p_user_id uuid,
  p_match_id uuid,
  p_game_version text,
  p_core_version text,
  p_initial_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_match public.float_matches;
begin
  select * into v_match from public.float_matches where id = p_match_id for update;
  if not found then raise exception 'Float match not found'; end if;
  if p_user_id not in (v_match.player_a_id, v_match.player_b_id) then raise exception 'Not a Float match participant'; end if;
  if v_match.game_version <> p_game_version or v_match.core_version <> p_core_version then raise exception 'FLOAT UPDATE REQUIRED'; end if;
  if v_match.status in ('complete', 'abandoned') then return to_jsonb(v_match); end if;

  update public.float_matches set
    player_a_ready = player_a_ready or p_user_id = player_a_id,
    player_b_ready = player_b_ready or p_user_id = player_b_id,
    player_a_last_seen_at = case when p_user_id = player_a_id then now() else player_a_last_seen_at end,
    player_b_last_seen_at = case when p_user_id = player_b_id then now() else player_b_last_seen_at end,
    updated_at = now()
  where id = p_match_id returning * into v_match;

  if v_match.player_b_id is not null and v_match.player_a_ready and v_match.player_b_ready and v_match.status = 'waiting' then
    if jsonb_typeof(p_initial_state) <> 'object' then raise exception 'Canonical initial state required'; end if;
    update public.float_matches set
      status = 'active',
      started_at = now(),
      state = p_initial_state,
      state_revision = state_revision + 1,
      updated_at = now()
    where id = p_match_id returning * into v_match;
  end if;
  return to_jsonb(v_match);
end;
$$;

create or replace function public.float_server_heartbeat(p_user_id uuid, p_match_id uuid, p_grace_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_match public.float_matches;
begin
  if p_grace_seconds < 10 or p_grace_seconds > 3600 then raise exception 'Invalid reconnect grace period'; end if;
  update public.float_matches set
    player_a_last_seen_at = case when p_user_id = player_a_id then now() else player_a_last_seen_at end,
    player_b_last_seen_at = case when p_user_id = player_b_id then now() else player_b_last_seen_at end,
    updated_at = now()
  where id = p_match_id and p_user_id in (player_a_id, player_b_id)
  returning * into v_match;
  if not found then raise exception 'Not a Float match participant'; end if;

  if v_match.status = 'active' and (
    (p_user_id = v_match.player_a_id and v_match.player_b_last_seen_at < now() - make_interval(secs => p_grace_seconds))
    or (p_user_id = v_match.player_b_id and v_match.player_a_last_seen_at < now() - make_interval(secs => p_grace_seconds))
  ) then
    update public.float_matches set
      status = 'abandoned',
      result = 'abandoned',
      winner_user_id = null,
      completed_at = now(),
      updated_at = now()
    where id = p_match_id returning * into v_match;
  end if;
  return to_jsonb(v_match);
end;
$$;

create or replace function public.float_server_commit_state(
  p_match_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_status text,
  p_result text,
  p_winner_user_id uuid,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_match public.float_matches;
begin
  select * into v_match from public.float_matches where id = p_match_id for update;
  if not found then raise exception 'Float match not found'; end if;
  if v_match.state_revision <> p_expected_revision then
    return jsonb_build_object('conflict', true, 'match', to_jsonb(v_match));
  end if;
  if jsonb_typeof(p_state) <> 'object' then raise exception 'Canonical Float state required'; end if;

  update public.float_matches set
    state = p_state,
    state_revision = state_revision + 1,
    status = p_status,
    result = p_result,
    winner_user_id = p_winner_user_id,
    completed_at = p_completed_at,
    updated_at = now()
  where id = p_match_id returning * into v_match;
  return jsonb_build_object('conflict', false, 'match', to_jsonb(v_match));
end;
$$;

create or replace function public.float_server_commit_action(
  p_match_id uuid,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_client_action_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_simulation_time_ms bigint,
  p_state jsonb,
  p_status text,
  p_result text,
  p_winner_user_id uuid,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.float_matches;
  v_action public.float_match_actions;
  v_actor_player_id text;
  v_sequence bigint;
begin
  select * into v_match from public.float_matches where id = p_match_id for update;
  if not found then raise exception 'Float match not found'; end if;
  if p_actor_user_id = v_match.player_a_id then v_actor_player_id := 'playerA';
  elsif p_actor_user_id = v_match.player_b_id then v_actor_player_id := 'playerB';
  else raise exception 'Not a Float match participant';
  end if;

  select * into v_action from public.float_match_actions
  where match_id = p_match_id and client_action_id = p_client_action_id;
  if found then
    return jsonb_build_object('accepted', true, 'duplicate', true, 'conflict', false, 'action', to_jsonb(v_action), 'match', to_jsonb(v_match));
  end if;
  if v_match.status <> 'active' then raise exception 'Float match is not active'; end if;
  if v_match.state_revision <> p_expected_revision then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'conflict', true, 'match', to_jsonb(v_match));
  end if;
  if p_action_type not in ('PLACE_WALL','REMOVE_WALL','PLACE_NAILS','REMOVE_NAILS','PLACE_GLUE','REMOVE_GLUE','REPAIR_WALL','SEND_BALLOON','POP_BALLOON') then raise exception 'Unsupported Float action'; end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_state) <> 'object' then raise exception 'Invalid Float payload'; end if;

  v_sequence := v_match.last_sequence + 1;
  insert into public.float_match_actions (
    match_id, sequence, actor_user_id, actor_player_id, action_type,
    payload, client_action_id, simulation_time_ms
  ) values (
    p_match_id, v_sequence, p_actor_user_id, v_actor_player_id, p_action_type,
    p_payload, p_client_action_id, p_simulation_time_ms
  ) returning * into v_action;

  update public.float_matches set
    state = p_state,
    state_revision = state_revision + 1,
    last_sequence = v_sequence,
    status = p_status,
    result = p_result,
    winner_user_id = p_winner_user_id,
    completed_at = p_completed_at,
    updated_at = now()
  where id = p_match_id returning * into v_match;
  return jsonb_build_object('accepted', true, 'duplicate', false, 'conflict', false, 'action', to_jsonb(v_action), 'match', to_jsonb(v_match));
end;
$$;

revoke all on function public.float_server_create_match(uuid, uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.float_server_join_match(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.float_server_set_ready(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.float_server_heartbeat(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.float_server_commit_state(uuid, bigint, jsonb, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.float_server_commit_action(uuid, bigint, uuid, uuid, text, jsonb, bigint, jsonb, text, text, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.float_server_create_match(uuid, uuid, text, bigint, text, text, jsonb) to service_role;
grant execute on function public.float_server_join_match(uuid, text, text, text) to service_role;
grant execute on function public.float_server_set_ready(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.float_server_heartbeat(uuid, uuid, integer) to service_role;
grant execute on function public.float_server_commit_state(uuid, bigint, jsonb, text, text, uuid, timestamptz) to service_role;
grant execute on function public.float_server_commit_action(uuid, bigint, uuid, uuid, text, jsonb, bigint, jsonb, text, text, uuid, timestamptz) to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'float_matches') then
    alter publication supabase_realtime add table public.float_matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'float_match_actions') then
    alter publication supabase_realtime add table public.float_match_actions;
  end if;
end;
$$;

notify pgrst, 'reload schema';
