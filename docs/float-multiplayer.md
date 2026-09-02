# Float 8.1 multiplayer

Float network matches use the same `@partyup/balloon-core` 8.1.0 build in the web client, mobile client, and `float-match` Edge Function. PartyUp authentication supplies the user identity; clients never choose their canonical player slot.

The web development UI is the first playable network client. The Expo repository includes the same pinned core and a native `src/lib/floatMultiplayer.ts` transport contract so a later native screen consumes the same endpoint and action shapes instead of introducing mobile-specific multiplayer rules.

## Authority and recovery

- Clients submit intent only. The Edge Function advances the canonical match to server-derived time, validates the intent with the shared core, and commits the resulting state plus an immutable server-ordered action in one database transaction.
- `client_action_id` makes action retries idempotent. Compare-and-swap `state_revision` retries serialize concurrent A/B actions.
- Realtime table changes trigger an authoritative-state refresh. A two-second authenticated sync/heartbeat provides snapshot recovery and advances income, waves, queues, structural damage, health, and match completion when nobody is acting.
- Clients interpolate the deterministic simulation locally between snapshots. Rendered coordinates and animation frames are never sent over Supabase.
- Participants can read their match and ordered action log through RLS. Only the service-role Edge Function can create, join, ready, sequence, or mutate a match.
- The UI shows `OPPONENT RECONNECTING` after 20 seconds without a heartbeat. After the centralized 60-second grace period, the match becomes abandoned with no winner.

The current snapshot-per-action plus two-second reconciliation is intentionally correctness-first. At larger concurrency, move passive ticking to scheduled/server workers and add checkpoint snapshots with action-log retention instead of increasing client sync frequency.

## Local verification

With Docker Desktop or Podman running:

```powershell
supabase start
supabase db reset
supabase test db
supabase functions serve float-match
```

Run the web app with `npm run dev`, then open `/dev/balloon-rooms/network` in two browser profiles or one normal and one private window. Sign in with two different PartyUp accounts. Player A creates and copies the join link; Player B joins; both press Ready.
