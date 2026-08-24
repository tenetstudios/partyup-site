-- Repair Live Node winner display data after V1 incorrectly read profile
-- columns directly from partyup_identities.

create or replace function public.get_room_live_nodes(p_room_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Only the room host can view Live Nodes';
  end if;

  select coalesce(jsonb_agg(
    (to_jsonb(node) - 'token_hash') || jsonb_build_object(
      'claim_count', (
        select count(*)
        from public.live_node_claims claim
        where claim.node_id = node.id
      ),
      'winner', (
        select jsonb_build_object(
          'claim_id', claim.id,
          'identity_id', claim.identity_id,
          'display_name', coalesce(
            nullif(to_jsonb(profile)->>'display_name', ''),
            profile.username,
            'Guest ' || left(claim.identity_id::text, 4)
          ),
          'avatar_url', profile.avatar_url,
          'claimed_at', claim.claimed_at,
          'fulfilled_at', claim.fulfilled_at
        )
        from public.live_node_claims claim
        join public.partyup_identities identity on identity.id = claim.identity_id
        left join public.profiles profile on profile.id = identity.user_id
        where claim.node_id = node.id and claim.claim_position = 1
      )
    ) order by node.created_at desc
  ), '[]'::jsonb) into v_result
  from public.live_nodes node
  where node.room_id = p_room_id;

  return v_result;
end;
$$;

revoke all on function public.get_room_live_nodes(uuid) from public, anon, authenticated;
grant execute on function public.get_room_live_nodes(uuid) to authenticated;

notify pgrst, 'reload schema';
