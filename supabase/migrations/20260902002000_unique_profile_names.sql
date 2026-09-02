alter table public.profiles
  add column if not exists display_name text;

-- Give every existing profile a non-empty canonical name before enforcing the
-- invariant. Existing usernames win because that is the field PartyUp clients
-- have historically allowed people to edit.
do $$
declare
  v_profile record;
  v_candidate text;
begin
  for v_profile in
    select profile.id
    from public.profiles profile
    where profile.username is null
       or btrim(profile.username) = ''
  loop
    v_candidate := 'user-' || replace(v_profile.id::text, '-', '');

    while exists (
      select 1
      from public.profiles profile
      where profile.id <> v_profile.id
        and lower(btrim(profile.username)) = lower(v_candidate)
    ) loop
      v_candidate := 'u-' || md5(v_profile.id::text || clock_timestamp()::text);
    end loop;

    update public.profiles
    set username = v_candidate
    where id = v_profile.id;
  end loop;
end;
$$;

-- Keep the first owner of an existing case-insensitive name. Rename only later
-- duplicates, using a deterministic per-profile fallback that is extremely
-- unlikely to have been selected manually.
do $$
declare
  v_profile record;
  v_candidate text;
begin
  for v_profile in
    select duplicate.id
    from (
      select
        profile.id,
        row_number() over (
          partition by lower(btrim(profile.username))
          order by profile.id
        ) as duplicate_number
      from public.profiles profile
    ) duplicate
    where duplicate.duplicate_number > 1
  loop
    v_candidate := 'user-' || replace(v_profile.id::text, '-', '');

    while exists (
      select 1
      from public.profiles profile
      where profile.id <> v_profile.id
        and lower(btrim(profile.username)) = lower(v_candidate)
    ) loop
      v_candidate := 'u-' || md5(v_profile.id::text || clock_timestamp()::text);
    end loop;

    update public.profiles
    set
      username = v_candidate,
      display_name = v_candidate
    where id = v_profile.id;
  end loop;
end;
$$;

-- It is now safe to trim names even when the live database already has an older
-- case-sensitive unique constraint on username.
update public.profiles
set
  username = btrim(username),
  display_name = btrim(username);

create unique index if not exists profiles_username_case_insensitive_uidx
  on public.profiles (lower(btrim(username)));

create or replace function public.normalize_partyup_profile_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    raise check_violation using message = 'PartyUp name is required';
  end if;

  new.username := btrim(new.username);

  if char_length(new.username) < 2 or char_length(new.username) > 40 then
    raise check_violation using message = 'PartyUp name must be between 2 and 40 characters';
  end if;

  new.display_name := new.username;
  return new;
end;
$$;

revoke all on function public.normalize_partyup_profile_name()
  from public, anon, authenticated;

drop trigger if exists profiles_normalize_partyup_name on public.profiles;

create trigger profiles_normalize_partyup_name
before insert or update of username on public.profiles
for each row
execute function public.normalize_partyup_profile_name();

create or replace function public.update_my_profile(
  p_username text,
  p_avatar_url text,
  p_bio text,
  p_update_details boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := btrim(coalesce(p_username, ''));
begin
  if v_user_id is null then
    return jsonb_build_object(
      'status', 'not_authenticated',
      'message', 'Sign in to update your profile.'
    );
  end if;

  if char_length(v_username) < 2 or char_length(v_username) > 40 then
    return jsonb_build_object(
      'status', 'invalid_name',
      'message', 'PartyUp name must be between 2 and 40 characters.'
    );
  end if;

  begin
    update public.profiles
    set
      username = v_username,
      avatar_url = case when p_update_details then coalesce(p_avatar_url, '') else avatar_url end,
      bio = case when p_update_details then coalesce(p_bio, '') else bio end
    where id = v_user_id;
  exception
    when unique_violation then
      return jsonb_build_object(
        'status', 'name_taken',
        'message', 'That PartyUp name is already taken.'
      );
  end;

  if not found then
    return jsonb_build_object(
      'status', 'profile_not_found',
      'message', 'Your PartyUp profile could not be found.'
    );
  end if;

  return jsonb_build_object(
    'status', 'updated',
    'message', 'Your PartyUp profile was updated.',
    'username', v_username,
    'display_name', v_username
  );
end;
$$;

revoke all on function public.update_my_profile(text, text, text, boolean)
  from public, anon;
grant execute on function public.update_my_profile(text, text, text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
