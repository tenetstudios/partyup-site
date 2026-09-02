begin;

select plan(16);

select has_table('public', 'float_matches', 'Float matches have an isolated table');
select has_table('public', 'float_match_actions', 'Float actions have an isolated durable log');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'float-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'float-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'float-c@example.test', '', now(), '{}', '{}', now(), now());

select lives_ok(
  $$select public.float_server_create_match(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'ABC234', 601, '8.1', '8.1.0', '{"status":"active","simulationTimeMs":0}'
  )$$,
  'Player A can create a Float match'
);

select is(
  (select player_a_id from public.float_matches where id = '20000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Creator owns player A'
);

select lives_ok(
  $$select public.float_server_join_match('10000000-0000-0000-0000-000000000002', 'abc234', '8.1', '8.1.0')$$,
  'A second user joins as player B'
);

select throws_ok(
  $$select public.float_server_join_match('10000000-0000-0000-0000-000000000003', 'ABC234', '8.1', '8.1.0')$$,
  'P0001', 'Float match is full',
  'A third user cannot take a player slot'
);

do $$ begin
  perform public.float_server_set_ready(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '8.1', '8.1.0', '{"status":"active","simulationTimeMs":0}'
  );
end $$;

select is(
  (select status from public.float_matches where id = '20000000-0000-0000-0000-000000000001'),
  'waiting',
  'One ready player does not start the match'
);

do $$ begin
  perform public.float_server_set_ready(
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '8.1', '8.1.0', '{"status":"active","simulationTimeMs":0}'
  );
end $$;

select is(
  (select status from public.float_matches where id = '20000000-0000-0000-0000-000000000001'),
  'active',
  'Both ready players start one canonical match'
);

create temporary table float_started_at as
select started_at from public.float_matches where id = '20000000-0000-0000-0000-000000000001';

do $$ begin
  perform public.float_server_set_ready(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '8.1', '8.1.0', '{"status":"active","simulationTimeMs":999}'
  );
end $$;

select is(
  (select match.started_at from public.float_matches match where match.id = '20000000-0000-0000-0000-000000000001'),
  (select started_at from float_started_at),
  'Repeated ready calls never restart the clock'
);

do $$ begin
  perform public.float_server_commit_action(
    '20000000-0000-0000-0000-000000000001', 1,
    '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
    'SEND_BALLOON', '{"balloonType":"basic","lane":3}', 100,
    '{"status":"active","simulationTimeMs":100}', 'active', null, null, null
  );
end $$;

select is(
  (select last_sequence from public.float_matches where id = '20000000-0000-0000-0000-000000000001'),
  1::bigint,
  'The server assigns the first canonical sequence'
);

do $$ begin
  perform public.float_server_commit_action(
    '20000000-0000-0000-0000-000000000001', 1,
    '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
    'SEND_BALLOON', '{"balloonType":"basic","lane":3}', 100,
    '{"status":"active","simulationTimeMs":100}', 'active', null, null, null
  );
end $$;

select is(
  (select count(*) from public.float_match_actions where match_id = '20000000-0000-0000-0000-000000000001'),
  1::bigint,
  'A duplicate client action ID is applied only once'
);

do $$ begin
  perform public.float_server_commit_action(
    '20000000-0000-0000-0000-000000000001', 2,
    '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
    'REPAIR_WALL', '{"wallSegmentId":"wall-1"}', 120,
    '{"status":"active","simulationTimeMs":120}', 'active', null, null, null
  );
end $$;

select is(
  (select max(sequence) from public.float_match_actions where match_id = '20000000-0000-0000-0000-000000000001'),
  2::bigint,
  'Canonical action sequence is monotonic across players'
);

select throws_ok(
  $$select public.float_server_commit_action(
    '20000000-0000-0000-0000-000000000001', 3,
    '10000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003',
    'SEND_BALLOON', '{"balloonType":"heavy","lane":4}', 140,
    '{"status":"active","simulationTimeMs":140}', 'active', null, null, null
  )$$,
  'P0001', 'Not a Float match participant',
  'A nonparticipant cannot commit an action'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*) from public.float_match_actions where match_id = '20000000-0000-0000-0000-000000000001'),
  2::bigint,
  'A participant can recover the ordered action log'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

select is(
  (select count(*) from public.float_matches where id = '20000000-0000-0000-0000-000000000001'),
  0::bigint,
  'RLS hides a match from a nonparticipant'
);

select throws_ok(
  $$update public.float_matches set last_sequence = 999 where id = '20000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Authenticated clients cannot mutate canonical match state directly'
);

reset role;
select * from finish();
rollback;
