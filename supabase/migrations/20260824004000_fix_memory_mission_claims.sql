-- Let a participant explicitly claim a Memory they already uploaded during a
-- Memory Mission. Normal Memories uploads do not know which Mission is active,
-- so they cannot create mission_memory_verifications at upload time.
create or replace function public.claim_memory_mission_completion(
  p_mission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_mission public.room_missions;
  v_memory_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to verify a Memory Mission';
  end if;

  v_identity_id := public.resolve_mission_participant_identity(null);

  select *
  into v_mission
  from public.room_missions
  where id = p_mission_id
  for update;

  if not found
     or v_mission.config->>'verification_type' <> 'memory_upload' then
    raise exception 'Memory Mission not found';
  end if;

  -- Preserve an existing binding on retries. Otherwise choose the newest
  -- unused upload that satisfies the same evidence rules as verification.
  select verification.memory_id
  into v_memory_id
  from public.mission_memory_verifications verification
  where verification.mission_id = p_mission_id
    and verification.participant_identity_id = v_identity_id;

  if v_memory_id is null then
    select memory.id
    into v_memory_id
    from public.room_memories memory
    where memory.room_id = v_mission.room_id
      and memory.uploader_identity_id = v_identity_id
      and memory.deleted_at is null
      and memory.created_at >= v_mission.starts_at
      and (v_mission.ends_at is null or memory.created_at <= v_mission.ends_at)
      and split_part(memory.media_path, '/', 1) = v_mission.room_id::text
      and split_part(memory.media_path, '/', 2) = v_identity_id::text
      and (
        coalesce(v_mission.config->>'required_media_type', 'any') = 'any'
        or memory.media_type = v_mission.config->>'required_media_type'
      )
      and exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'room-memories'
          and object.name = memory.media_path
          and object.created_at >= v_mission.starts_at
          and (v_mission.ends_at is null or object.created_at <= v_mission.ends_at)
      )
      and not exists (
        select 1
        from public.mission_memory_verifications used
        where used.memory_id = memory.id
      )
    order by memory.created_at desc, memory.id desc
    limit 1;
  end if;

  if v_memory_id is null then
    raise exception 'No qualifying Memory was found. Upload a new Memory while this Mission is active, then try again.';
  end if;

  -- The existing verifier rechecks room participation, faction eligibility,
  -- ownership, media type, timing, storage existence, and applies the reward.
  return public.verify_memory_mission_completion(p_mission_id, v_memory_id);
end;
$$;

revoke all on function public.claim_memory_mission_completion(uuid) from public, anon, authenticated;
grant execute on function public.claim_memory_mission_completion(uuid) to authenticated;

notify pgrst, 'reload schema';
