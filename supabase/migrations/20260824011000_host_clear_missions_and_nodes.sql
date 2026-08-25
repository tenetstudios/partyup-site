-- Let hosts clear finished operational items from their dashboards without
-- deleting mission evidence, node claims, winner records, or analytics.

alter table public.room_missions
  add column if not exists host_cleared_at timestamptz null;

alter table public.live_nodes
  add column if not exists host_cleared_at timestamptz null;

create index if not exists room_missions_host_visible_history_idx
  on public.room_missions(room_id, ended_at desc)
  where status = 'ended' and host_cleared_at is null;

create index if not exists live_nodes_host_visible_created_idx
  on public.live_nodes(room_id, created_at desc)
  where host_cleared_at is null;

create or replace function public.clear_past_room_mission(p_mission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
begin
  select * into v_mission
  from public.room_missions
  where id = p_mission_id
  for update;

  if not found or not public.is_room_host(v_mission.room_id) then
    raise exception 'Past Mission not found';
  end if;

  if v_mission.status <> 'ended' then
    raise exception 'Only past Missions can be cleared';
  end if;

  update public.room_missions
  set host_cleared_at = coalesce(host_cleared_at, now())
  where id = p_mission_id;

  return true;
end;
$$;

create or replace function public.clear_finished_live_node(p_node_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.live_nodes;
begin
  select * into v_node
  from public.live_nodes
  where id = p_node_id
  for update;

  if not found or not public.is_room_host(v_node.room_id) then
    raise exception 'Live Node not found';
  end if;

  if v_node.status = 'claimed' and exists (
    select 1
    from public.live_node_claims claim
    where claim.node_id = v_node.id
      and claim.claim_position = 1
      and claim.fulfilled_at is null
  ) then
    raise exception 'Mark the winner reward as given before clearing this Node';
  end if;

  if v_node.status <> 'ended' and v_node.status <> 'claimed' then
    raise exception 'Only ended or fulfilled claimed Nodes can be cleared';
  end if;

  update public.live_nodes
  set host_cleared_at = coalesce(host_cleared_at, now())
  where id = p_node_id;

  return true;
end;
$$;

create or replace function public.get_room_mission_history(p_room_id uuid, p_limit integer default 10)
returns table (
  id uuid, room_id uuid, created_by_identity_id uuid, title text, description text,
  mission_type text, config jsonb, status text, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz, ended_at timestamptz, ended_reason text,
  completion_count bigint, participant_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can view Mission history';
  end if;

  perform public.close_expired_room_missions(p_room_id);

  return query
  select mission.id, mission.room_id, mission.created_by_identity_id, mission.title,
    mission.description, mission.mission_type, mission.config, mission.status,
    mission.starts_at, mission.ends_at, mission.created_at, mission.ended_at,
    mission.ended_reason,
    (select count(*) from public.mission_completions c where c.mission_id = mission.id),
    (select count(*) from public.mission_participant_assignments a where a.mission_id = mission.id)
  from public.room_missions mission
  where mission.room_id = p_room_id
    and mission.status = 'ended'
    and mission.host_cleared_at is null
  order by mission.ended_at desc nulls last, mission.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

create or replace function public.get_room_live_nodes(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can view Live Nodes';
  end if;

  select coalesce(jsonb_agg(
    (to_jsonb(node) - 'token_hash' - 'host_cleared_at') || jsonb_build_object(
      'claim_count', (
        select count(*)
        from public.live_node_claims claim
        where claim.node_id = node.id
      ),
      'winner', (
        select jsonb_build_object(
          'claim_id', claim.id,
          'identity_id', claim.identity_id,
          'display_name', coalesce(
            nullif(to_jsonb(profile)->>'display_name', ''),
            profile.username,
            'Guest ' || left(claim.identity_id::text, 4)
          ),
          'avatar_url', profile.avatar_url,
          'claimed_at', claim.claimed_at,
          'fulfilled_at', claim.fulfilled_at
        )
        from public.live_node_claims claim
        join public.partyup_identities identity on identity.id = claim.identity_id
        left join public.profiles profile on profile.id = identity.user_id
        where claim.node_id = node.id
          and claim.claim_position = 1
      )
    ) order by node.created_at desc
  ), '[]'::jsonb) into v_result
  from public.live_nodes node
  where node.room_id = p_room_id
    and node.host_cleared_at is null;

  return v_result;
end;
$$;

revoke all on function public.clear_past_room_mission(uuid) from public, anon, authenticated;
revoke all on function public.clear_finished_live_node(uuid) from public, anon, authenticated;
revoke all on function public.get_room_mission_history(uuid, integer) from public, anon, authenticated;
revoke all on function public.get_room_live_nodes(uuid) from public, anon, authenticated;
grant execute on function public.clear_past_room_mission(uuid) to authenticated;
grant execute on function public.clear_finished_live_node(uuid) to authenticated;
grant execute on function public.get_room_mission_history(uuid, integer) to authenticated;
grant execute on function public.get_room_live_nodes(uuid) to authenticated;

notify pgrst, 'reload schema';
