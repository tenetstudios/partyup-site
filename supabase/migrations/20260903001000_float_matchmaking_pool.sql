-- PARTYUP FLOAT PHASE 9
-- One authenticated room/global queue feeding the Phase 8.1 Float match model.

alter table public.float_matches
  add column pool_mode text null check (pool_mode in ('room', 'global')),
  add column source_room_id uuid null references public.event_rooms(id) on delete set null;

alter table public.float_matches
  add constraint float_matches_pool_room_shape check (
    (pool_mode is null and source_room_id is null)
    or pool_mode = 'global' and source_room_id is null
    or pool_mode = 'room' and source_room_id is not null
  );

create table public.float_pool_entries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pool_mode text not null check (pool_mode in ('room', 'global')),
  room_id uuid null references public.event_rooms(id) on delete cascade,
  game_version text not null,
  core_version text not null,
  platform text null check (platform is null or char_length(platform) between 1 and 32),
  status text not null default 'searching' check (status in ('searching', 'matched', 'cancelled', 'expired')),
  match_id uuid null references public.float_matches(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint float_pool_room_shape check (
    (pool_mode = 'room' and room_id is not null)
    or (pool_mode = 'global' and room_id is null)
  ),
  constraint float_pool_match_shape check (
    (status = 'matched' and match_id is not null)
    or (status <> 'matched' and match_id is null)
  )
);

create index float_pool_search_idx on public.float_pool_entries (
  pool_mode, room_id, game_version, core_version, joined_at
) where status = 'searching';
create index float_pool_stale_idx on public.float_pool_entries(last_seen_at)
  where status = 'searching';

alter table public.float_pool_entries enable row level security;
revoke all on public.float_pool_entries from public, anon, authenticated;
grant select on public.float_pool_entries to authenticated;

create policy float_pool_own_select
on public.float_pool_entries
for select to authenticated
using (auth.uid() = user_id);

create or replace function public.float_enforce_single_active_match()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('waiting', 'active') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('partyup-float-matchmaking-v1'));
  if exists (
    select 1 from public.float_matches existing
    where existing.id <> new.id
      and existing.status in ('waiting', 'active')
      and (
        new.player_a_id in (existing.player_a_id, existing.player_b_id)
        or (new.player_b_id is not null and new.player_b_id in (existing.player_a_id, existing.player_b_id))
      )
  ) then
    raise exception 'Player already has an active Float match';
  end if;
  return new;
end;
$$;

create trigger float_matches_single_active_participant
before insert or update of player_a_id, player_b_id, status on public.float_matches
for each row execute function public.float_enforce_single_active_match();

create or replace function public.float_server_join_pool(
  p_user_id uuid,
  p_pool_mode text,
  p_room_id uuid,
  p_game_version text,
  p_core_version text,
  p_platform text,
  p_match_id uuid,
  p_match_code text,
  p_match_seed bigint,
  p_initial_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.float_pool_entries;
  v_opponent public.float_pool_entries;
  v_match public.float_matches;
begin
  if p_user_id is null then raise exception 'Authenticated user required'; end if;
  if p_pool_mode not in ('room', 'global') then raise exception 'Invalid Float pool mode'; end if;
  if (p_pool_mode = 'room') <> (p_room_id is not null) then raise exception 'Invalid Float room pool'; end if;
  if nullif(btrim(p_game_version), '') is null or nullif(btrim(p_core_version), '') is null then
    raise exception 'Float version metadata required';
  end if;
  if p_match_code !~ '^[A-Z2-9]{6}$' then raise exception 'Invalid Float match code'; end if;
  if jsonb_typeof(p_initial_state) <> 'object' then raise exception 'Canonical initial state required'; end if;

  -- Serialize all Float formation paths. This keeps cross-column active-match checks
  -- and retries safe while the queue remains intentionally small in Phase 9.
  perform pg_advisory_xact_lock(hashtext('partyup-float-matchmaking-v1'));

  select * into v_match
  from public.float_matches
  where p_user_id in (player_a_id, player_b_id)
    and status in ('waiting', 'active')
  order by created_at desc
  limit 1;
  if found then
    delete from public.float_pool_entries where user_id = p_user_id and status = 'searching';
    return jsonb_build_object('status', 'matched', 'match', to_jsonb(v_match));
  end if;

  if p_pool_mode = 'room' and not exists (
    select 1
    from public.event_attendees attendee
    join public.event_rooms room on room.id = attendee.event_room_id
    where attendee.event_room_id = p_room_id
      and attendee.user_id = p_user_id
      and attendee.status::text = 'accepted'
      and room.status::text <> 'ended'
  ) then
    raise exception 'FLOAT ROOM ELIGIBILITY REQUIRED';
  end if;

  update public.float_pool_entries
  set status = 'expired', match_id = null, updated_at = now()
  where status = 'searching'
    and last_seen_at < now() - interval '45 seconds';

  insert into public.float_pool_entries (
    user_id, pool_mode, room_id, game_version, core_version, platform,
    status, match_id, joined_at, last_seen_at, updated_at
  ) values (
    p_user_id, p_pool_mode, case when p_pool_mode = 'room' then p_room_id else null end,
    btrim(p_game_version), btrim(p_core_version), nullif(left(btrim(coalesce(p_platform, '')), 32), ''),
    'searching', null, now(), now(), now()
  )
  on conflict (user_id) do update set
    pool_mode = excluded.pool_mode,
    room_id = excluded.room_id,
    game_version = excluded.game_version,
    core_version = excluded.core_version,
    platform = excluded.platform,
    status = 'searching',
    match_id = null,
    joined_at = case
      when float_pool_entries.status = 'searching'
       and float_pool_entries.pool_mode = excluded.pool_mode
       and float_pool_entries.room_id is not distinct from excluded.room_id
       and float_pool_entries.game_version = excluded.game_version
       and float_pool_entries.core_version = excluded.core_version
      then float_pool_entries.joined_at else now() end,
    last_seen_at = now(),
    updated_at = now()
  returning * into v_entry;

  select candidate.* into v_opponent
  from public.float_pool_entries candidate
  where candidate.user_id <> p_user_id
    and candidate.status = 'searching'
    and candidate.last_seen_at >= now() - interval '45 seconds'
    and candidate.pool_mode = p_pool_mode
    and candidate.room_id is not distinct from v_entry.room_id
    and candidate.game_version = p_game_version
    and candidate.core_version = p_core_version
    and not exists (
      select 1 from public.float_matches active_match
      where candidate.user_id in (active_match.player_a_id, active_match.player_b_id)
        and active_match.status in ('waiting', 'active')
    )
    and (
      p_pool_mode = 'global'
      or exists (
        select 1 from public.event_attendees attendee
        join public.event_rooms room on room.id = attendee.event_room_id
        where attendee.event_room_id = v_entry.room_id
          and attendee.user_id = candidate.user_id
          and attendee.status::text = 'accepted'
          and room.status::text <> 'ended'
      )
    )
  order by candidate.joined_at, candidate.user_id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('status', 'searching', 'entry', to_jsonb(v_entry));
  end if;

  insert into public.float_matches (
    id, match_code, status, player_a_id, player_b_id, match_seed,
    game_version, core_version, state, pool_mode, source_room_id,
    player_b_last_seen_at
  ) values (
    p_match_id, p_match_code, 'waiting', v_opponent.user_id, p_user_id, p_match_seed,
    p_game_version, p_core_version, p_initial_state, p_pool_mode, v_entry.room_id, now()
  ) returning * into v_match;

  update public.float_pool_entries
  set status = 'matched', match_id = v_match.id, updated_at = now()
  where user_id in (v_opponent.user_id, p_user_id)
    and status = 'searching';

  return jsonb_build_object('status', 'matched', 'match', to_jsonb(v_match));
end;
$$;

create or replace function public.float_server_cancel_pool(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_entry public.float_pool_entries; v_match public.float_matches;
begin
  perform pg_advisory_xact_lock(hashtext('partyup-float-matchmaking-v1'));
  select * into v_entry from public.float_pool_entries where user_id = p_user_id for update;
  if found and v_entry.status = 'matched' and v_entry.match_id is not null then
    select * into v_match from public.float_matches where id = v_entry.match_id;
    return jsonb_build_object('status', 'matched', 'match', to_jsonb(v_match));
  end if;
  update public.float_pool_entries
  set status = 'cancelled', match_id = null, updated_at = now()
  where user_id = p_user_id and status = 'searching';
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.float_server_pool_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_entry public.float_pool_entries; v_match public.float_matches;
begin
  select * into v_entry from public.float_pool_entries where user_id = p_user_id;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  if v_entry.status = 'matched' and v_entry.match_id is not null then
    select * into v_match from public.float_matches where id = v_entry.match_id;
    return jsonb_build_object('status', 'matched', 'match', to_jsonb(v_match));
  end if;
  if v_entry.status = 'searching' then
    if v_entry.pool_mode = 'room' and not exists (
      select 1 from public.event_attendees attendee
      join public.event_rooms room on room.id = attendee.event_room_id
      where attendee.event_room_id = v_entry.room_id
        and attendee.user_id = p_user_id
        and attendee.status::text = 'accepted'
        and room.status::text <> 'ended'
    ) then
      update public.float_pool_entries set status = 'expired', updated_at = now()
      where user_id = p_user_id and status = 'searching';
      return jsonb_build_object('status', 'expired');
    end if;
    if v_entry.last_seen_at < now() - interval '45 seconds' then
      update public.float_pool_entries set status = 'expired', updated_at = now()
      where user_id = p_user_id and status = 'searching';
      return jsonb_build_object('status', 'expired');
    end if;
    update public.float_pool_entries set last_seen_at = now(), updated_at = now()
    where user_id = p_user_id and status = 'searching' returning * into v_entry;
  end if;
  return jsonb_build_object('status', v_entry.status, 'entry', to_jsonb(v_entry));
end;
$$;

revoke all on function public.float_server_join_pool(uuid, text, uuid, text, text, text, uuid, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.float_server_cancel_pool(uuid) from public, anon, authenticated;
revoke all on function public.float_server_pool_status(uuid) from public, anon, authenticated;
grant execute on function public.float_server_join_pool(uuid, text, uuid, text, text, text, uuid, text, bigint, jsonb) to service_role;
grant execute on function public.float_server_cancel_pool(uuid) to service_role;
grant execute on function public.float_server_pool_status(uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'float_pool_entries'
  ) then
    alter publication supabase_realtime add table public.float_pool_entries;
  end if;
end;
$$;

notify pgrst, 'reload schema';
