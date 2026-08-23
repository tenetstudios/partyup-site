create extension if not exists pgcrypto;

create table if not exists public.room_missions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.event_rooms(id) on delete cascade,
  created_by_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  title text not null,
  description text null,
  status text not null default 'draft',
  starts_at timestamptz null,
  ends_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz null,
  ended_reason text null,
  constraint room_missions_title_length check (char_length(title) between 1 and 120),
  constraint room_missions_description_length check (description is null or char_length(description) <= 1000),
  constraint room_missions_status_check check (status in ('draft', 'active', 'ended')),
  constraint room_missions_end_after_start check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint room_missions_active_has_start check (status <> 'active' or starts_at is not null),
  constraint room_missions_ended_has_timestamp check (status <> 'ended' or ended_at is not null),
  constraint room_missions_ended_reason_check check (
    ended_reason is null or ended_reason in ('manual', 'expired', 'replaced', 'room_ended')
  )
);

create unique index if not exists room_missions_one_active_per_room_idx
  on public.room_missions(room_id)
  where status = 'active';

create index if not exists room_missions_room_created_idx
  on public.room_missions(room_id, created_at desc);

create index if not exists room_missions_active_expiry_idx
  on public.room_missions(room_id, ends_at)
  where status = 'active';

create table if not exists public.mission_completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.room_missions(id) on delete cascade,
  participant_identity_id uuid not null references public.partyup_identities(id) on delete cascade,
  completed_at timestamptz not null default now(),
  constraint mission_completions_once_per_identity unique (mission_id, participant_identity_id)
);

create index if not exists mission_completions_mission_completed_idx
  on public.mission_completions(mission_id, completed_at desc);

create or replace function public.set_room_missions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists room_missions_set_updated_at on public.room_missions;
create trigger room_missions_set_updated_at
before update on public.room_missions
for each row execute function public.set_room_missions_updated_at();

create or replace function public.can_view_room_missions(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_rooms room
    where room.id = p_room_id
      and (
        coalesce(room.is_private, false) = false
        or room.host_id = auth.uid()
        or exists (
          select 1
          from public.event_attendees attendee
          where attendee.event_room_id = room.id
            and attendee.user_id = auth.uid()
            and attendee.status::text = 'accepted'
        )
      )
  );
$$;

create or replace function public.close_expired_room_missions(p_room_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed integer;
begin
  update public.room_missions
  set status = 'ended',
      ended_at = coalesce(ends_at, now()),
      ended_reason = 'expired'
  where status = 'active'
    and ends_at is not null
    and ends_at <= now()
    and (p_room_id is null or room_id = p_room_id);

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

create or replace function public.get_active_room_mission(p_room_id uuid)
returns table (
  id uuid,
  room_id uuid,
  created_by_identity_id uuid,
  title text,
  description text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  ended_at timestamptz,
  completion_count bigint,
  viewer_completed boolean,
  can_manage boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_room_missions(p_room_id) then
    return;
  end if;

  perform public.close_expired_room_missions(p_room_id);

  return query
  select
    mission.id,
    mission.room_id,
    mission.created_by_identity_id,
    mission.title,
    mission.description,
    mission.status,
    mission.starts_at,
    mission.ends_at,
    mission.created_at,
    mission.ended_at,
    (select count(*) from public.mission_completions completion where completion.mission_id = mission.id),
    exists (
      select 1
      from public.mission_completions completion
      where completion.mission_id = mission.id
        and completion.participant_identity_id = public.current_partyup_identity_id()
    ),
    public.is_room_host(p_room_id)
  from public.room_missions mission
  join public.event_rooms room on room.id = mission.room_id
  where mission.room_id = p_room_id
    and mission.status = 'active'
    and mission.starts_at <= now()
    and (mission.ends_at is null or mission.ends_at > now())
    and room.status::text <> 'ended'
  order by mission.starts_at desc
  limit 1;
end;
$$;

create or replace function public.get_room_mission_history(p_room_id uuid, p_limit integer default 10)
returns table (
  id uuid,
  room_id uuid,
  created_by_identity_id uuid,
  title text,
  description text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  completion_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can view Mission history';
  end if;

  perform public.close_expired_room_missions(p_room_id);

  return query
  select
    mission.id,
    mission.room_id,
    mission.created_by_identity_id,
    mission.title,
    mission.description,
    mission.status,
    mission.starts_at,
    mission.ends_at,
    mission.created_at,
    mission.ended_at,
    mission.ended_reason,
    (select count(*) from public.mission_completions completion where completion.mission_id = mission.id)
  from public.room_missions mission
  where mission.room_id = p_room_id
    and mission.status = 'ended'
  order by mission.ended_at desc nulls last, mission.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

create or replace function public.publish_room_mission(
  p_room_id uuid,
  p_title text,
  p_description text default null,
  p_duration_minutes integer default null
)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_starts_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can publish Missions';
  end if;

  if exists (
    select 1 from public.event_rooms room
    where room.id = p_room_id and room.status::text = 'ended'
  ) then
    raise exception 'Missions cannot be published after the event ends';
  end if;

  if v_title is null then
    raise exception 'Mission title is required';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'Mission title is too long';
  end if;

  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Mission description is too long';
  end if;

  if p_duration_minutes is not null and (p_duration_minutes < 1 or p_duration_minutes > 1440) then
    raise exception 'Mission duration must be between 1 and 1440 minutes';
  end if;

  select identity.id
  into v_identity_id
  from public.partyup_identities identity
  where identity.user_id = auth.uid()
  limit 1;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('partyup-room-mission:' || p_room_id::text));
  perform public.close_expired_room_missions(p_room_id);

  update public.room_missions
  set status = 'ended',
      ended_at = now(),
      ended_reason = 'replaced'
  where room_id = p_room_id
    and status = 'active';

  insert into public.room_missions (
    room_id,
    created_by_identity_id,
    title,
    description,
    status,
    starts_at,
    ends_at
  )
  values (
    p_room_id,
    v_identity_id,
    v_title,
    v_description,
    'active',
    v_starts_at,
    case
      when p_duration_minutes is null then null
      else v_starts_at + make_interval(mins => p_duration_minutes)
    end
  )
  returning * into v_mission;

  return v_mission;
end;
$$;

create or replace function public.end_room_mission(p_mission_id uuid)
returns public.room_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.room_missions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_mission
  from public.room_missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  if not public.is_room_host(v_mission.room_id) then
    raise exception 'Only the room host can end Missions';
  end if;

  if v_mission.status = 'active' then
    update public.room_missions
    set status = 'ended',
        ended_at = now(),
        ended_reason = case
          when ends_at is not null and ends_at <= now() then 'expired'
          else 'manual'
        end
    where id = p_mission_id
    returning * into v_mission;
  end if;

  return v_mission;
end;
$$;

create or replace function public.complete_room_mission(p_mission_id uuid)
returns public.mission_completions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_completion public.mission_completions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_mission
  from public.room_missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  if v_mission.status <> 'active' then
    raise exception 'This Mission is no longer active';
  end if;

  if v_mission.ends_at is not null and v_mission.ends_at <= now() then
    update public.room_missions
    set status = 'ended', ended_at = ends_at, ended_reason = 'expired'
    where id = v_mission.id;
    raise exception 'This Mission has expired';
  end if;

  if exists (
    select 1 from public.event_rooms room
    where room.id = v_mission.room_id and room.status::text = 'ended'
  ) then
    raise exception 'This event has ended';
  end if;

  if not public.is_room_host(v_mission.room_id)
     and not exists (
       select 1
       from public.event_attendees attendee
       where attendee.event_room_id = v_mission.room_id
         and attendee.user_id = auth.uid()
         and attendee.status::text = 'accepted'
     ) then
    raise exception 'You must be participating in this room to complete its Mission';
  end if;

  select identity.id
  into v_identity_id
  from public.partyup_identities identity
  where identity.user_id = auth.uid()
  limit 1;

  if v_identity_id is null then
    raise exception 'PartyUp identity not found';
  end if;

  insert into public.mission_completions (mission_id, participant_identity_id)
  values (p_mission_id, v_identity_id)
  on conflict (mission_id, participant_identity_id) do nothing
  returning * into v_completion;

  if v_completion.id is null then
    select *
    into v_completion
    from public.mission_completions
    where mission_id = p_mission_id
      and participant_identity_id = v_identity_id;
  end if;

  return v_completion;
end;
$$;

create or replace function public.close_room_missions_when_event_ends()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status::text <> 'ended' and new.status::text = 'ended' then
    update public.room_missions
    set status = 'ended',
        ended_at = now(),
        ended_reason = 'room_ended'
    where room_id = new.id
      and status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists event_rooms_close_missions_on_end on public.event_rooms;
create trigger event_rooms_close_missions_on_end
after update of status on public.event_rooms
for each row execute function public.close_room_missions_when_event_ends();

alter table public.room_missions enable row level security;
alter table public.mission_completions enable row level security;

revoke all on public.room_missions from anon, authenticated;
revoke all on public.mission_completions from anon, authenticated;
grant select on public.room_missions to anon, authenticated;
grant select on public.mission_completions to authenticated;

drop policy if exists room_missions_select_authorized_room on public.room_missions;
create policy room_missions_select_authorized_room
on public.room_missions
for select
to anon, authenticated
using (public.can_view_room_missions(room_id));

drop policy if exists mission_completions_select_own_or_host on public.mission_completions;
create policy mission_completions_select_own_or_host
on public.mission_completions
for select
to authenticated
using (
  participant_identity_id = public.current_partyup_identity_id()
  or exists (
    select 1
    from public.room_missions mission
    join public.event_rooms room on room.id = mission.room_id
    where mission.id = mission_completions.mission_id
      and room.host_id = auth.uid()
  )
);

revoke all on function public.can_view_room_missions(uuid) from public, anon, authenticated;
revoke all on function public.close_expired_room_missions(uuid) from public, anon, authenticated;
revoke all on function public.get_active_room_mission(uuid) from public, anon, authenticated;
revoke all on function public.get_room_mission_history(uuid, integer) from public, anon, authenticated;
revoke all on function public.publish_room_mission(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.end_room_mission(uuid) from public, anon, authenticated;
revoke all on function public.complete_room_mission(uuid) from public, anon, authenticated;

grant execute on function public.can_view_room_missions(uuid) to anon, authenticated;
grant execute on function public.get_active_room_mission(uuid) to anon, authenticated;
grant execute on function public.get_room_mission_history(uuid, integer) to authenticated;
grant execute on function public.publish_room_mission(uuid, text, text, integer) to authenticated;
grant execute on function public.end_room_mission(uuid) to authenticated;
grant execute on function public.complete_room_mission(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.room_missions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.mission_completions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
