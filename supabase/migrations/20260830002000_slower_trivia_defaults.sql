-- Give participants time to join and read each question without changing the
-- host's ability to customize either value per round.
alter table public.trivia_rounds alter column seconds_per_question set default 10;
alter table public.trivia_rounds alter column countdown_seconds set default 45;

create or replace function public.create_lightning_trivia_round(
  p_room_id uuid, p_question_ids uuid[], p_starts_at timestamptz default null,
  p_seconds_per_question integer default 10, p_countdown_seconds integer default 45,
  p_wild_game_id uuid default null, p_territory_key text default null,
  p_minimum_faction_participants integer default 5,
  p_first_place_reward integer default 50, p_second_place_reward integer default 20,
  p_third_place_reward integer default 10
)
returns public.trivia_rounds language plpgsql security definer set search_path = public as $$
declare
  v_identity uuid := public.current_partyup_identity_id(); v_round public.trivia_rounds; v_mission public.room_missions;
  v_starts timestamptz; v_end timestamptz; v_count integer; v_title text;
begin
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can launch trivia'; end if;
  perform 1 from public.event_rooms where id = p_room_id and status::text <> 'ended' for share;
  if not found then raise exception 'Room is missing or ended'; end if;
  if coalesce(array_length(p_question_ids, 1), 0) <> 10 or (select count(distinct value) from unnest(p_question_ids) item(value)) <> 10 then raise exception 'Select exactly 10 different questions'; end if;
  select count(*) into v_count from public.trivia_questions q where q.id = any(p_question_ids) and q.is_active
    and (q.bank_scope = 'partyup' or (q.bank_scope = 'custom' and q.created_by_identity_id = v_identity));
  if v_count <> 10 then raise exception 'Every selected question must be active and available to this host'; end if;
  if p_seconds_per_question not between 3 and 15 then raise exception 'Question time must be 3 to 15 seconds'; end if;
  if p_countdown_seconds not between 3 and 120 then raise exception 'Countdown must be 3 to 120 seconds'; end if;
  if p_minimum_faction_participants not between 1 and 10 then raise exception 'Minimum faction players must be 1 to 10'; end if;
  if p_first_place_reward not between 0 and 100 or p_second_place_reward not between 0 and 100 or p_third_place_reward not between 0 and 100 then raise exception 'Rewards must be 0 to 100'; end if;
  if (p_wild_game_id is null) <> (p_territory_key is null) then raise exception 'Wild game and territory must be selected together'; end if;
  if p_wild_game_id is not null and not exists (select 1 from public.wild_games game join public.wild_territories territory on territory.game_id = game.id where game.id = p_wild_game_id and game.room_id = p_room_id and game.status = 'active' and territory.territory_key = p_territory_key) then raise exception 'Active Wild territory not found'; end if;
  if exists (select 1 from public.trivia_rounds where room_id = p_room_id and status in ('scheduled','active','scoring')) then raise exception 'A Lightning Trivia round is already live in this room'; end if;
  v_starts := greatest(coalesce(p_starts_at, now() + make_interval(secs => p_countdown_seconds)), now() + interval '3 seconds');
  v_end := v_starts + make_interval(secs => (10 * p_seconds_per_question)) + interval '6.5 seconds';
  v_title := case when p_territory_key is null then 'LIGHTNING TRIVIA' else 'LIGHTNING TRIVIA — BATTLE FOR ' || upper(replace(p_territory_key, '_', ' ')) end;
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced' where room_id = p_room_id and status = 'active';
  insert into public.room_missions(room_id, created_by_identity_id, title, description, mission_type, config, status, starts_at, ends_at)
  values (p_room_id, v_identity, v_title, '10 questions. ' || p_seconds_per_question || ' seconds each. Fight for your faction.', 'lightning_trivia', '{}'::jsonb, 'draft', now(), v_end) returning * into v_mission;
  insert into public.trivia_rounds(room_id, mission_id, wild_game_id, created_by_identity_id, status, starts_at, seconds_per_question, countdown_seconds, territory_key, minimum_faction_participants, first_place_reward, second_place_reward, third_place_reward, reward_status)
  values (p_room_id, v_mission.id, p_wild_game_id, v_identity, 'scheduled', v_starts, p_seconds_per_question, p_countdown_seconds, p_territory_key, p_minimum_faction_participants, p_first_place_reward, p_second_place_reward, p_third_place_reward, case when p_wild_game_id is null then 'not_wild' else 'pending' end) returning * into v_round;
  insert into public.trivia_round_questions(round_id, source_question_id, question_order, question_text, answers, correct_answer, category, difficulty, humour)
  select v_round.id, q.id, selected.ordinality::smallint, q.question_text, q.answers, q.correct_answer, q.category, q.difficulty, q.humour
  from unnest(p_question_ids) with ordinality selected(id, ordinality) join public.trivia_questions q on q.id = selected.id;
  update public.room_missions set status = 'active', config = jsonb_build_object('round_id', v_round.id, 'wild_game_id', p_wild_game_id, 'territory_key', p_territory_key, 'question_count', 10, 'seconds_per_question', p_seconds_per_question, 'countdown_seconds', p_countdown_seconds, 'scoring_method', 'top_10_average') where id = v_mission.id;
  perform public.create_push_notification_event('mission_started', 'missions', v_mission.id, p_room_id, '⚡ LIGHTNING TRIVIA STARTING NOW', '10 questions. ' || p_seconds_per_question || ' seconds each.' || case when p_territory_key is null then '' else ' Fight for ' || initcap(replace(p_territory_key, '_', ' ')) || '.' end, jsonb_build_object('type','mission_started','roomId',p_room_id,'missionId',v_mission.id,'missionType','lightning_trivia','triviaRoundId',v_round.id));
  return v_round;
end;
$$;

notify pgrst, 'reload schema';
