-- PARTYUP CENTRAL TRIVIA QUESTION BANK
-- Refactors the existing V1 per-host bank without changing live/historical round data.

create extension if not exists pg_trgm;

alter table public.trivia_questions
  add column if not exists bank_scope text not null default 'custom',
  add column if not exists humour boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists answer_a text generated always as (answers ->> 0) stored,
  add column if not exists answer_b text generated always as (answers ->> 1) stored,
  add column if not exists answer_c text generated always as (answers ->> 2) stored,
  add column if not exists answer_d text generated always as (answers ->> 3) stored,
  add column if not exists correct_answer_key text generated always as (chr(65 + correct_answer)) stored;

alter table public.trivia_questions drop constraint if exists trivia_questions_bank_scope_check;
alter table public.trivia_questions add constraint trivia_questions_bank_scope_check
  check (bank_scope in ('partyup', 'custom'));

update public.trivia_questions
set difficulty = case lower(replace(btrim(coalesce(difficulty, '')), ' ', '_'))
    when 'very_easy' then 'very_easy'
    when 'easy' then 'easy'
    when 'medium' then 'medium'
    when 'hard' then 'hard'
    else 'medium'
  end,
  category = case lower(replace(replace(btrim(coalesce(category, '')), '&', 'and'), ' ', '_'))
    when 'humour' then 'humour'
    when 'humor' then 'humour'
    when 'music' then 'music'
    when 'movies_tv' then 'movies_tv'
    when 'movies_and_tv' then 'movies_tv'
    when 'pop_culture' then 'pop_culture'
    when 'sports' then 'sports'
    when 'geography' then 'geography'
    when 'science_nature' then 'science_nature'
    when 'science_and_nature' then 'science_nature'
    when 'history' then 'history'
    when 'food_drink' then 'food_drink'
    when 'food_and_drink' then 'food_drink'
    when 'internet_gaming' then 'internet_gaming'
    when 'internet_and_gaming' then 'internet_gaming'
    when 'general_knowledge' then 'general_knowledge'
    else 'general_knowledge'
  end,
  is_active = status = 'active';

alter table public.trivia_questions alter column category set not null;
alter table public.trivia_questions alter column category set default 'general_knowledge';
alter table public.trivia_questions alter column difficulty set not null;
alter table public.trivia_questions alter column difficulty set default 'medium';
alter table public.trivia_questions drop constraint if exists trivia_questions_category_check;
alter table public.trivia_questions add constraint trivia_questions_category_check check (category in (
  'humour','music','movies_tv','pop_culture','sports','geography','science_nature','history',
  'food_drink','internet_gaming','general_knowledge'
));
alter table public.trivia_questions drop constraint if exists trivia_questions_difficulty_check;
alter table public.trivia_questions add constraint trivia_questions_difficulty_check
  check (difficulty in ('very_easy','easy','medium','hard'));
alter table public.trivia_questions drop constraint if exists trivia_questions_active_status_check;
alter table public.trivia_questions add constraint trivia_questions_active_status_check
  check (is_active = (status = 'active'));

create or replace function public.sync_trivia_question_active_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := case when new.is_active then 'active' else 'archived' end;
  elsif new.is_active is distinct from old.is_active and new.status is not distinct from old.status then
    new.status := case when new.is_active then 'active' else 'archived' end;
  elsif new.status is distinct from old.status then
    new.is_active := new.status = 'active';
  end if;
  return new;
end;
$$;
drop trigger if exists trivia_questions_sync_active_status on public.trivia_questions;
create trigger trivia_questions_sync_active_status before insert or update on public.trivia_questions
for each row execute function public.sync_trivia_question_active_status();

create unique index if not exists trivia_questions_partyup_text_uidx
  on public.trivia_questions(lower(btrim(question_text))) where bank_scope = 'partyup';
create index if not exists trivia_questions_picker_idx
  on public.trivia_questions(bank_scope, is_active, category, difficulty, humour, updated_at desc);
create index if not exists trivia_questions_search_trgm_idx
  on public.trivia_questions using gin (
    lower(question_text || ' ' || answers::text || ' ' || category) gin_trgm_ops
  );

alter table public.trivia_round_questions add column if not exists humour boolean not null default false;

drop function if exists public.get_trivia_question_bank(uuid, text);
drop function if exists public.get_trivia_question_bank(uuid, text, text, text, boolean, integer);
create function public.get_trivia_question_bank(
  p_room_id uuid,
  p_search text default null,
  p_category text default null,
  p_difficulty text default null,
  p_humour boolean default null,
  p_limit integer default 250
)
returns table (
  id uuid, question_text text, answers jsonb, correct_answer smallint, correct_answer_key text,
  category text, difficulty text, humour boolean, is_active boolean, status text,
  bank_scope text, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_identity uuid := public.current_partyup_identity_id();
  v_search text := left(lower(btrim(coalesce(p_search, ''))), 120);
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  v_difficulty text := nullif(lower(btrim(coalesce(p_difficulty, ''))), '');
begin
  if not public.is_room_host(p_room_id) and not public.is_site_admin() then
    raise exception 'Host or administrator access required';
  end if;
  return query
  select q.id, q.question_text, q.answers, q.correct_answer, q.correct_answer_key,
    q.category, q.difficulty, q.humour, q.is_active, q.status, q.bank_scope, q.updated_at
  from public.trivia_questions q
  where q.is_active
    and (q.bank_scope = 'partyup' or (q.bank_scope = 'custom' and q.created_by_identity_id = v_identity))
    and (v_category is null or q.category = v_category)
    and (v_difficulty is null or q.difficulty = v_difficulty)
    and (p_humour is null or q.humour = p_humour)
    and (v_search = '' or lower(q.question_text || ' ' || q.answers::text || ' ' || q.category) like '%' || v_search || '%')
  order by case when q.bank_scope = 'partyup' then 0 else 1 end, q.updated_at desc
  limit least(greatest(coalesce(p_limit, 250), 1), 500);
end;
$$;

create or replace function public.upsert_trivia_question(
  p_room_id uuid, p_question_text text, p_answers jsonb, p_correct_answer smallint,
  p_category text default null, p_difficulty text default null, p_question_id uuid default null
)
returns public.trivia_questions
language plpgsql security definer set search_path = public as $$
declare
  v_identity uuid := public.current_partyup_identity_id();
  v_row public.trivia_questions;
  v_answers jsonb := public.validate_trivia_answers(p_answers);
  v_category text := lower(btrim(coalesce(p_category, 'general_knowledge')));
  v_difficulty text := lower(btrim(coalesce(p_difficulty, 'medium')));
begin
  if not public.is_room_host(p_room_id) then raise exception 'Room host access required'; end if;
  if v_identity is null then raise exception 'PartyUp identity required'; end if;
  if char_length(btrim(coalesce(p_question_text, ''))) not between 1 and 240 then raise exception 'Question must be 1 to 240 characters'; end if;
  if p_correct_answer is null or p_correct_answer not between 0 and 3 then raise exception 'Choose one correct answer'; end if;
  if v_category not in ('humour','music','movies_tv','pop_culture','sports','geography','science_nature','history','food_drink','internet_gaming','general_knowledge') then raise exception 'Invalid trivia category'; end if;
  if v_difficulty not in ('very_easy','easy','medium','hard') then raise exception 'Invalid trivia difficulty'; end if;
  if p_question_id is null then
    insert into public.trivia_questions(created_by_identity_id, question_text, answers, correct_answer, category, difficulty, bank_scope)
    values (v_identity, btrim(p_question_text), v_answers, p_correct_answer, v_category, v_difficulty, 'custom') returning * into v_row;
  else
    update public.trivia_questions set question_text = btrim(p_question_text), answers = v_answers,
      correct_answer = p_correct_answer, category = v_category, difficulty = v_difficulty
    where id = p_question_id and bank_scope = 'custom' and created_by_identity_id = v_identity and is_active
    returning * into v_row;
    if not found then raise exception 'Custom question not found or not editable'; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.archive_trivia_question(p_room_id uuid, p_question_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_identity uuid := public.current_partyup_identity_id();
begin
  if not public.is_room_host(p_room_id) then raise exception 'Room host access required'; end if;
  update public.trivia_questions set is_active = false
  where id = p_question_id and bank_scope = 'custom' and created_by_identity_id = v_identity;
  return found;
end;
$$;

create or replace function public.generate_trivia_question_ids(
  p_room_id uuid,
  p_category text default null,
  p_difficulty text default null
)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare
  v_ids uuid[] := array[]::uuid[];
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  v_difficulty text := nullif(lower(btrim(coalesce(p_difficulty, ''))), '');
  v_identity uuid := public.current_partyup_identity_id();
begin
  if not public.is_room_host(p_room_id) then raise exception 'Room host access required'; end if;
  if v_category is not null or v_difficulty is not null then
    select coalesce(array_agg(candidate.id), array[]::uuid[]) into v_ids from (
      select q.id from public.trivia_questions q
      where q.is_active and q.bank_scope = 'partyup'
        and (v_category is null or q.category = v_category)
        and (v_difficulty is null or q.difficulty = v_difficulty)
      order by random() limit 10
    ) candidate;
  else
    select coalesce(array_agg(candidate.id), array[]::uuid[]) into v_ids from (
      (select q.id from public.trivia_questions q where q.is_active and q.bank_scope = 'partyup' and q.difficulty = 'very_easy' order by random() limit 3)
      union all
      (select q.id from public.trivia_questions q where q.is_active and q.bank_scope = 'partyup' and q.difficulty = 'easy' order by random() limit 4)
      union all
      (select q.id from public.trivia_questions q where q.is_active and q.bank_scope = 'partyup' and q.difficulty = 'medium' order by random() limit 2)
    ) candidate;
    select coalesce((select array_append(v_ids, q.id) from public.trivia_questions q
      where q.is_active and q.bank_scope = 'partyup' and q.humour and not (q.id = any(v_ids))
      order by random() limit 1), v_ids) into v_ids;
    select v_ids || coalesce(array_agg(fill.id), array[]::uuid[]) into v_ids from (
      select q.id from public.trivia_questions q
      where q.is_active and q.bank_scope = 'partyup'
        and not (q.id = any(v_ids)) order by random() limit greatest(10 - cardinality(v_ids), 0)
    ) fill;
  end if;
  if cardinality(v_ids) < 10 then raise exception 'Only % matching active questions are available; 10 are required', cardinality(v_ids); end if;
  return v_ids[1:10];
end;
$$;

create or replace function public.get_admin_trivia_question_bank(
  p_search text default null, p_category text default null, p_difficulty text default null,
  p_humour boolean default null, p_is_active boolean default null, p_limit integer default 500
)
returns setof public.trivia_questions
language plpgsql stable security definer set search_path = public as $$
declare v_search text := left(lower(btrim(coalesce(p_search, ''))), 120);
begin
  if not public.is_site_admin() then raise exception 'Site administrator access required'; end if;
  return query select q.* from public.trivia_questions q
  where q.bank_scope = 'partyup'
    and (nullif(p_category, '') is null or q.category = p_category)
    and (nullif(p_difficulty, '') is null or q.difficulty = p_difficulty)
    and (p_humour is null or q.humour = p_humour)
    and (p_is_active is null or q.is_active = p_is_active)
    and (v_search = '' or lower(q.question_text || ' ' || q.answers::text || ' ' || q.category) like '%' || v_search || '%')
  order by q.updated_at desc limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

create or replace function public.admin_upsert_trivia_question(
  p_question_text text, p_answers jsonb, p_correct_answer text, p_category text,
  p_difficulty text, p_humour boolean default false, p_is_active boolean default true,
  p_question_id uuid default null
)
returns public.trivia_questions
language plpgsql security definer set search_path = public as $$
declare
  v_identity uuid := public.current_partyup_identity_id();
  v_answers jsonb := public.validate_trivia_answers(p_answers);
  v_correct integer := case upper(btrim(coalesce(p_correct_answer, '')))
    when 'A' then 0 when 'B' then 1 when 'C' then 2 when 'D' then 3 else -1 end;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_difficulty text := lower(btrim(coalesce(p_difficulty, '')));
  v_row public.trivia_questions;
  v_action text;
begin
  if not public.is_site_admin() then raise exception 'Site administrator access required'; end if;
  if v_identity is null then raise exception 'PartyUp identity required'; end if;
  if char_length(btrim(coalesce(p_question_text, ''))) not between 1 and 240 then raise exception 'Question must be 1 to 240 characters'; end if;
  if v_correct not between 0 and 3 then raise exception 'Correct answer must be A, B, C, or D'; end if;
  if v_category not in ('humour','music','movies_tv','pop_culture','sports','geography','science_nature','history','food_drink','internet_gaming','general_knowledge') then raise exception 'Invalid trivia category'; end if;
  if v_difficulty not in ('very_easy','easy','medium','hard') then raise exception 'Invalid trivia difficulty'; end if;
  if p_question_id is null then
    insert into public.trivia_questions(created_by_identity_id, question_text, answers, correct_answer,
      category, difficulty, humour, is_active, bank_scope)
    values (v_identity, btrim(p_question_text), v_answers, v_correct, v_category, v_difficulty,
      coalesce(p_humour, false), coalesce(p_is_active, true), 'partyup') returning * into v_row;
    v_action := 'create_trivia_question';
  else
    update public.trivia_questions set question_text = btrim(p_question_text), answers = v_answers,
      correct_answer = v_correct, category = v_category, difficulty = v_difficulty,
      humour = coalesce(p_humour, false), is_active = coalesce(p_is_active, true)
    where id = p_question_id and bank_scope = 'partyup' returning * into v_row;
    if not found then raise exception 'PartyUp question not found'; end if;
    v_action := 'update_trivia_question';
  end if;
  insert into public.site_admin_audit_log(admin_user_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), v_action, 'trivia_question', v_row.id::text, 'PartyUp question bank administration',
    jsonb_build_object('category', v_row.category, 'difficulty', v_row.difficulty, 'active', v_row.is_active));
  return v_row;
end;
$$;

create or replace function public.admin_set_trivia_question_active(p_question_id uuid, p_is_active boolean)
returns public.trivia_questions language plpgsql security definer set search_path = public as $$
declare v_row public.trivia_questions;
begin
  if not public.is_site_admin() then raise exception 'Site administrator access required'; end if;
  update public.trivia_questions set is_active = p_is_active where id = p_question_id and bank_scope = 'partyup' returning * into v_row;
  if not found then raise exception 'PartyUp question not found'; end if;
  insert into public.site_admin_audit_log(admin_user_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), case when p_is_active then 'reactivate_trivia_question' else 'deactivate_trivia_question' end,
    'trivia_question', v_row.id::text, 'PartyUp question bank administration', '{}'::jsonb);
  return v_row;
end;
$$;

create or replace function public.admin_delete_trivia_question(p_question_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_question text;
begin
  if not public.is_site_admin() then raise exception 'Site administrator access required'; end if;
  delete from public.trivia_questions where id = p_question_id and bank_scope = 'partyup' returning question_text into v_question;
  if not found then raise exception 'PartyUp question not found'; end if;
  insert into public.site_admin_audit_log(admin_user_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'delete_trivia_question', 'trivia_question', p_question_id::text,
    'PartyUp question bank administration', jsonb_build_object('question_text', v_question));
  return true;
end;
$$;

create or replace function public.admin_import_trivia_questions(p_questions jsonb)
returns setof public.trivia_questions language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_row public.trivia_questions; v_count integer := 0;
begin
  if not public.is_site_admin() then raise exception 'Site administrator access required'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 100 then raise exception 'Import between 1 and 100 questions'; end if;
  for v_item in select value from jsonb_array_elements(p_questions) item(value) loop
    select * into v_row from public.admin_upsert_trivia_question(
      v_item->>'question_text', v_item->'answers', v_item->>'correct_answer',
      v_item->>'category', v_item->>'difficulty', coalesce((v_item->>'humour')::boolean, false),
      coalesce((v_item->>'is_active')::boolean, true), null
    );
    v_count := v_count + 1;
    return next v_row;
  end loop;
  insert into public.site_admin_audit_log(admin_user_id, action, target_type, reason, metadata)
  values (auth.uid(), 'bulk_import_trivia_questions', 'trivia_question_bank',
    'PartyUp question bank bulk import', jsonb_build_object('count', v_count));
  return;
end;
$$;

-- Allow rounds to select canonical active questions or the host's own active custom questions.
create or replace function public.create_lightning_trivia_round(
  p_room_id uuid, p_question_ids uuid[], p_starts_at timestamptz default null,
  p_seconds_per_question integer default 5, p_countdown_seconds integer default 10,
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
  values (p_room_id, v_identity, v_title, '10 questions. 5 seconds each. Fight for your faction.', 'lightning_trivia', '{}'::jsonb, 'draft', now(), v_end) returning * into v_mission;
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

revoke all on function public.get_trivia_question_bank(uuid,text,text,text,boolean,integer) from public, anon, authenticated;
revoke all on function public.generate_trivia_question_ids(uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_admin_trivia_question_bank(text,text,text,boolean,boolean,integer) from public, anon, authenticated;
revoke all on function public.admin_upsert_trivia_question(text,jsonb,text,text,text,boolean,boolean,uuid) from public, anon, authenticated;
revoke all on function public.admin_set_trivia_question_active(uuid,boolean) from public, anon, authenticated;
revoke all on function public.admin_delete_trivia_question(uuid) from public, anon, authenticated;
revoke all on function public.admin_import_trivia_questions(jsonb) from public, anon, authenticated;
grant execute on function public.get_trivia_question_bank(uuid,text,text,text,boolean,integer) to authenticated;
grant execute on function public.generate_trivia_question_ids(uuid,text,text) to authenticated;
grant execute on function public.get_admin_trivia_question_bank(text,text,text,boolean,boolean,integer) to authenticated;
grant execute on function public.admin_upsert_trivia_question(text,jsonb,text,text,text,boolean,boolean,uuid) to authenticated;
grant execute on function public.admin_set_trivia_question_active(uuid,boolean) to authenticated;
grant execute on function public.admin_delete_trivia_question(uuid) to authenticated;
grant execute on function public.admin_import_trivia_questions(jsonb) to authenticated;

notify pgrst, 'reload schema';
