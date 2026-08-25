-- Preserve a Live Node win when a player claims in a mobile browser and then
-- returns to the native app. Handoffs are short-lived, single-use bearer
-- credentials scoped to one claim; PartyUp guest credentials are never put in
-- a deep link.

create table public.live_node_claim_handoffs (
  claim_id uuid primary key references public.live_node_claims(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index live_node_claim_handoffs_expiry_idx
  on public.live_node_claim_handoffs(expires_at)
  where consumed_at is null;

alter table public.live_node_claim_handoffs enable row level security;
revoke all on public.live_node_claim_handoffs from anon, authenticated;

create or replace function public.create_live_node_claim_handoff(
  p_token text,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_claim public.live_node_claims;
  v_handoff_token text;
begin
  v_identity_id := public.resolve_mission_participant_identity(p_guest_token);

  select claim.*
  into v_claim
  from public.live_node_claims claim
  join public.live_nodes node on node.id = claim.node_id
  where node.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and claim.identity_id = v_identity_id;

  if not found then
    raise exception 'Only the winning player can open this claim in the app';
  end if;

  v_handoff_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.live_node_claim_handoffs (
    claim_id,
    token_hash,
    expires_at,
    consumed_at,
    created_at
  ) values (
    v_claim.id,
    extensions.digest(v_handoff_token, 'sha256'),
    now() + interval '10 minutes',
    null,
    now()
  )
  on conflict (claim_id) do update
    set token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        consumed_at = null,
        created_at = excluded.created_at;

  return jsonb_build_object(
    'handoff_token', v_handoff_token,
    'expires_at', now() + interval '10 minutes'
  );
end;
$$;

create or replace function public.consume_live_node_claim_handoff(
  p_handoff_token text,
  p_guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_identity_id uuid;
  v_handoff public.live_node_claim_handoffs;
  v_claim public.live_node_claims;
  v_node public.live_nodes;
  v_existing_claim public.live_node_claims;
  v_source_identity_id uuid;
begin
  v_target_identity_id := public.resolve_mission_participant_identity(p_guest_token);

  select handoff.*
  into v_handoff
  from public.live_node_claim_handoffs handoff
  where handoff.token_hash = extensions.digest(coalesce(p_handoff_token, ''), 'sha256')
  for update;

  if not found or v_handoff.consumed_at is not null or v_handoff.expires_at <= now() then
    raise exception 'This app handoff has expired or was already used';
  end if;

  select * into v_claim
  from public.live_node_claims
  where id = v_handoff.claim_id
  for update;

  if not found then
    raise exception 'Live Node claim not found';
  end if;

  select * into v_node from public.live_nodes where id = v_claim.node_id;
  v_source_identity_id := v_claim.identity_id;

  select * into v_existing_claim
  from public.live_node_claims
  where node_id = v_claim.node_id
    and identity_id = v_target_identity_id;

  if v_existing_claim.id is null and v_claim.identity_id <> v_target_identity_id then
    update public.live_node_claims
    set identity_id = v_target_identity_id
    where id = v_claim.id
    returning * into v_claim;

    if v_node.mission_id is not null then
      if exists (
        select 1 from public.mission_completions
        where mission_id = v_node.mission_id
          and participant_identity_id = v_target_identity_id
      ) then
        delete from public.mission_completions
        where mission_id = v_node.mission_id
          and participant_identity_id = v_source_identity_id;
      else
        update public.mission_completions
        set participant_identity_id = v_target_identity_id
        where mission_id = v_node.mission_id
          and participant_identity_id = v_source_identity_id;

        if not found then
          insert into public.mission_completions (mission_id, participant_identity_id)
          values (v_node.mission_id, v_target_identity_id)
          on conflict (mission_id, participant_identity_id) do nothing;
        end if;
      end if;
    end if;
  elsif v_existing_claim.id is not null then
    v_claim := v_existing_claim;
  end if;

  update public.live_node_claim_handoffs
  set consumed_at = now()
  where claim_id = v_handoff.claim_id;

  return jsonb_build_object(
    'status', 'already_claimed_by_you',
    'node_id', v_node.id,
    'room_id', v_node.room_id,
    'name', v_node.name,
    'description', v_node.description,
    'reward_description', v_node.reward_description,
    'claim_position', v_claim.claim_position,
    'claimed_at', v_claim.claimed_at,
    'fulfilled_at', v_claim.fulfilled_at
  );
end;
$$;

revoke all on function public.create_live_node_claim_handoff(text, text) from public, anon, authenticated;
revoke all on function public.consume_live_node_claim_handoff(text, text) from public, anon, authenticated;
grant execute on function public.create_live_node_claim_handoff(text, text) to anon, authenticated;
grant execute on function public.consume_live_node_claim_handoff(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
