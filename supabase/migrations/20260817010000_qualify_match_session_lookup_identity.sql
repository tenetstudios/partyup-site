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

  select identity_row.id
  into v_identity_id
  from public.partyup_identities identity_row
  where identity_row.user_id = v_user_id;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  return query
  select *
  from public.get_match_session_for_identity(v_identity_id, p_match_session_id);
end;
$$;

grant execute on function public.get_match_session_for_current_identity(uuid) to authenticated;

notify pgrst, 'reload schema';
