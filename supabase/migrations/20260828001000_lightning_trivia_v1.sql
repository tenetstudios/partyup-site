-- PARTYUP LIGHTNING TRIVIA V1
-- A synchronized, verified Room Mission with optional Into the Wild consequences.

alter table public.room_missions drop constraint if exists room_missions_mission_type_check;
alter table public.room_missions add constraint room_missions_mission_type_check
  check (mission_type in ('generic', 'animal_pack', 'connection', 'wild_faction', 'live_node', 'lightning_trivia'));

create table public.trivia_questions (
  id uuid primary key default gen_random_uuid(),
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete restrict,
  question_text text not null check (char_length(btrim(question_text)) between 1 and 240),
  answers jsonb not null,
  correct_answer smallint not null check (correct_answer between 0 and 3),
  category text null check (category is null or char_length(category) between 1 and 60),
  difficulty text null check (difficulty is null or char_length(difficulty) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trivia_questions_four_answers check (
    jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) = 4
  )
);

create index trivia_questions_owner_status_idx
  on public.trivia_questions(created_by_identity_id, status, updated_at desc);
create unique index trivia_questions_owner_active_text_uidx
  on public.trivia_questions(created_by_identity_id, lower(btrim(question_text)))
  where status = 'active';

create table public.trivia_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  mission_id uuid not null unique references public.room_missions(id) on delete cascade,
  wild_game_id uuid null references public.wild_games(id) on delete set null,
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete restrict,
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'active', 'scoring', 'ended', 'cancelled')),
  starts_at timestamptz not null,
  question_count smallint not null default 10 check (question_count = 10),
  seconds_per_question smallint not null default 5 check (seconds_per_question between 3 and 15),
  feedback_ms smallint not null default 650 check (feedback_ms between 500 and 700),
  countdown_seconds smallint not null default 10 check (countdown_seconds between 3 and 120),
  territory_key text null,
  scoring_method text not null default 'top_10_average' check (scoring_method = 'top_10_average'),
  top_player_count smallint not null default 10 check (top_player_count = 10),
  minimum_faction_participants smallint not null default 5 check (minimum_faction_participants between 1 and 10),
  first_place_reward smallint not null default 50 check (first_place_reward between 0 and 100),
  second_place_reward smallint not null default 20 check (second_place_reward between 0 and 100),
  third_place_reward smallint not null default 10 check (third_place_reward between 0 and 100),
  standings jsonb null check (standings is null or jsonb_typeof(standings) = 'array'),
  reward_status text not null default 'pending'
    check (reward_status in ('pending', 'applied', 'not_wild', 'wild_ended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz null,
  constraint trivia_rounds_wild_target check (
    (wild_game_id is null and territory_key is null)
    or (wild_game_id is not null and territory_key is not null)
  )
);

create unique index trivia_rounds_one_live_per_room_idx
  on public.trivia_rounds(room_id)
  where status in ('scheduled', 'active', 'scoring');
create index trivia_rounds_room_created_idx on public.trivia_rounds(room_id, created_at desc);

-- Bank rows are copied here at round creation. Historical and active rounds never
-- change when the bank row is edited or archived.
create table public.trivia_round_questions (
  round_id uuid not null references public.trivia_rounds(id) on delete cascade,
  source_question_id uuid null references public.trivia_questions(id) on delete set null,
  question_order smallint not null check (question_order between 1 and 10),
  question_text text not null check (char_length(question_text) between 1 and 240),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) = 4),
  correct_answer smallint not null check (correct_answer between 0 and 3),
  category text null,
  difficulty text null,
  primary key (round_id, question_order),
  unique (round_id, source_question_id)
);

create table public.trivia_round_participants (
  round_id uuid not null references public.trivia_rounds(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  faction_key text null,
  joined_at timestamptz not null default now(),
  total_score integer not null default 0 check (total_score between 0 and 10000),
  correct_count smallint not null default 0 check (correct_count between 0 and 10),
  average_correct_response_ms integer null check (average_correct_response_ms is null or average_correct_response_ms >= 0),
  counted_for_faction boolean not null default false,
  primary key (round_id, participant_identity_id)
);

create index trivia_participants_round_faction_idx
  on public.trivia_round_participants(round_id, faction_key, total_score desc);

create table public.trivia_answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.trivia_rounds(id) on delete cascade,
  question_order smallint not null check (question_order between 1 and 10),
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  selected_answer smallint not null check (selected_answer between 0 and 3),
  answered_at timestamptz not null default now(),
  response_ms integer not null check (response_ms >= 0),
  is_correct boolean not null,
  score_awarded smallint not null check (score_awarded between 0 and 1000),
  foreign key (round_id, question_order)
    references public.trivia_round_questions(round_id, question_order) on delete cascade,
  foreign key (round_id, participant_identity_id)
    references public.trivia_round_participants(round_id, participant_identity_id) on delete cascade,
  unique (round_id, question_order, participant_identity_id)
);

create index trivia_answers_round_participant_idx
  on public.trivia_answers(round_id, participant_identity_id, question_order);

create table public.trivia_round_reward_contributions (
  round_id uuid not null references public.trivia_rounds(id) on delete cascade,
  faction_key text not null,
  placement smallint not null check (placement between 1 and 3),
  influence_amount smallint not null check (influence_amount between 1 and 100),
  wild_contribution_id uuid not null unique references public.wild_contributions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (round_id, faction_key)
);

create or replace function public.set_trivia_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trivia_questions_set_updated_at before update on public.trivia_questions
for each row execute function public.set_trivia_updated_at();
create trigger trivia_rounds_set_updated_at before update on public.trivia_rounds
for each row execute function public.set_trivia_updated_at();

create or replace function public.validate_trivia_answers(p_answers jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare v_clean jsonb; v_distinct integer;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 4 then
    raise exception 'Exactly four answers are required';
  end if;
  select jsonb_agg(btrim(value) order by ordinal), count(distinct lower(btrim(value)))
  into v_clean, v_distinct
  from jsonb_array_elements_text(p_answers) with ordinality item(value, ordinal)
  where char_length(btrim(value)) between 1 and 100;
  if jsonb_array_length(coalesce(v_clean, '[]'::jsonb)) <> 4 then
    raise exception 'Each answer must be 1 to 100 characters';
  end if;
  if v_distinct <> 4 then raise exception 'Answer choices must be unique'; end if;
  return v_clean;
end;
$$;

create or replace function public.upsert_trivia_question(
  p_room_id uuid, p_question_text text, p_answers jsonb, p_correct_answer smallint,
  p_category text default null, p_difficulty text default null, p_question_id uuid default null
)
returns public.trivia_questions
language plpgsql security definer set search_path = public
as $$
declare v_identity uuid; v_row public.trivia_questions; v_answers jsonb;
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then
    raise exception 'Host or administrator access required';
  end if;
  v_identity := public.current_partyup_identity_id();
  if v_identity is null then raise exception 'PartyUp identity required'; end if;
  if char_length(btrim(coalesce(p_question_text, ''))) not between 1 and 240 then
    raise exception 'Question must be 1 to 240 characters';
  end if;
  if p_correct_answer is null or p_correct_answer not between 0 and 3 then raise exception 'Choose one correct answer'; end if;
  v_answers := public.validate_trivia_answers(p_answers);
  if p_question_id is null then
    insert into public.trivia_questions(created_by_identity_id, question_text, answers, correct_answer, category, difficulty)
    values (v_identity, btrim(p_question_text), v_answers, p_correct_answer,
      case when lower(btrim(coalesce(p_category, ''))) in ('', 'uncategorized') then null else left(btrim(p_category), 60) end,
      nullif(left(btrim(coalesce(p_difficulty, '')), 40), '')) returning * into v_row;
  else
    update public.trivia_questions set question_text = btrim(p_question_text), answers = v_answers,
      correct_answer = p_correct_answer,
      category = case when lower(btrim(coalesce(p_category, ''))) in ('', 'uncategorized') then null else left(btrim(p_category), 60) end,
      difficulty = nullif(left(btrim(coalesce(p_difficulty, '')), 40), '')
    where id = p_question_id and (created_by_identity_id = v_identity or public.is_site_admin())
      and status = 'active' returning * into v_row;
    if not found then raise exception 'Question not found or not editable'; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.import_trivia_questions(p_room_id uuid, p_questions jsonb)
returns setof public.trivia_questions
language plpgsql security definer set search_path = public as $$
declare
  v_identity uuid := public.current_partyup_identity_id();
  v_item jsonb; v_question text; v_answers jsonb; v_correct smallint;
  v_category text; v_difficulty text; v_row public.trivia_questions;
  v_seen_questions text[] := array[]::text[];
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then
    raise exception 'Host or administrator access required';
  end if;
  if v_identity is null then raise exception 'PartyUp identity required'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 100 then
    raise exception 'Import between 1 and 100 questions';
  end if;

  for v_item in select value from jsonb_array_elements(p_questions) item(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Every imported question must be an object'; end if;
    v_question := btrim(coalesce(v_item->>'question_text', ''));
    if char_length(v_question) not between 1 and 240 then raise exception 'Every question must be 1 to 240 characters'; end if;
    if lower(v_question) = any(v_seen_questions) then raise exception 'Duplicate question in import: %', v_question; end if;
    v_seen_questions := array_append(v_seen_questions, lower(v_question));
    if exists (
      select 1 from public.trivia_questions existing
      where existing.status = 'active' and lower(btrim(existing.question_text)) = lower(v_question)
        and (existing.created_by_identity_id = v_identity or public.is_site_admin())
    ) then raise exception 'Question already exists: %', v_question; end if;

    v_answers := public.validate_trivia_answers(v_item->'answers');
    begin v_correct := (v_item->>'correct_answer')::smallint;
    exception when invalid_text_representation then raise exception 'Every question needs one correct answer'; end;
    if v_correct is null or v_correct not between 0 and 3 then raise exception 'Every question needs one correct answer'; end if;
    v_category := btrim(coalesce(v_item->>'category', ''));
    if lower(v_category) in ('', 'uncategorized') then v_category := null; end if;
    if v_category is not null and char_length(v_category) > 60 then raise exception 'Category is too long'; end if;
    v_difficulty := nullif(btrim(coalesce(v_item->>'difficulty', '')), '');
    if v_difficulty is not null and char_length(v_difficulty) > 40 then raise exception 'Difficulty is too long'; end if;

    insert into public.trivia_questions(
      created_by_identity_id, question_text, answers, correct_answer, category, difficulty
    ) values (
      v_identity, v_question, v_answers, v_correct, v_category, v_difficulty
    ) returning * into v_row;
    return next v_row;
  end loop;
  return;
end;
$$;

create or replace function public.archive_trivia_question(p_room_id uuid, p_question_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_identity uuid := public.current_partyup_identity_id();
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then
    raise exception 'Host or administrator access required';
  end if;
  update public.trivia_questions set status = 'archived'
  where id = p_question_id and (created_by_identity_id = v_identity or public.is_site_admin());
  return found;
end;
$$;

create or replace function public.get_trivia_question_bank(p_room_id uuid, p_search text default null)
returns setof public.trivia_questions
language plpgsql stable security definer set search_path = public as $$
declare v_identity uuid := public.current_partyup_identity_id(); v_search text := lower(btrim(coalesce(p_search, '')));
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then
    raise exception 'Host or administrator access required';
  end if;
  return query select q.* from public.trivia_questions q
  where q.status = 'active' and (q.created_by_identity_id = v_identity or public.is_site_admin())
    and (v_search = '' or lower(q.question_text) like '%' || v_search || '%'
      or lower(coalesce(q.category, '')) like '%' || v_search || '%')
  order by q.updated_at desc;
end;
$$;

create or replace function public.create_lightning_trivia_round(
  p_room_id uuid, p_question_ids uuid[], p_starts_at timestamptz default null,
  p_seconds_per_question integer default 5, p_countdown_seconds integer default 10,
  p_wild_game_id uuid default null, p_territory_key text default null,
  p_minimum_faction_participants integer default 5,
  p_first_place_reward integer default 50, p_second_place_reward integer default 20,
  p_third_place_reward integer default 10
)
returns public.trivia_rounds
language plpgsql security definer set search_path = public
as $$
declare
  v_identity uuid; v_round public.trivia_rounds; v_mission public.room_missions;
  v_starts timestamptz; v_end timestamptz; v_count integer; v_title text;
begin
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can launch trivia'; end if;
  v_identity := public.current_partyup_identity_id();
  perform 1 from public.event_rooms where id = p_room_id and status::text <> 'ended' for share;
  if not found then raise exception 'Room is missing or ended'; end if;
  if coalesce(array_length(p_question_ids, 1), 0) <> 10
     or (select count(distinct value) from unnest(p_question_ids) item(value)) <> 10 then
    raise exception 'Select exactly 10 different questions';
  end if;
  select count(*) into v_count from public.trivia_questions q
  where q.id = any(p_question_ids) and q.status = 'active'
    and (q.created_by_identity_id = v_identity or public.is_site_admin());
  if v_count <> 10 then raise exception 'Every selected question must be active'; end if;
  if p_seconds_per_question not between 3 and 15 then raise exception 'Question time must be 3 to 15 seconds'; end if;
  if p_countdown_seconds not between 3 and 120 then raise exception 'Countdown must be 3 to 120 seconds'; end if;
  if p_minimum_faction_participants not between 1 and 10 then raise exception 'Minimum faction players must be 1 to 10'; end if;
  if p_first_place_reward not between 0 and 100 or p_second_place_reward not between 0 and 100
     or p_third_place_reward not between 0 and 100 then raise exception 'Rewards must be 0 to 100'; end if;
  if (p_wild_game_id is null) <> (p_territory_key is null) then raise exception 'Wild game and territory must be selected together'; end if;
  if p_wild_game_id is not null and not exists (
    select 1 from public.wild_games game join public.wild_territories territory on territory.game_id = game.id
    where game.id = p_wild_game_id and game.room_id = p_room_id and game.status = 'active'
      and territory.territory_key = p_territory_key
  ) then raise exception 'Active Wild territory not found'; end if;
  if exists (select 1 from public.trivia_rounds where room_id = p_room_id and status in ('scheduled','active','scoring')) then
    raise exception 'A Lightning Trivia round is already live in this room';
  end if;
  v_starts := greatest(coalesce(p_starts_at, now() + make_interval(secs => p_countdown_seconds)), now() + interval '3 seconds');
  v_end := v_starts + make_interval(secs => (10 * p_seconds_per_question)) + interval '6.5 seconds';
  v_title := case when p_territory_key is null then 'LIGHTNING TRIVIA'
    else 'LIGHTNING TRIVIA — BATTLE FOR ' || upper(replace(p_territory_key, '_', ' ')) end;

  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced'
  where room_id = p_room_id and status = 'active';
  insert into public.room_missions(room_id, created_by_identity_id, title, description, mission_type, config,
    status, starts_at, ends_at)
  values (p_room_id, v_identity, v_title, '10 questions. 5 seconds each. Fight for your faction.',
    'lightning_trivia', '{}'::jsonb, 'draft', now(), v_end) returning * into v_mission;
  insert into public.trivia_rounds(room_id, mission_id, wild_game_id, created_by_identity_id, status,
    starts_at, seconds_per_question, countdown_seconds, territory_key, minimum_faction_participants,
    first_place_reward, second_place_reward, third_place_reward,
    reward_status)
  values (p_room_id, v_mission.id, p_wild_game_id, v_identity, 'scheduled', v_starts,
    p_seconds_per_question, p_countdown_seconds, p_territory_key, p_minimum_faction_participants,
    p_first_place_reward, p_second_place_reward, p_third_place_reward,
    case when p_wild_game_id is null then 'not_wild' else 'pending' end)
  returning * into v_round;
  insert into public.trivia_round_questions(round_id, source_question_id, question_order,
    question_text, answers, correct_answer, category, difficulty)
  select v_round.id, q.id, selected.ordinality::smallint, q.question_text, q.answers,
    q.correct_answer, q.category, q.difficulty
  from unnest(p_question_ids) with ordinality selected(id, ordinality)
  join public.trivia_questions q on q.id = selected.id;
  update public.room_missions set status = 'active', config = jsonb_build_object(
    'round_id', v_round.id, 'wild_game_id', p_wild_game_id, 'territory_key', p_territory_key,
    'question_count', 10, 'seconds_per_question', p_seconds_per_question,
    'countdown_seconds', p_countdown_seconds, 'scoring_method', 'top_10_average')
  where id = v_mission.id;
  perform public.create_push_notification_event(
    'mission_started', 'missions', v_mission.id, p_room_id,
    '⚡ LIGHTNING TRIVIA STARTING NOW',
    '10 questions. ' || p_seconds_per_question || ' seconds each.' ||
      case when p_territory_key is null then '' else ' Fight for ' || initcap(replace(p_territory_key, '_', ' ')) || '.' end,
    jsonb_build_object('type','mission_started','roomId',p_room_id,'missionId',v_mission.id,
      'missionType','lightning_trivia','triviaRoundId',v_round.id)
  );
  return v_round;
end;
$$;

create or replace function public.join_lightning_trivia_round(p_round_id uuid, p_guest_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_round public.trivia_rounds; v_identity uuid; v_faction text;
begin
  v_identity := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_round from public.trivia_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if now() >= v_round.starts_at or v_round.status <> 'scheduled' then
    raise exception 'Joining closed when the round started';
  end if;
  if not public.can_identity_participate_in_mission_room(v_round.room_id, v_identity) then
    raise exception 'Join the room before joining trivia';
  end if;
  if v_round.wild_game_id is not null then
    select faction_key into v_faction from public.wild_faction_assignments
    where game_id = v_round.wild_game_id and participant_identity_id = v_identity;
  end if;
  insert into public.trivia_round_participants(round_id, participant_identity_id, faction_key)
  values (v_round.id, v_identity, v_faction) on conflict do nothing;
  return jsonb_build_object('round_id', v_round.id, 'joined', true, 'faction_key', v_faction,
    'counts_for_wild', v_faction is not null);
end;
$$;

create or replace function public.submit_lightning_trivia_answer(
  p_round_id uuid, p_question_order integer, p_selected_answer integer, p_guest_token text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round public.trivia_rounds; v_question public.trivia_round_questions; v_identity uuid;
  v_question_start timestamptz; v_deadline timestamptz; v_response integer; v_correct boolean;
  v_score integer; v_remaining numeric;
begin
  v_identity := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_round from public.trivia_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status = 'scheduled' and now() >= v_round.starts_at then
    update public.trivia_rounds set status = 'active' where id = v_round.id;
    v_round.status := 'active';
  end if;
  if v_round.status <> 'active' then raise exception 'Round is not accepting answers'; end if;
  if not exists (select 1 from public.trivia_round_participants where round_id = v_round.id
    and participant_identity_id = v_identity) then raise exception 'You did not join before the round started'; end if;
  if p_question_order not between 1 and 10 or p_selected_answer not between 0 and 3 then
    raise exception 'Invalid answer';
  end if;
  select * into v_question from public.trivia_round_questions
  where round_id = v_round.id and question_order = p_question_order;
  v_question_start := v_round.starts_at + make_interval(secs =>
    (p_question_order - 1) * v_round.seconds_per_question)
    + ((p_question_order - 1) * v_round.feedback_ms) * interval '1 millisecond';
  v_deadline := v_question_start + make_interval(secs => v_round.seconds_per_question);
  if now() < v_question_start then raise exception 'Question has not started'; end if;
  if now() > v_deadline then raise exception 'Time is up'; end if;
  v_response := greatest(0, floor(extract(epoch from (clock_timestamp() - v_question_start)) * 1000)::integer);
  v_correct := p_selected_answer = v_question.correct_answer;
  if v_correct then
    v_remaining := greatest(0, 1 - (v_response::numeric / (v_round.seconds_per_question * 1000)));
    v_score := least(1000, 750 + round(250 * power(v_remaining, 1.1))::integer);
  else v_score := 0; end if;
  insert into public.trivia_answers(round_id, question_order, participant_identity_id,
    selected_answer, response_ms, is_correct, score_awarded)
  values (v_round.id, p_question_order, v_identity, p_selected_answer,
    v_response, v_correct, v_score);
  return jsonb_build_object('correct', v_correct, 'score_awarded', v_score,
    'response_ms', v_response, 'locked', true);
exception when unique_violation then
  raise exception 'Answer already locked';
end;
$$;

create or replace function public.finalize_lightning_trivia_round(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round public.trivia_rounds; v_last_end timestamptz; v_standings jsonb := '[]'::jsonb;
  v_wild_active boolean := false; v_territory public.wild_territories; v_entry jsonb;
  v_faction text; v_place integer; v_reward integer; v_identity uuid; v_contribution public.wild_contributions;
  v_current integer; v_max integer; v_top_count integer; v_controller text;
begin
  select * into v_round from public.trivia_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status = 'ended' then return jsonb_build_object('status','ended','standings',v_round.standings,'reward_status',v_round.reward_status); end if;
  v_last_end := v_round.starts_at + make_interval(secs => 10 * v_round.seconds_per_question)
    + (10 * v_round.feedback_ms) * interval '1 millisecond';
  if now() < v_last_end then raise exception 'Round is still active'; end if;
  update public.trivia_rounds set status = 'scoring' where id = v_round.id;

  update public.trivia_round_participants participant set
    total_score = stats.total_score, correct_count = stats.correct_count,
    average_correct_response_ms = stats.average_response
  from (
    select participant_identity_id, coalesce(sum(score_awarded),0)::integer total_score,
      count(*) filter (where is_correct)::integer correct_count,
      round(avg(response_ms) filter (where is_correct))::integer average_response
    from public.trivia_answers where round_id = v_round.id group by participant_identity_id
  ) stats
  where participant.round_id = v_round.id and participant.participant_identity_id = stats.participant_identity_id;

  with ranked as (
    select participant_identity_id, faction_key,
      row_number() over (partition by faction_key order by total_score desc, correct_count desc,
        average_correct_response_ms asc nulls last, participant_identity_id) as player_rank
    from public.trivia_round_participants participant
    where round_id = v_round.id and faction_key is not null
      and exists (select 1 from public.trivia_answers answer where answer.round_id = v_round.id
        and answer.participant_identity_id = participant.participant_identity_id)
  )
  update public.trivia_round_participants participant set counted_for_faction = ranked.player_rank <= v_round.top_player_count
  from ranked where participant.round_id = v_round.id
    and participant.participant_identity_id = ranked.participant_identity_id;

  with faction_keys as (
    select faction.value->>'key' as faction_key
    from public.wild_games game, jsonb_array_elements(game.config->'factions') faction(value)
    where game.id = v_round.wild_game_id
    union
    select distinct faction_key from public.trivia_round_participants
    where round_id = v_round.id and faction_key is not null
  ), faction_stats as (
    select key_row.faction_key,
      count(participant.participant_identity_id)::integer participant_count,
      count(participant.participant_identity_id) filter (where participant.counted_for_faction)::integer counted_count,
      round(avg(participant.total_score) filter (where participant.counted_for_faction))::integer average_score,
      coalesce(sum(participant.correct_count) filter (where participant.counted_for_faction),0)::integer counted_correct,
      round(avg(participant.average_correct_response_ms) filter (where participant.counted_for_faction and participant.correct_count > 0))::integer average_response
    from faction_keys key_row
    left join public.trivia_round_participants participant
      on participant.round_id = v_round.id and participant.faction_key = key_row.faction_key
      and exists (select 1 from public.trivia_answers answer where answer.round_id = v_round.id
        and answer.participant_identity_id = participant.participant_identity_id)
    group by key_row.faction_key
  ), eligible_ranked as (
    select *, case when participant_count >= v_round.minimum_faction_participants then
      rank() over (order by
        case when participant_count >= v_round.minimum_faction_participants then average_score end desc nulls last,
        case when participant_count >= v_round.minimum_faction_participants then counted_correct end desc nulls last,
        case when participant_count >= v_round.minimum_faction_participants then average_response end asc nulls last)
      else null end as placement
    from faction_stats
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'faction_key', faction_key, 'participant_count', participant_count, 'counted_count', counted_count,
    'average_score', average_score, 'counted_correct_answers', counted_correct,
    'average_correct_response_ms', average_response,
    'eligible', participant_count >= v_round.minimum_faction_participants,
    'placement', placement) order by placement nulls last, average_score desc), '[]'::jsonb)
  into v_standings from eligible_ranked;

  v_wild_active := v_round.wild_game_id is not null and exists (
    select 1 from public.wild_games game join public.event_rooms room on room.id = game.room_id
    where game.id = v_round.wild_game_id and game.status = 'active' and room.status::text <> 'ended');
  if v_wild_active then
    select * into v_territory from public.wild_territories
    where game_id = v_round.wild_game_id and territory_key = v_round.territory_key for update;
    for v_entry in select value from jsonb_array_elements(v_standings) item(value)
    loop
      v_place := (v_entry->>'placement')::integer;
      if coalesce((v_entry->>'eligible')::boolean, false) and v_place between 1 and 3 then
        v_faction := v_entry->>'faction_key';
        v_reward := case v_place when 1 then v_round.first_place_reward when 2 then v_round.second_place_reward else v_round.third_place_reward end;
        if v_reward > 0 and not exists (select 1 from public.trivia_round_reward_contributions
          where round_id = v_round.id and faction_key = v_faction) then
          select participant_identity_id into v_identity from public.trivia_round_participants
          where round_id = v_round.id and faction_key = v_faction and counted_for_faction
          order by total_score desc, correct_count desc, average_correct_response_ms asc nulls last limit 1;
          insert into public.wild_contributions(game_id, participant_identity_id, faction_key,
            territory_key, mission_id, influence_amount)
          values (v_round.wild_game_id, v_identity, v_faction, v_round.territory_key,
            v_round.mission_id, v_reward) returning * into v_contribution;
          insert into public.trivia_round_reward_contributions(round_id, faction_key, placement,
            influence_amount, wild_contribution_id)
          values (v_round.id, v_faction, v_place, v_reward, v_contribution.id);
          v_current := coalesce((v_territory.influence->>v_faction)::integer, 0);
          v_territory.influence := jsonb_set(v_territory.influence, array[v_faction], to_jsonb(v_current + v_reward), true);
        end if;
      end if;
    end loop;
    select max(value::integer) into v_max from jsonb_each_text(v_territory.influence);
    select count(*)::integer into v_top_count from jsonb_each_text(v_territory.influence) where value::integer = v_max;
    if v_top_count = 1 then select key into v_controller from jsonb_each_text(v_territory.influence)
      where value::integer = v_max limit 1; else v_controller := null; end if;
    update public.wild_territories set influence = v_territory.influence, controlling_faction = v_controller
    where id = v_territory.id;
  end if;
  update public.trivia_rounds set status = 'ended', standings = v_standings, ended_at = now(),
    reward_status = case when wild_game_id is null then 'not_wild' when v_wild_active then 'applied' else 'wild_ended' end
  where id = v_round.id returning * into v_round;
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'expired'
  where id = v_round.mission_id and status <> 'ended';
  return jsonb_build_object('status','ended','standings',v_standings,'reward_status',v_round.reward_status);
end;
$$;

create or replace function public.cancel_lightning_trivia_round(p_round_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_round public.trivia_rounds;
begin
  select * into v_round from public.trivia_rounds where id = p_round_id for update;
  if not found or not public.is_room_host(v_round.room_id) then raise exception 'Round not found or host access required'; end if;
  if v_round.status <> 'scheduled' or now() >= v_round.starts_at then raise exception 'Only a pre-start round can be cancelled'; end if;
  update public.trivia_rounds set status = 'cancelled', ended_at = now(), reward_status = 'cancelled' where id = v_round.id;
  update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'manual'
  where id = v_round.mission_id and status <> 'ended';
  return true;
end;
$$;

create or replace function public.get_room_lightning_trivia(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_round public.trivia_rounds;
begin
  select * into v_round from public.trivia_rounds where room_id = p_room_id
    and status in ('scheduled','active','scoring','ended') order by created_at desc limit 1;
  if not found then return null; end if;
  if v_round.status in ('scheduled','active') and now() >= v_round.starts_at
    + make_interval(secs => 10 * v_round.seconds_per_question)
    + (10 * v_round.feedback_ms) * interval '1 millisecond' then
    perform public.finalize_lightning_trivia_round(v_round.id);
    select * into v_round from public.trivia_rounds where id = v_round.id;
  elsif v_round.status = 'scheduled' and now() >= v_round.starts_at then
    update public.trivia_rounds set status = 'active' where id = v_round.id returning * into v_round;
  end if;
  return jsonb_build_object('id',v_round.id,'room_id',v_round.room_id,'status',v_round.status,
    'starts_at',v_round.starts_at,'question_count',10,'seconds_per_question',v_round.seconds_per_question,
    'feedback_ms',v_round.feedback_ms,'territory_key',v_round.territory_key,
    'participant_count',(select count(*) from public.trivia_round_participants where round_id = v_round.id),
    'standings',v_round.standings,'reward_status',v_round.reward_status);
end;
$$;

create or replace function public.get_lightning_trivia_player_state(p_round_id uuid, p_guest_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_round public.trivia_rounds; v_identity uuid; v_joined boolean; v_result jsonb; v_participant public.trivia_round_participants;
begin
  v_identity := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_round from public.trivia_rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status in ('scheduled','active') and now() >= v_round.starts_at
    + make_interval(secs => 10 * v_round.seconds_per_question)
    + (10 * v_round.feedback_ms) * interval '1 millisecond' then
    perform public.finalize_lightning_trivia_round(v_round.id);
    select * into v_round from public.trivia_rounds where id = p_round_id;
  elsif v_round.status = 'scheduled' and now() >= v_round.starts_at then
    update public.trivia_rounds set status = 'active' where id = v_round.id returning * into v_round;
  end if;
  select * into v_participant from public.trivia_round_participants
    where round_id = v_round.id and participant_identity_id = v_identity;
  v_joined := found;
  select coalesce(jsonb_agg(jsonb_build_object('question_order',q.question_order,
    'question_text',q.question_text,'answers',q.answers,'category',q.category) order by q.question_order),'[]'::jsonb)
    into v_result from public.trivia_round_questions q where q.round_id = v_round.id;
  return jsonb_build_object(
    'round', jsonb_build_object('id',v_round.id,'room_id',v_round.room_id,'status',v_round.status,
      'starts_at',v_round.starts_at,'seconds_per_question',v_round.seconds_per_question,
      'feedback_ms',v_round.feedback_ms,'question_count',10,'territory_key',v_round.territory_key,
      'minimum_faction_participants',v_round.minimum_faction_participants,'standings',v_round.standings,
      'reward_status',v_round.reward_status),
    'joined',v_joined,'faction_key',v_participant.faction_key,'questions',v_result,
    'answers',(select coalesce(jsonb_agg(jsonb_build_object('question_order',a.question_order,
      'selected_answer',a.selected_answer,'is_correct',a.is_correct,'score_awarded',a.score_awarded,
      'response_ms',a.response_ms) order by a.question_order),'[]'::jsonb) from public.trivia_answers a
      where a.round_id = v_round.id and a.participant_identity_id = v_identity),
    'player_result', case when v_round.status = 'ended' and v_joined then jsonb_build_object(
      'total_score',v_participant.total_score,'correct_count',v_participant.correct_count,
      'average_correct_response_ms',v_participant.average_correct_response_ms,
      'counted_for_faction',v_participant.counted_for_faction) else null end);
end;
$$;

create or replace function public.get_lightning_trivia_host_rounds(p_room_id uuid)
returns setof public.trivia_rounds language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then raise exception 'Host access required'; end if;
  return query select * from public.trivia_rounds where room_id = p_room_id order by created_at desc limit 20;
end;
$$;

create or replace function public.cancel_trivia_when_room_ends()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'ended' and old.status::text <> 'ended' then
    update public.trivia_rounds set status = 'cancelled', ended_at = now(), reward_status = 'cancelled'
    where room_id = new.id and status in ('scheduled','active','scoring');
  end if;
  return new;
end;
$$;
create trigger event_rooms_cancel_trivia after update of status on public.event_rooms
for each row execute function public.cancel_trivia_when_room_ends();

alter table public.trivia_questions enable row level security;
alter table public.trivia_rounds enable row level security;
alter table public.trivia_round_questions enable row level security;
alter table public.trivia_round_participants enable row level security;
alter table public.trivia_answers enable row level security;
alter table public.trivia_round_reward_contributions enable row level security;

revoke all on public.trivia_questions, public.trivia_round_questions, public.trivia_round_participants,
  public.trivia_answers, public.trivia_round_reward_contributions from anon, authenticated;
revoke all on public.trivia_rounds from anon, authenticated;
grant select on public.trivia_rounds to anon, authenticated;
create policy trivia_rounds_room_visibility on public.trivia_rounds for select to anon, authenticated
using (exists (select 1 from public.event_rooms room where room.id = trivia_rounds.room_id));

revoke all on function public.upsert_trivia_question(uuid,text,jsonb,smallint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.archive_trivia_question(uuid,uuid) from public, anon, authenticated;
revoke all on function public.import_trivia_questions(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.get_trivia_question_bank(uuid,text) from public, anon, authenticated;
revoke all on function public.create_lightning_trivia_round(uuid,uuid[],timestamptz,integer,integer,uuid,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.cancel_lightning_trivia_round(uuid) from public, anon, authenticated;
revoke all on function public.get_lightning_trivia_host_rounds(uuid) from public, anon, authenticated;
grant execute on function public.upsert_trivia_question(uuid,text,jsonb,smallint,text,text,uuid) to authenticated;
grant execute on function public.archive_trivia_question(uuid,uuid) to authenticated;
grant execute on function public.import_trivia_questions(uuid,jsonb) to authenticated;
grant execute on function public.get_trivia_question_bank(uuid,text) to authenticated;
grant execute on function public.create_lightning_trivia_round(uuid,uuid[],timestamptz,integer,integer,uuid,text,integer,integer,integer,integer) to authenticated;
grant execute on function public.cancel_lightning_trivia_round(uuid) to authenticated;
grant execute on function public.get_lightning_trivia_host_rounds(uuid) to authenticated;

revoke all on function public.join_lightning_trivia_round(uuid,text) from public, anon, authenticated;
revoke all on function public.submit_lightning_trivia_answer(uuid,integer,integer,text) from public, anon, authenticated;
revoke all on function public.get_lightning_trivia_player_state(uuid,text) from public, anon, authenticated;
revoke all on function public.get_room_lightning_trivia(uuid) from public, anon, authenticated;
revoke all on function public.finalize_lightning_trivia_round(uuid) from public, anon, authenticated;
grant execute on function public.join_lightning_trivia_round(uuid,text) to anon, authenticated;
grant execute on function public.submit_lightning_trivia_answer(uuid,integer,integer,text) to anon, authenticated;
grant execute on function public.get_lightning_trivia_player_state(uuid,text) to anon, authenticated;
grant execute on function public.get_room_lightning_trivia(uuid) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trivia_rounds;
  end if;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
