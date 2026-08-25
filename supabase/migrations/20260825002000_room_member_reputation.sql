alter table public.event_attendees
  add column if not exists reputation_given boolean not null default false;

alter table public.profiles
  add column if not exists reputation_score integer not null default 50,
  add column if not exists host_likes integer not null default 0;

create or replace function public.give_room_member_reputation(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer;
  v_host_likes integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to give reputation';
  end if;

  if not exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and room.host_id = auth.uid()
  ) then
    raise exception 'Only the room host can give reputation';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'The room host cannot give reputation to themselves';
  end if;

  update public.event_attendees attendee
  set reputation_given = true
  where attendee.event_room_id = p_room_id
    and attendee.user_id = p_user_id
    and attendee.status = 'accepted'
    and not coalesce(attendee.reputation_given, false);

  if not found then
    if exists (
      select 1
      from public.event_attendees attendee
      where attendee.event_room_id = p_room_id
        and attendee.user_id = p_user_id
        and coalesce(attendee.reputation_given, false)
    ) then
      raise exception 'Reputation was already given to this member';
    end if;

    raise exception 'Only accepted room members can receive reputation';
  end if;

  update public.profiles profile
  set reputation_score = coalesce(profile.reputation_score, 50) + 2,
      host_likes = coalesce(profile.host_likes, 0) + 1
  where profile.id = p_user_id
  returning profile.reputation_score, profile.host_likes
  into v_score, v_host_likes;

  if not found then
    raise exception 'Member profile not found';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'reputation_score', v_score,
    'host_likes', v_host_likes
  );
end;
$$;

revoke all on function public.give_room_member_reputation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.give_room_member_reputation(uuid, uuid) to authenticated;
