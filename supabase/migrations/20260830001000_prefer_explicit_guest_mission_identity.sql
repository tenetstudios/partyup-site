-- Keep mission participation attached to the guest profile that supplied the
-- credential, even if the browser also has an unrelated Supabase auth session.
create or replace function public.resolve_mission_participant_identity(p_guest_token text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if nullif(btrim(coalesce(p_guest_token, '')), '') is not null then
    v_identity_id := public.resolve_guest_identity(p_guest_token);
  elsif auth.uid() is not null then
    select identity.id
    into v_identity_id
    from public.partyup_identities identity
    where identity.user_id = auth.uid()
    limit 1;
  end if;

  if v_identity_id is null then
    raise exception 'PartyUp participant identity required';
  end if;

  return v_identity_id;
end;
$$;

revoke all on function public.resolve_mission_participant_identity(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
