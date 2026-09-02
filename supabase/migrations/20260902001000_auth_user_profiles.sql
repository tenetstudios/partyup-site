create or replace function public.create_profile_for_auth_user(
  p_user_id uuid,
  p_email text,
  p_user_metadata jsonb,
  p_app_metadata jsonb,
  p_email_confirmed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_name text := coalesce(
    nullif(btrim(p_user_metadata->>'full_name'), ''),
    nullif(btrim(p_user_metadata->>'name'), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'PartyUp User'
  );
  v_username text := left(
    regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g'),
    24
  );
  v_avatar_url text := coalesce(
    nullif(btrim(p_user_metadata->>'avatar_url'), ''),
    nullif(btrim(p_user_metadata->>'picture'), '')
  );
begin
  if p_user_id is null then
    raise exception 'Auth user id is required';
  end if;

  v_username := trim(both '-' from v_username);
  if v_username = '' then
    v_username := 'partyup-user';
  end if;

  -- The UUID suffix keeps the username compatible with schemas where it is unique.
  v_username := v_username || '-' || left(replace(p_user_id::text, '-', ''), 8);

  begin
    insert into public.profiles (
      id,
      username,
      avatar_url,
      bio,
      is_google_verified
    )
    values (
      p_user_id,
      v_username,
      v_avatar_url,
      '',
      coalesce(p_app_metadata->>'provider', '') = 'google'
        and p_email_confirmed_at is not null
    )
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- A display-name collision must never prevent the Auth account from being
      -- created. A full UUID fallback is unique and still satisfies username rules.
      insert into public.profiles (
        id,
        username,
        avatar_url,
        bio,
        is_google_verified
      )
      values (
        p_user_id,
        'user-' || replace(p_user_id::text, '-', ''),
        v_avatar_url,
        '',
        coalesce(p_app_metadata->>'provider', '') = 'google'
          and p_email_confirmed_at is not null
      )
      on conflict (id) do nothing;
  end;

  -- Some PartyUp databases have display_name while older ones do not. Populate it
  -- when available without making this repair migration depend on that column.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'display_name'
  ) then
    execute
      'update public.profiles
       set display_name = coalesce(nullif(display_name, ''''), $1)
       where id = $2'
    using v_display_name, p_user_id;
  end if;
end;
$$;

revoke all on function public.create_profile_for_auth_user(uuid, text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.create_profile_for_auth_user(
    new.id,
    new.email,
    new.raw_user_meta_data,
    new.raw_app_meta_data,
    new.email_confirmed_at
  );

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user_profile()
  from public, anon, authenticated;

drop trigger if exists partyup_create_profile_after_auth_user_insert on auth.users;

create trigger partyup_create_profile_after_auth_user_insert
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();

-- Repair accounts created before the trigger existed. Existing profile data wins.
select public.create_profile_for_auth_user(
  account.id,
  account.email,
  account.raw_user_meta_data,
  account.raw_app_meta_data,
  account.email_confirmed_at
)
from auth.users account
where not exists (
  select 1
  from public.profiles profile
  where profile.id = account.id
);

notify pgrst, 'reload schema';
