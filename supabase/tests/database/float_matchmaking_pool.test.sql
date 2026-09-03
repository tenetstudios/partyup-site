begin;

select plan(15);

select has_table('public', 'float_pool_entries', 'Float has one generalized pool table');
select has_column('public', 'float_matches', 'pool_mode', 'Float matches record their source pool mode');
select has_column('public', 'float_matches', 'source_room_id', 'Room matches retain the PartyUp room source');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pool-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'pool-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'pool-c@example.test', '', now(), '{}', '{}', now(), now());

select is(
  public.float_server_join_pool(
    '11000000-0000-0000-0000-000000000001', 'global', null, '8.1', '8.1.0', 'web',
    '21000000-0000-0000-0000-000000000001', 'POOLA2', 701, '{"status":"active","simulationTimeMs":0}'
  )->>'status', 'searching', 'The first global player searches'
);

select is(
  public.float_server_join_pool(
    '11000000-0000-0000-0000-000000000002', 'global', null, '8.1', '8.1.0', 'mobile',
    '21000000-0000-0000-0000-000000000002', 'POOLB2', 702, '{"status":"active","simulationTimeMs":0}'
  )->>'status', 'matched', 'A cross-platform global opponent forms a match'
);

select is((select count(*) from public.float_matches where pool_mode = 'global'), 1::bigint, 'Exactly one Float match is created');
select is((select player_a_id from public.float_matches where pool_mode = 'global'), '11000000-0000-0000-0000-000000000001'::uuid, 'The oldest pool entry receives slot A');
select is((select player_b_id from public.float_matches where pool_mode = 'global'), '11000000-0000-0000-0000-000000000002'::uuid, 'The joining player receives slot B');
select is((select count(distinct match_id) from public.float_pool_entries where status = 'matched'), 1::bigint, 'Both handoff rows expose the same match ID');

select is(
  public.float_server_join_pool(
    '11000000-0000-0000-0000-000000000003', 'global', null, '8.1', '8.1.0', 'web',
    '21000000-0000-0000-0000-000000000003', 'POOLC2', 703, '{"status":"active","simulationTimeMs":0}'
  )->>'status', 'searching', 'A third player remains searching'
);

select is((select count(*) from public.float_pool_entries where user_id = '11000000-0000-0000-0000-000000000003'), 1::bigint, 'Retries cannot create duplicate user entries');
select is(public.float_server_cancel_pool('11000000-0000-0000-0000-000000000003')->>'status', 'cancelled', 'A searching player can cancel');
select is((select status from public.float_pool_entries where user_id = '11000000-0000-0000-0000-000000000003'), 'cancelled', 'Cancelled entries are not searchable');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.float_pool_entries), 1::bigint, 'RLS exposes only the current user pool row');
select throws_ok(
  $$update public.float_pool_entries set status = 'matched' where user_id = '11000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'Clients cannot forge pool status'
);

reset role;
select * from finish();
rollback;
