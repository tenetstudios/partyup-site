-- PARTYUP LIVE NODES V1
-- Reusable physical QR claims. The first configured use is a hidden T-shirt,
-- but rewards remain descriptive and are never trusted from the QR payload.

create extension if not exists pgcrypto;

alter table public.room_missions drop constraint if exists room_missions_mission_type_check;
alter table public.room_missions add constraint room_missions_mission_type_check
  check (mission_type in ('generic', 'animal_pack', 'connection', 'wild_faction', 'live_node'));

create table public.live_nodes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  mission_id uuid null unique references public.room_missions(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  description text null check (description is null or char_length(description) <= 1000),
  reward_description text null check (reward_description is null or char_length(reward_description) <= 240),
  status text not null default 'draft' check (status in ('draft', 'armed', 'active', 'claimed', 'ended')),
  max_claims integer not null default 1 check (max_claims between 1 and 100),
  token_hash bytea not null unique,
  token_hint text not null,
  starts_at timestamptz null,
  ends_at timestamptz null,
  claimed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_nodes_end_after_start check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint live_nodes_claimed_timestamp check (status <> 'claimed' or claimed_at is not null)
);

create index live_nodes_room_created_idx on public.live_nodes(room_id, created_at desc);
create index live_nodes_room_status_idx on public.live_nodes(room_id, status);

create table public.live_node_claims (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.live_nodes(id) on delete cascade,
  identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  claim_position integer not null check (claim_position > 0),
  fulfilled_at timestamptz null,
  fulfilled_by_identity_id uuid null references public.partyup_identities(id) on delete set null,
  constraint live_node_claims_identity_once unique (node_id, identity_id),
  constraint live_node_claims_position_once unique (node_id, claim_position),
  constraint live_node_claims_fulfillment_pair check (
    (fulfilled_at is null and fulfilled_by_identity_id is null)
    or (fulfilled_at is not null and fulfilled_by_identity_id is not null)
  )
);

create index live_node_claims_node_claimed_idx
  on public.live_node_claims(node_id, claimed_at);

create or replace function public.set_live_node_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger live_nodes_set_updated_at
before update on public.live_nodes
for each row execute function public.set_live_node_updated_at();

create or replace function public.can_identity_claim_live_node(p_room_id uuid, p_identity_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.event_rooms room
    join public.partyup_identities identity on identity.id = p_identity_id
    where room.id = p_room_id
      and room.status::text <> 'ended'
      and (
        room.host_id = identity.user_id
        or exists (
          select 1 from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = identity.user_id
            and attendee.status::text = 'accepted'
        )
        or exists (
          select 1 from public.room_analytics_events event
          where event.room_id = room.id
            and event.identity_id = identity.id
            and event.event_type = 'room_entry'
        )
      )
  );
$$;

create or replace function public.create_live_node(
  p_room_id uuid,
  p_name text,
  p_description text default null,
  p_reward_description text default null,
  p_max_claims integer default 1,
  p_ends_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_identity_id uuid;
  v_node public.live_nodes;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null or not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can create Live Nodes';
  end if;
  perform 1 from public.event_rooms where id = p_room_id and status::text <> 'ended';
  if not found then raise exception 'This event has ended'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(btrim(p_name)) > 120 then
    raise exception 'Node name must be 1 to 120 characters';
  end if;
  if char_length(coalesce(p_description, '')) > 1000 then raise exception 'Node description is too long'; end if;
  if char_length(coalesce(p_reward_description, '')) > 240 then raise exception 'Reward description is too long'; end if;
  if p_max_claims is null or p_max_claims < 1 or p_max_claims > 100 then raise exception 'Max claims must be between 1 and 100'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'Node end time must be in the future'; end if;

  v_identity_id := public.resolve_mission_participant_identity(null);
  insert into public.live_nodes (
    room_id, created_by_identity_id, name, description, reward_description,
    max_claims, token_hash, token_hint, ends_at
  ) values (
    p_room_id, v_identity_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_reward_description, '')), ''), p_max_claims,
    extensions.digest(v_token, 'sha256'), right(v_token, 8), p_ends_at
  ) returning * into v_node;

  return jsonb_build_object('node', to_jsonb(v_node) - 'token_hash', 'claim_token', v_token);
end;
$$;

create or replace function public.get_room_live_nodes(p_room_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.is_room_host(p_room_id) then raise exception 'Only the room host can view Live Nodes'; end if;
  select coalesce(jsonb_agg(
    (to_jsonb(node) - 'token_hash') || jsonb_build_object(
      'claim_count', (select count(*) from public.live_node_claims claim where claim.node_id = node.id),
      'winner', (
        select jsonb_build_object(
          'claim_id', claim.id,
          'identity_id', claim.identity_id,
          'display_name', identity.display_name,
          'avatar_url', identity.avatar_url,
          'claimed_at', claim.claimed_at,
          'fulfilled_at', claim.fulfilled_at
        )
        from public.live_node_claims claim
        join public.partyup_identities identity on identity.id = claim.identity_id
        where claim.node_id = node.id and claim.claim_position = 1
      )
    ) order by node.created_at desc
  ), '[]'::jsonb) into v_result
  from public.live_nodes node where node.room_id = p_room_id;
  return v_result;
end;
$$;

create or replace function public.rotate_live_node_token(p_node_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_node public.live_nodes; v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_node from public.live_nodes where id = p_node_id for update;
  if not found or not public.is_room_host(v_node.room_id) then raise exception 'Live Node not found'; end if;
  if v_node.status not in ('draft', 'armed') then raise exception 'Only draft or armed Nodes can regenerate their QR'; end if;
  update public.live_nodes set token_hash = extensions.digest(v_token, 'sha256'), token_hint = right(v_token, 8)
  where id = p_node_id returning * into v_node;
  return jsonb_build_object('node', to_jsonb(v_node) - 'token_hash', 'claim_token', v_token);
end;
$$;

create or replace function public.set_live_node_status(p_node_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_node public.live_nodes;
  v_identity_id uuid;
  v_mission_id uuid;
begin
  select * into v_node from public.live_nodes where id = p_node_id for update;
  if not found or not public.is_room_host(v_node.room_id) then raise exception 'Live Node not found'; end if;
  if p_status not in ('armed', 'active', 'ended') then raise exception 'Unsupported Live Node status'; end if;

  if p_status = 'armed' then
    if v_node.status <> 'draft' then raise exception 'Only a draft Node can be armed'; end if;
    update public.live_nodes set status = 'armed' where id = p_node_id returning * into v_node;
  elsif p_status = 'active' then
    if v_node.status <> 'armed' then raise exception 'Arm the Node before activating it'; end if;
    perform 1 from public.event_rooms where id = v_node.room_id and status::text <> 'ended' for share;
    if not found then raise exception 'This event has ended'; end if;
    if v_node.ends_at is not null and v_node.ends_at <= now() then raise exception 'This Node has expired'; end if;
    v_identity_id := public.resolve_mission_participant_identity(null);
    perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || v_node.room_id::text));
    perform public.close_expired_room_missions(v_node.room_id);
    update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'replaced'
      where room_id = v_node.room_id and status = 'active';
    insert into public.room_missions (
      room_id, created_by_identity_id, title, description, mission_type, config,
      status, starts_at, ends_at
    ) values (
      v_node.room_id, v_identity_id, v_node.name,
      coalesce(v_node.description, 'Find the hidden PartyUp QR. First valid claim wins.'),
      'live_node', jsonb_build_object(
        'verification_type', 'live_node', 'node_id', v_node.id,
        'required_claim', true, 'reward_description', v_node.reward_description
      ), 'active', now(), v_node.ends_at
    ) returning id into v_mission_id;
    update public.live_nodes set status = 'active', starts_at = now(), mission_id = v_mission_id
      where id = p_node_id returning * into v_node;
  else
    if v_node.status = 'ended' then return to_jsonb(v_node) - 'token_hash'; end if;
    update public.live_nodes set status = 'ended' where id = p_node_id returning * into v_node;
    update public.room_missions set status = 'ended', ended_at = now(), ended_reason = 'manual'
      where id = v_node.mission_id and status = 'active';
  end if;
  return to_jsonb(v_node) - 'token_hash';
end;
$$;

create or replace function public.get_live_node_scan_state(p_token text, p_guest_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_node public.live_nodes; v_identity_id uuid; v_claim public.live_node_claims; v_room_ended boolean;
begin
  select * into v_node from public.live_nodes where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_claim from public.live_node_claims where node_id = v_node.id and identity_id = v_identity_id;
  select room.status::text = 'ended' into v_room_ended from public.event_rooms room where room.id = v_node.room_id;
  return jsonb_build_object(
    'status', case
      when v_claim.id is not null then 'already_claimed_by_you'
      when v_room_ended then 'room_ended'
      when v_node.status in ('draft', 'armed') or (v_node.starts_at is not null and v_node.starts_at > now()) then 'inactive'
      when v_node.status = 'ended' or (v_node.ends_at is not null and v_node.ends_at <= now()) then 'ended'
      when v_node.status = 'claimed' then 'claimed'
      else v_node.status end,
    'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name,
    'description', v_node.description, 'reward_description', v_node.reward_description,
    'eligible', public.can_identity_claim_live_node(v_node.room_id, v_identity_id),
    'claim_position', v_claim.claim_position, 'claimed_at', v_claim.claimed_at,
    'fulfilled_at', v_claim.fulfilled_at
  );
end;
$$;

create or replace function public.claim_live_node(p_token text, p_guest_token text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_node public.live_nodes;
  v_identity_id uuid;
  v_existing public.live_node_claims;
  v_claim public.live_node_claims;
  v_count integer;
  v_room_ended boolean;
  v_mission public.room_missions;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);
  select * into v_node from public.live_nodes
    where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256') for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;

  select * into v_existing from public.live_node_claims
    where node_id = v_node.id and identity_id = v_identity_id;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'already_claimed_by_you', 'node_id', v_node.id,
      'room_id', v_node.room_id, 'name', v_node.name, 'reward_description', v_node.reward_description,
      'claim_position', v_existing.claim_position, 'claimed_at', v_existing.claimed_at,
      'fulfilled_at', v_existing.fulfilled_at);
  end if;

  select room.status::text = 'ended' into v_room_ended from public.event_rooms room where room.id = v_node.room_id;
  if v_room_ended then return jsonb_build_object('status', 'room_ended', 'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name); end if;
  if v_node.status in ('draft', 'armed') or (v_node.starts_at is not null and v_node.starts_at > now()) then return jsonb_build_object('status', 'inactive', 'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name); end if;
  if v_node.status = 'ended' or (v_node.ends_at is not null and v_node.ends_at <= now()) then
    if v_node.status <> 'ended' then update public.live_nodes set status = 'ended' where id = v_node.id; end if;
    return jsonb_build_object('status', 'ended', 'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name);
  end if;
  if not public.can_identity_claim_live_node(v_node.room_id, v_identity_id) then
    return jsonb_build_object('status', 'not_eligible', 'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name);
  end if;

  select count(*)::integer into v_count from public.live_node_claims where node_id = v_node.id;
  if v_node.status = 'claimed' or v_count >= v_node.max_claims then
    if v_node.status <> 'claimed' then update public.live_nodes set status = 'claimed', claimed_at = coalesce(claimed_at, now()) where id = v_node.id; end if;
    return jsonb_build_object('status', 'claimed', 'node_id', v_node.id, 'room_id', v_node.room_id, 'name', v_node.name);
  end if;

  insert into public.live_node_claims(node_id, identity_id, claim_position)
  values (v_node.id, v_identity_id, v_count + 1) returning * into v_claim;

  if v_count + 1 >= v_node.max_claims then
    update public.live_nodes set status = 'claimed', claimed_at = v_claim.claimed_at where id = v_node.id;
  end if;

  select * into v_mission from public.room_missions
    where id = v_node.mission_id and status = 'active'
      and config->>'verification_type' = 'live_node'
      and config->>'node_id' = v_node.id::text;
  if v_mission.id is not null then
    insert into public.mission_completions(mission_id, participant_identity_id)
    values (v_mission.id, v_identity_id) on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'winner', 'node_id', v_node.id, 'room_id', v_node.room_id,
    'name', v_node.name, 'description', v_node.description,
    'reward_description', v_node.reward_description, 'claim_position', v_claim.claim_position,
    'claimed_at', v_claim.claimed_at, 'fulfilled_at', v_claim.fulfilled_at);
end;
$$;

create or replace function public.enforce_live_node_mission_completion_evidence()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_mission public.room_missions; v_node_id uuid;
begin
  select * into v_mission from public.room_missions where id = new.mission_id;
  if v_mission.config->>'verification_type' = 'live_node' then
    v_node_id := (v_mission.config->>'node_id')::uuid;
    if not exists (
      select 1 from public.live_node_claims claim
      where claim.node_id = v_node_id and claim.identity_id = new.participant_identity_id
    ) then raise exception 'A verified Live Node claim is required'; end if;
  end if;
  return new;
end;
$$;

create trigger mission_completions_require_live_node_evidence
before insert on public.mission_completions
for each row execute function public.enforce_live_node_mission_completion_evidence();

create or replace function public.fulfill_live_node_claim(p_node_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_node public.live_nodes; v_host_identity_id uuid; v_claim public.live_node_claims;
begin
  select * into v_node from public.live_nodes where id = p_node_id for update;
  if not found or not public.is_room_host(v_node.room_id) then raise exception 'Live Node not found'; end if;
  v_host_identity_id := public.resolve_mission_participant_identity(null);
  update public.live_node_claims set fulfilled_at = coalesce(fulfilled_at, now()),
    fulfilled_by_identity_id = coalesce(fulfilled_by_identity_id, v_host_identity_id)
  where node_id = p_node_id and claim_position = 1 returning * into v_claim;
  if not found then raise exception 'This Node does not have a winner yet'; end if;
  return to_jsonb(v_claim);
end;
$$;

create or replace function public.close_live_nodes_when_event_ends()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.status::text <> 'ended' and new.status::text = 'ended' then
    update public.live_nodes set status = 'ended'
      where room_id = new.id and status in ('draft', 'armed', 'active');
  end if;
  return new;
end;
$$;

create trigger event_rooms_close_live_nodes
after update of status on public.event_rooms
for each row execute function public.close_live_nodes_when_event_ends();

alter table public.live_nodes enable row level security;
alter table public.live_node_claims enable row level security;
revoke all on public.live_nodes from anon, authenticated;
revoke all on public.live_node_claims from anon, authenticated;

revoke all on function public.can_identity_claim_live_node(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_live_node(uuid, text, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.get_room_live_nodes(uuid) from public, anon, authenticated;
revoke all on function public.rotate_live_node_token(uuid) from public, anon, authenticated;
revoke all on function public.set_live_node_status(uuid, text) from public, anon, authenticated;
revoke all on function public.get_live_node_scan_state(text, text) from public, anon, authenticated;
revoke all on function public.claim_live_node(text, text) from public, anon, authenticated;
revoke all on function public.enforce_live_node_mission_completion_evidence() from public, anon, authenticated;
revoke all on function public.fulfill_live_node_claim(uuid) from public, anon, authenticated;
revoke all on function public.close_live_nodes_when_event_ends() from public, anon, authenticated;

grant execute on function public.create_live_node(uuid, text, text, text, integer, timestamptz) to authenticated;
grant execute on function public.get_room_live_nodes(uuid) to authenticated;
grant execute on function public.rotate_live_node_token(uuid) to authenticated;
grant execute on function public.set_live_node_status(uuid, text) to authenticated;
grant execute on function public.get_live_node_scan_state(text, text) to anon, authenticated;
grant execute on function public.claim_live_node(text, text) to anon, authenticated;
grant execute on function public.fulfill_live_node_claim(uuid) to authenticated;

notify pgrst, 'reload schema';
