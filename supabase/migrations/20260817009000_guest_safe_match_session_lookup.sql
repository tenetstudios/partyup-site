create or replace function public.get_match_session_for_identity(
  p_identity_id uuid,
  p_match_session_id uuid
)
returns table (
  id uuid,
  ended_reason text,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    s.id,
    s.ended_reason,
    s.expires_at,
    s.status
  from public.match_sessions s
  where s.id = p_match_session_id
    and p_identity_id in (s.participant_a_identity, s.participant_b_identity)
  limit 1;
end;
$$;

revoke all on function public.get_match_session_for_identity(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_match_session_for_current_identity(p_match_session_id uuid)
returns table (
  id uuid,
  ended_reason text,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_identity_id
  from public.partyup_identities
  where user_id = v_user_id;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  return query
  select *
  from public.get_match_session_for_identity(v_identity_id, p_match_session_id);
end;
$$;

grant execute on function public.get_match_session_for_current_identity(uuid) to authenticated;

create or replace function public.guest_get_match_session(
  p_match_session_id uuid,
  p_guest_token text
)
returns table (
  id uuid,
  ended_reason text,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  return query
  select *
  from public.get_match_session_for_identity(v_identity_id, p_match_session_id);
end;
$$;

grant execute on function public.guest_get_match_session(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
