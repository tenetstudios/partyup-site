create extension if not exists pgcrypto with schema extensions;

create or replace function public.resolve_guest_identity(p_guest_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if p_guest_token is null or length(p_guest_token) < 32 then
    raise exception 'Invalid guest credential';
  end if;

  update public.partyup_guest_sessions
  set last_seen_at = now()
  where token_hash = encode(extensions.digest(p_guest_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning identity_id into v_identity_id;

  if v_identity_id is null then
    raise exception 'Invalid guest credential';
  end if;

  return v_identity_id;
end;
$$;

revoke all on function public.resolve_guest_identity(text) from public, anon, authenticated;
grant execute on function public.resolve_guest_identity(text) to service_role;

create or replace function public.claim_guest_identity(p_guest_token text)
returns table (
  claimed boolean,
  identity_id uuid,
  conflict boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_existing_identity_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_identity_id := public.resolve_guest_identity(p_guest_token);

  select id
  into v_existing_identity_id
  from public.partyup_identities
  where user_id = v_user_id
    and id <> v_identity_id
  limit 1;

  if v_existing_identity_id is not null then
    claimed := false;
    identity_id := v_identity_id;
    conflict := true;
    message := 'This Google account already has a PartyUp identity. Guest history attachment is deferred.';
    return next;
    return;
  end if;

  update public.partyup_identities
  set user_id = v_user_id,
      identity_type = 'account'
  where id = v_identity_id
    and user_id is null
    and identity_type = 'guest';

  if not found then
    raise exception 'Guest identity is already claimed';
  end if;

  update public.partyup_guest_sessions
  set revoked_at = now()
  where identity_id = v_identity_id
    and token_hash = encode(extensions.digest(p_guest_token, 'sha256'), 'hex');

  claimed := true;
  identity_id := v_identity_id;
  conflict := false;
  message := 'Guest identity claimed.';
  return next;
end;
$$;

grant execute on function public.claim_guest_identity(text) to authenticated;

notify pgrst, 'reload schema';
