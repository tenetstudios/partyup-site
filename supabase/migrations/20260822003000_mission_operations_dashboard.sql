create or replace function public.get_mission_operations_dashboard(p_mission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
  v_room_ended boolean;
  v_minimum_group_size integer;
  v_result jsonb;
begin
  select * into v_mission
  from public.room_missions
  where id = p_mission_id;

  if not found then
    raise exception 'Mission not found';
  end if;

  if not public.is_room_host(v_mission.room_id) then
    raise exception 'Only the room host can view Mission operations';
  end if;

  select room.status::text = 'ended'
  into v_room_ended
  from public.event_rooms room
  where room.id = v_mission.room_id;

  v_minimum_group_size := case
    when coalesce(v_mission.config->>'minimum_group_size', '') ~ '^[0-9]+$'
      then greatest(1, (v_mission.config->>'minimum_group_size')::integer)
    when coalesce(v_mission.config->>'target_encounters', '') ~ '^[0-9]+$'
      then greatest(1, (v_mission.config->>'target_encounters')::integer + 1)
    else null
  end;

  with config_groups as (
    select
      item.ordinality::integer as sort_order,
      case
        when jsonb_typeof(item.value) = 'string' then item.value #>> '{}'
        when jsonb_typeof(item.value) = 'object' then nullif(item.value->>'key', '')
        else null
      end as assignment_key,
      case
        when jsonb_typeof(item.value) = 'string' then item.value #>> '{}'
        when jsonb_typeof(item.value) = 'object' then coalesce(nullif(item.value->>'label', ''), nullif(item.value->>'key', ''))
        else null
      end as label,
      case when jsonb_typeof(item.value) = 'object' then nullif(item.value->>'color', '') end as color
    from jsonb_array_elements(
      case when jsonb_typeof(v_mission.config->'groups') = 'array'
        then v_mission.config->'groups' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
  ),
  animal_groups as (
    select
      (1000 + item.ordinality)::integer as sort_order,
      item.value as assignment_key,
      item.value as label,
      null::text as color
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_mission.config->'animals') = 'array'
        then v_mission.config->'animals' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
  ),
  declared_groups as (
    select * from config_groups where assignment_key is not null
    union all
    select animal.*
    from animal_groups animal
    where not exists (select 1 from config_groups where assignment_key is not null)
  ),
  all_group_keys as (
    select assignment_key, min(sort_order) as sort_order
    from declared_groups
    group by assignment_key
    union
    select assignment.assignment_key, 100000
    from public.mission_participant_assignments assignment
    where assignment.mission_id = p_mission_id
      and not exists (
        select 1 from declared_groups declared
        where declared.assignment_key = assignment.assignment_key
      )
  ),
  group_metrics as (
    select
      keys.assignment_key,
      coalesce(
        (select declared.label from declared_groups declared where declared.assignment_key = keys.assignment_key order by declared.sort_order limit 1),
        keys.assignment_key
      ) as label,
      (select declared.color from declared_groups declared where declared.assignment_key = keys.assignment_key and declared.color is not null order by declared.sort_order limit 1) as color,
      keys.sort_order,
      (select count(*)::integer
        from public.mission_participant_assignments assignment
        where assignment.mission_id = p_mission_id and assignment.assignment_key = keys.assignment_key
      ) as participant_count,
      (select count(*)::integer
        from public.mission_completions completion
        join public.mission_participant_assignments assignment
          on assignment.mission_id = completion.mission_id
         and assignment.participant_identity_id = completion.participant_identity_id
        where completion.mission_id = p_mission_id and assignment.assignment_key = keys.assignment_key
      ) as completed_count,
      (select count(*)::integer
        from public.mission_encounters encounter
        where encounter.mission_id = p_mission_id and encounter.assignment_key = keys.assignment_key
      ) as encounter_count
    from all_group_keys keys
  ),
  participant_identities as (
    select participant_identity_id from public.mission_participant_assignments where mission_id = p_mission_id
    union
    select participant_identity_id from public.mission_completions where mission_id = p_mission_id
    union
    select participant_low_identity_id from public.mission_encounters where mission_id = p_mission_id
    union
    select participant_high_identity_id from public.mission_encounters where mission_id = p_mission_id
  ),
  summary as (
    select
      (select count(*)::integer from participant_identities) as participant_count,
      (select count(*)::integer from public.mission_participant_assignments where mission_id = p_mission_id) as assigned_participant_count,
      (select count(*)::integer from public.mission_completions where mission_id = p_mission_id) as completed_count,
      (select count(*)::integer from public.mission_encounters where mission_id = p_mission_id) as encounter_count,
      (select count(*)::integer from group_metrics) as group_count,
      coalesce((select min(participant_count) from group_metrics), 0) as smallest_group_count,
      coalesce((select max(participant_count) from group_metrics), 0) as largest_group_count,
      coalesce((select count(*)::integer from group_metrics where v_minimum_group_size is not null and participant_count < v_minimum_group_size), 0) as underfilled_group_count,
      greatest(
        coalesce((select max(created_at) from public.mission_participant_assignments where mission_id = p_mission_id), v_mission.created_at),
        coalesce((select max(created_at) from public.mission_encounters where mission_id = p_mission_id), v_mission.created_at),
        coalesce((select max(completed_at) from public.mission_completions where mission_id = p_mission_id), v_mission.created_at)
      ) as last_activity_at
  )
  select jsonb_build_object(
    'mission_id', v_mission.id,
    'mission_type', v_mission.mission_type,
    'title', v_mission.title,
    'status', v_mission.status,
    'starts_at', v_mission.starts_at,
    'ends_at', v_mission.ends_at,
    'generated_at', now(),
    'last_activity_at', summary.last_activity_at,
    'minimum_group_size', v_minimum_group_size,
    'operational_status', case
      when v_mission.status = 'ended' or coalesce(v_room_ended, false) then 'ended'
      when summary.participant_count = 0 then 'waiting_for_participants'
      when summary.underfilled_group_count > 0 then 'needs_people'
      when summary.group_count > 1 and summary.largest_group_count - summary.smallest_group_count > 1 then 'imbalanced'
      else 'healthy'
    end,
    'summary', jsonb_build_object(
      'participant_count', summary.participant_count,
      'assigned_participant_count', summary.assigned_participant_count,
      'unassigned_participant_count', greatest(0, summary.participant_count - summary.assigned_participant_count),
      'completed_count', summary.completed_count,
      'completion_rate', case when summary.participant_count = 0 then 0
        else round((summary.completed_count::numeric / summary.participant_count::numeric) * 100, 1) end,
      'encounter_count', summary.encounter_count,
      'group_count', summary.group_count,
      'smallest_group_count', summary.smallest_group_count,
      'largest_group_count', summary.largest_group_count,
      'assignment_spread', summary.largest_group_count - summary.smallest_group_count,
      'underfilled_group_count', summary.underfilled_group_count
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_key', metric.assignment_key,
        'label', metric.label,
        'color', metric.color,
        'participant_count', metric.participant_count,
        'completed_count', metric.completed_count,
        'encounter_count', metric.encounter_count,
        'minimum_group_size', v_minimum_group_size,
        'underfilled', v_minimum_group_size is not null and metric.participant_count < v_minimum_group_size
      ) order by metric.sort_order, metric.assignment_key)
      from group_metrics metric
    ), '[]'::jsonb)
  )
  into v_result
  from summary;

  return v_result;
end;
$$;

revoke all on function public.get_mission_operations_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.get_mission_operations_dashboard(uuid) to authenticated;

create or replace function public.get_mission_completed_participants(
  p_mission_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total integer;
  v_people jsonb;
begin
  select room_id into v_room_id
  from public.room_missions
  where id = p_mission_id;

  if v_room_id is null then
    raise exception 'Mission not found';
  end if;

  if not public.is_room_host(v_room_id) then
    raise exception 'Only the room host can view completed participants';
  end if;

  select count(*)::integer into v_total
  from public.mission_completions completion
  where completion.mission_id = p_mission_id;

  select coalesce(jsonb_agg(person.row_data order by person.completed_at), '[]'::jsonb)
  into v_people
  from (
    select
      completion.completed_at,
      jsonb_build_object(
        'identity_id', completion.participant_identity_id,
        'display_name', coalesce(
          nullif(to_jsonb(profile)->>'display_name', ''),
          profile.username,
          'Guest ' || left(completion.participant_identity_id::text, 4)
        ),
        'avatar_url', profile.avatar_url,
        'assignment_key', assignment.assignment_key,
        'completed_at', completion.completed_at
      ) as row_data
    from public.mission_completions completion
    join public.partyup_identities identity on identity.id = completion.participant_identity_id
    left join public.profiles profile on profile.id = identity.user_id
    left join public.mission_participant_assignments assignment
      on assignment.mission_id = completion.mission_id
     and assignment.participant_identity_id = completion.participant_identity_id
    where completion.mission_id = p_mission_id
    order by completion.completed_at
    limit v_limit offset v_offset
  ) person;

  return jsonb_build_object(
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + jsonb_array_length(v_people) < v_total,
    'participants', v_people
  );
end;
$$;

revoke all on function public.get_mission_completed_participants(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_mission_completed_participants(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
