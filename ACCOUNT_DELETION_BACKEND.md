# PartyUp account deletion implementation

## Implemented flow

- Public `/delete-account` instructions and data-retention disclosure.
- Optional browser-side Supabase session detection, account identification, and an explicit confirmation step.
- An authenticated deletion boundary in `lib/accountDeletion.ts` backed by the `delete-account` Edge Function.
- Entry points from the public footer and the signed-in user's profile/account controls.
- Existing `/contact` support path remains available for failed or inaccessible requests.

## Backend behavior

The privileged `delete-account` Edge Function authenticates the bearer token, derives the target user from that token, requires a sign-in within the last 15 minutes, and calls service-role-only database functions. The browser never supplies the target user ID.

The current website and migrations show these likely account-linked areas that must be re-audited before implementation:

- Supabase Auth account plus `profiles`.
- Social data in `follows`, `partyup_identities`, and `partyup_connections`.
- `notifications`.
- Rooms and participation in `event_rooms`, `event_attendees`, `room_messages`, `room_announcements`, `room_recap_messages`, and `room_analytics_events`.
- Match data in `match_queue`, `match_sessions`, `match_pair_blocks`, and `match_connection_votes`; identity merging also makes `partyup_guest_sessions` relevant.
- Memories and storage in `room_memories`, `saved_memories`, and the `room-memories` bucket; hosted event/series cover assets in the `event-images` bucket also need an ownership/path audit.
- History and hosting data in `event_recaps`, `event_series`, and `series_follows`.
- Host streaming credentials in `room_stream_keys`.

The database transaction deletes profiles, follows, notifications, attendance, identities and identity-owned Match, Connection, Memory, Series, Recap, and Mission rows. Hosted rooms are ended and disassociated. Shared messages, announcements, recap messages, analytics, and moderation evidence are retained without an account link. Storage objects and the Supabase Auth user are then removed by the Edge Function.

`account_deletion_requests` retains only a SHA-256 account fingerprint, status, timestamps, a bounded error, and storage paths needed for retries. It is inaccessible to browser roles. Moderation action actor and target UUIDs remain immutable as required by Chat Moderation V1, while message authorship is anonymized.
