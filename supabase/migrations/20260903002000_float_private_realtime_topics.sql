-- PARTYUP FLOAT PHASE 9.1
-- Private per-actor Broadcast topics. A participant may receive either actor's
-- stream, but may only send on the topic representing their own player slot.

create or replace function public.float_realtime_topic_match_id(p_topic text)
returns uuid
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_topic ~ '^float-match:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:player[AB]$'
      then split_part(p_topic, ':', 2)::uuid
    else null
  end
$$;

revoke all on function public.float_realtime_topic_match_id(text) from public;
grant execute on function public.float_realtime_topic_match_id(text) to authenticated;

create policy float_realtime_participant_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.float_matches match
    where match.id = public.float_realtime_topic_match_id(realtime.topic())
      and auth.uid() in (match.player_a_id, match.player_b_id)
  )
);

create policy float_realtime_actor_send
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.float_matches match
    where match.id = public.float_realtime_topic_match_id(realtime.topic())
      and (
        (split_part(realtime.topic(), ':', 3) = 'playerA' and auth.uid() = match.player_a_id)
        or (split_part(realtime.topic(), ':', 3) = 'playerB' and auth.uid() = match.player_b_id)
      )
  )
);

