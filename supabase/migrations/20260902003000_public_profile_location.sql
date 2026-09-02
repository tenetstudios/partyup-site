alter table public.profiles
  add column if not exists location text;

create or replace function public.update_my_profile(
  p_username text,
  p_avatar_url text,
  p_bio text,
  p_location text,
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
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
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

  if p_update_details and char_length(coalesce(p_bio, '')) > 280 then
    return jsonb_build_object(
      'status', 'invalid_bio',
      'message', 'Bio must be 280 characters or fewer.'
    );
  end if;

  if p_update_details and char_length(coalesce(v_location, '')) > 80 then
    return jsonb_build_object(
      'status', 'invalid_location',
      'message', 'Location must be 80 characters or fewer.'
    );
  end if;

  begin
    update public.profiles
    set
      username = v_username,
      avatar_url = case when p_update_details then nullif(btrim(coalesce(p_avatar_url, '')), '') else avatar_url end,
      bio = case when p_update_details then btrim(coalesce(p_bio, '')) else bio end,
      location = case when p_update_details then v_location else location end
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
    'message', 'Your public profile was updated.',
    'username', v_username,
    'display_name', v_username
  );
end;
$$;

revoke all on function public.update_my_profile(text, text, text, text, boolean)
  from public, anon;
grant execute on function public.update_my_profile(text, text, text, text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
