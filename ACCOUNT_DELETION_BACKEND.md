# PartyUp account deletion implementation note

## Frontend completed now

- Public `/delete-account` instructions and data-retention disclosure.
- Optional browser-side Supabase session detection, account identification, and an explicit confirmation step.
- A deliberately unavailable deletion boundary in `lib/accountDeletion.ts`. It does not call, mutate, or imply success from any backend.
- Entry points from the public footer and the signed-in user's profile/account controls.
- Existing `/contact` support path reused for deletion requests while backend deletion is unavailable.

## Backend intentionally deferred

Do not implement this until the Chat Moderation V1 work has landed and its final schema, identity rules, retention requirements, and moderation evidence model can be reviewed. The future operation should be a privileged server-side endpoint or function that authenticates a fresh user session, derives the target user from that verified session (never from a browser-supplied user ID), requires reauthentication or another recent-user-verification mechanism, is idempotent, and returns an auditable request/result state.

The current website and migrations show these likely account-linked areas that must be re-audited before implementation:

- Supabase Auth account plus `profiles`.
- Social data in `follows`, `partyup_identities`, and `partyup_connections`.
- `notifications`.
- Rooms and participation in `event_rooms`, `event_attendees`, `room_messages`, `room_announcements`, `room_recap_messages`, and `room_analytics_events`.
- Match data in `match_queue`, `match_sessions`, `match_pair_blocks`, and `match_connection_votes`; identity merging also makes `partyup_guest_sessions` relevant.
- Memories and storage in `room_memories`, `saved_memories`, and the `room-memories` bucket; hosted event/series cover assets in the `event-images` bucket also need an ownership/path audit.
- History and hosting data in `event_recaps`, `event_series`, and `series_follows`.
- Host streaming credentials in `room_stream_keys`.

Deletion behavior must be decided per relationship: delete, anonymize, retain with restricted access, transfer ownership, or block deletion pending a required workflow. In particular, hosted rooms/series, shared messages and Memories, connections involving another person, analytics, safety/moderation evidence, and legally required records should not be handled by an unreviewed blanket cascade.

The moderation branch is expected to overlap most strongly around `room_messages`, authentication/identity, room participation and permissions, and new moderation/evidence records or retention rules. Re-inventory the merged schema and storage policies before designing the server transaction. No Supabase migration, RLS/grant/RPC/Auth change, Edge Function, user deletion, or storage deletion is included in this frontend work.
