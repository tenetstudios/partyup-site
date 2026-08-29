-- Let a room host permanently remove legacy custom questions from their own bank.
-- Launched rounds retain their immutable snapshots; source_question_id becomes null.

create or replace function public.delete_custom_trivia_question(
  p_room_id uuid,
  p_question_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity uuid := public.current_partyup_identity_id();
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'Room host access required';
  end if;
  if v_identity is null then
    raise exception 'PartyUp identity required';
  end if;

  delete from public.trivia_questions
  where id = p_question_id
    and bank_scope = 'custom'
    and created_by_identity_id = v_identity;

  if not found then
    raise exception 'Custom question not found or not owned by this host';
  end if;
  return true;
end;
$$;

revoke all on function public.delete_custom_trivia_question(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_custom_trivia_question(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
