-- Ensure account deletion remains possible for tables added after the original
-- account-deletion migration. Preserve shared room history where practical and
-- cascade rows that are meaningful only as part of the deleted identity.

alter table public.room_idle_media alter column updated_by drop not null;
alter table public.room_idle_media drop constraint if exists room_idle_media_updated_by_fkey;
alter table public.room_idle_media
  add constraint room_idle_media_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.room_stream_queue alter column approved_by drop not null;
alter table public.room_stream_queue drop constraint if exists room_stream_queue_approved_by_fkey;
alter table public.room_stream_queue
  add constraint room_stream_queue_approved_by_fkey
  foreign key (approved_by) references auth.users(id) on delete set null;

alter table public.room_recap_media alter column updated_by drop not null;
alter table public.room_recap_media drop constraint if exists room_recap_media_updated_by_fkey;
alter table public.room_recap_media
  add constraint room_recap_media_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.wild_squads alter column created_by_identity_id drop not null;
alter table public.wild_squads drop constraint if exists wild_squads_created_by_identity_id_fkey;
alter table public.wild_squads
  add constraint wild_squads_created_by_identity_id_fkey
  foreign key (created_by_identity_id) references public.partyup_identities(id) on delete set null;

alter table public.wild_squad_members drop constraint if exists wild_squad_members_participant_identity_id_fkey;
alter table public.wild_squad_members
  add constraint wild_squad_members_participant_identity_id_fkey
  foreign key (participant_identity_id) references public.partyup_identities(id) on delete cascade;

alter table public.wild_squad_mission_completions alter column completed_by_identity_id drop not null;
alter table public.wild_squad_mission_completions drop constraint if exists wild_squad_mission_completions_completed_by_identity_id_fkey;
alter table public.wild_squad_mission_completions
  add constraint wild_squad_mission_completions_completed_by_identity_id_fkey
  foreign key (completed_by_identity_id) references public.partyup_identities(id) on delete set null;

alter table public.trivia_questions drop constraint if exists trivia_questions_created_by_identity_id_fkey;
alter table public.trivia_questions
  add constraint trivia_questions_created_by_identity_id_fkey
  foreign key (created_by_identity_id) references public.partyup_identities(id) on delete cascade;

alter table public.trivia_rounds alter column created_by_identity_id drop not null;
alter table public.trivia_rounds drop constraint if exists trivia_rounds_created_by_identity_id_fkey;
alter table public.trivia_rounds
  add constraint trivia_rounds_created_by_identity_id_fkey
  foreign key (created_by_identity_id) references public.partyup_identities(id) on delete set null;
