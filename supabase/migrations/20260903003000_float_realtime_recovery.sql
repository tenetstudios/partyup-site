-- PARTYUP FLOAT PHASE 9.1
-- Durable recovery metadata. Gameplay remains peer-to-peer; these writes are
-- asynchronous checkpoints and idempotent action-log batches only.

alter table public.float_matches
  add column protocol_version integer not null default 1 check (protocol_version = 1),
  add column checkpoint_revision bigint not null default 0 check (checkpoint_revision >= 0),
  add column checkpoint_tick bigint not null default 0 check (checkpoint_tick >= 0),
  add column checkpoint_state jsonb null check (checkpoint_state is null or jsonb_typeof(checkpoint_state) = 'object'),
  add column checkpoint_hash text null check (checkpoint_hash is null or checkpoint_hash ~ '^[0-9a-f]{64}$'),
  add column player_a_checkpoint_sequence bigint not null default 0 check (player_a_checkpoint_sequence >= 0),
  add column player_b_checkpoint_sequence bigint not null default 0 check (player_b_checkpoint_sequence >= 0),
  add column checkpointed_at timestamptz null;

alter table public.float_match_actions
  add column protocol_version integer null check (protocol_version = 1),
  add column client_sequence bigint null check (client_sequence > 0),
  add column simulation_tick bigint null check (simulation_tick >= 0);

create unique index float_match_actions_actor_sequence_idx
on public.float_match_actions(match_id, actor_player_id, client_sequence)
where client_sequence is not null;

create index float_match_actions_tick_recovery_idx
on public.float_match_actions(match_id, simulation_tick, actor_player_id, client_sequence)
where simulation_tick is not null;

create or replace function public.float_server_persist_actions(
  p_user_id uuid,
  p_match_id uuid,
  p_actions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.float_matches;
  v_actor text;
  v_action jsonb;
  v_inserted integer := 0;
begin
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 100 then
    raise exception 'Invalid Float action batch';
  end if;
  select * into v_match from public.float_matches where id = p_match_id for update;
  if not found then raise exception 'Float match not found'; end if;
  if v_match.status <> 'active' then raise exception 'Float match is not active'; end if;
  v_actor := case when p_user_id = v_match.player_a_id then 'playerA' when p_user_id = v_match.player_b_id then 'playerB' else null end;
  if v_actor is null then raise exception 'Not a Float match participant'; end if;

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    if (v_action->>'protocolVersion')::integer <> 1
      or v_action->>'matchId' <> p_match_id::text
      or v_action->>'actorPlayerId' <> v_actor
      or (v_action->>'clientSequence')::bigint < 1
      or (v_action->>'clientSequence')::bigint > 9007199254740991
      or (v_action->>'simulationTick')::bigint < 0
      or (v_action->>'simulationTick')::bigint > 9007199254740991
      or jsonb_typeof(v_action->'payload') <> 'object'
      or octet_length((v_action->'payload')::text) > 2048
      or v_action->>'actionType' not in ('PLACE_WALL','REMOVE_WALL','PLACE_NAILS','REMOVE_NAILS','PLACE_GLUE','REMOVE_GLUE','REPAIR_WALL','SEND_BALLOON','POP_BALLOON')
    then raise exception 'Invalid Float action envelope'; end if;
    if v_action->>'actionType' = 'PLACE_WALL' and (
      v_action#>>'{payload,orientation}' not in ('vertical', 'horizontal')
      or v_action#>>'{payload,gridX}' !~ '^\d+$' or (v_action#>>'{payload,gridX}')::integer not between 0 and 100
      or v_action#>>'{payload,gridY}' !~ '^\d+$' or (v_action#>>'{payload,gridY}')::integer not between 0 and 100
    ) then raise exception 'Invalid Float wall payload'; end if;
    if v_action->>'actionType' = 'SEND_BALLOON' and (
      v_action#>>'{payload,balloonType}' not in ('basic', 'speed', 'heavy')
      or v_action#>>'{payload,lane}' !~ '^[1-4]$'
    ) then raise exception 'Invalid Float send payload'; end if;
    if v_action->>'actionType' = 'POP_BALLOON' and (
      nullif(v_action#>>'{payload,balloonId}', '') is null or length(v_action#>>'{payload,balloonId}') > 240
    ) then raise exception 'Invalid Float pop payload'; end if;
    if v_action->>'actionType' in ('REMOVE_WALL','PLACE_NAILS','REMOVE_NAILS','PLACE_GLUE','REMOVE_GLUE','REPAIR_WALL') and (
      nullif(v_action#>>'{payload,wallSegmentId}', '') is null or length(v_action#>>'{payload,wallSegmentId}') > 240
    ) then raise exception 'Invalid Float structure payload'; end if;

    insert into public.float_match_actions (
      match_id, sequence, actor_user_id, actor_player_id, action_type, payload,
      client_action_id, simulation_time_ms, protocol_version, client_sequence, simulation_tick
    ) values (
      p_match_id, v_match.last_sequence + 1, p_user_id, v_actor, v_action->>'actionType', v_action->'payload',
      (v_action->>'actionId')::uuid, ((v_action->>'simulationTick')::bigint * 1000 / 60),
      1, (v_action->>'clientSequence')::bigint, (v_action->>'simulationTick')::bigint
    ) on conflict do nothing;
    if found then
      v_match.last_sequence := v_match.last_sequence + 1;
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.float_matches set last_sequence = v_match.last_sequence where id = p_match_id;
  return jsonb_build_object('persisted', v_inserted, 'lastSequence', v_match.last_sequence);
end;
$$;

create or replace function public.float_server_write_checkpoint(
  p_user_id uuid,
  p_match_id uuid,
  p_expected_revision bigint,
  p_simulation_tick bigint,
  p_state jsonb,
  p_state_hash text,
  p_player_a_sequence bigint,
  p_player_b_sequence bigint
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
  if p_user_id <> v_match.player_a_id then raise exception 'Only Float player A may checkpoint'; end if;
  if v_match.status <> 'active' then return jsonb_build_object('conflict', false, 'match', to_jsonb(v_match)); end if;
  if v_match.checkpoint_revision <> p_expected_revision then
    return jsonb_build_object('conflict', true, 'match', to_jsonb(v_match));
  end if;
  if p_simulation_tick <= v_match.checkpoint_tick or jsonb_typeof(p_state) <> 'object'
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_player_a_sequence < v_match.player_a_checkpoint_sequence
    or p_player_b_sequence < v_match.player_b_checkpoint_sequence
  then raise exception 'Invalid Float checkpoint'; end if;
  update public.float_matches set
    checkpoint_revision = checkpoint_revision + 1,
    checkpoint_tick = p_simulation_tick,
    checkpoint_state = p_state,
    checkpoint_hash = p_state_hash,
    player_a_checkpoint_sequence = p_player_a_sequence,
    player_b_checkpoint_sequence = p_player_b_sequence,
    checkpointed_at = now(),
    status = case when p_state->>'status' = 'complete' then 'complete' else status end,
    result = case
      when p_state->>'status' <> 'complete' then result
      when p_state#>>'{result,type}' = 'draw' then 'draw'
      when p_state#>>'{result,winnerPlayerId}' = 'playerA' then 'player_a'
      when p_state#>>'{result,winnerPlayerId}' = 'playerB' then 'player_b'
      else result
    end,
    winner_user_id = case
      when p_state->>'status' <> 'complete' or p_state#>>'{result,type}' = 'draw' then winner_user_id
      when p_state#>>'{result,winnerPlayerId}' = 'playerA' then player_a_id
      when p_state#>>'{result,winnerPlayerId}' = 'playerB' then player_b_id
      else winner_user_id
    end,
    completed_at = case when p_state->>'status' = 'complete' then coalesce(completed_at, now()) else completed_at end,
    updated_at = case when p_state->>'status' = 'complete' then now() else updated_at end
  where id = p_match_id returning * into v_match;
  return jsonb_build_object('conflict', false, 'match', to_jsonb(v_match));
end;
$$;

revoke all on function public.float_server_persist_actions(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.float_server_write_checkpoint(uuid, uuid, bigint, bigint, jsonb, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.float_server_persist_actions(uuid, uuid, jsonb) to service_role;
grant execute on function public.float_server_write_checkpoint(uuid, uuid, bigint, bigint, jsonb, text, bigint, bigint) to service_role;
