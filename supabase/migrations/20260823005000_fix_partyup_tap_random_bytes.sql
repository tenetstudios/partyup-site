-- pgcrypto is installed in Supabase's extensions schema. The PartyUp Tap
-- token function previously searched only public, so gen_random_bytes could
-- not be resolved at runtime.
alter function public.create_partyup_tap_token(uuid)
  set search_path = public, extensions;
