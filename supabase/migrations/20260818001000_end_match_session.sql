create or replace function public.end_match_session_for_identity(
  p_identity_id uuid,
  p_match_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  if p_identity_id is null then
    raise exception 'PartyUp identity required';
  end if;

  select *
  into v_session
  from public.match_sessions
  where id = p_match_session_id
  for update;

  if not found then
    raise exception 'Match session not found';
  end if;

  if p_identity_id not in (v_session.participant_a_identity, v_session.participant_b_identity) then
    raise exception 'Not authorized for this Match session';
  end if;

  if v_session.status is distinct from 'ended' then
    update public.match_sessions
    set status = 'ended',
        ended_at = now(),
        ended_reason = 'left',
        ended_by_identity = p_identity_id
    where id = p_match_session_id;
  end if;

  delete from public.match_queue
  where match_session_id = p_match_session_id;
end;
$$;

revoke all on function public.end_match_session_for_identity(uuid, uuid) from public, anon, authenticated;

create or replace function public.end_match_session(p_match_session_id uuid)
returns void
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

  perform public.end_match_session_for_identity(v_identity_id, p_match_session_id);
end;
$$;

revoke all on function public.end_match_session(uuid) from public, anon, authenticated;
grant execute on function public.end_match_session(uuid) to authenticated;

create or replace function public.guest_end_match_session(
  p_match_session_id uuid,
  p_guest_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  v_identity_id := public.resolve_guest_identity(p_guest_token);

  perform public.end_match_session_for_identity(v_identity_id, p_match_session_id);
end;
$$;

revoke all on function public.guest_end_match_session(uuid, text) from public, anon, authenticated;
grant execute on function public.guest_end_match_session(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
