# Float 8.1 multiplayer

Float network matches use the same `@partyup/balloon-core` 8.1.0 build in the web client, mobile client, and `float-match` Edge Function. PartyUp authentication supplies the user identity; clients never choose their canonical player slot.

The web and Expo development UIs consume the same endpoint, pinned core, and action shapes instead of introducing platform-specific multiplayer rules.

## Authority and recovery

- Clients submit intent only. The Edge Function advances the canonical match to server-derived time, validates the intent with the shared core, and commits the resulting state plus an immutable server-ordered action in one database transaction.
- `client_action_id` makes action retries idempotent. Compare-and-swap `state_revision` retries serialize concurrent A/B actions.
- Realtime table changes trigger an authoritative-state refresh. A two-second authenticated sync/heartbeat provides snapshot recovery and advances income, waves, queues, structural damage, health, and match completion when nobody is acting.
- Clients interpolate the deterministic simulation locally between snapshots. Rendered coordinates and animation frames are never sent over Supabase.
- Participants can read their match and ordered action log through RLS. Only the service-role Edge Function can create, join, ready, sequence, or mutate a match.
- The UI shows `OPPONENT RECONNECTING` after 20 seconds without a heartbeat. After the centralized 60-second grace period, the match becomes abandoned with no winner.

## Phase 9.05 stabilization

The shared core retains fractional `simulationTimeMs` internally so gameplay speed and 60 Hz fidelity do not change. The `float_match_actions.simulation_time_ms` database field is an integer elapsed-millisecond audit value; the Edge Function is its only writer and converts through its validated `toDatabaseSimulationTimeMs` boundary immediately before the RPC. The helper is defined in the function entrypoint so the complete file can also be deployed through the Supabase Dashboard editor.

The browser and Expo client track the highest authoritative `state_revision` separately from row metadata. Same-revision heartbeat updates refresh connection timestamps and status but cannot replace locally advanced gameplay state. A higher revision is rebased to the client's current simulation time, then any still-pending local actions are replayed through the shared core.

Gameplay actions are applied through the shared core immediately and queued for the existing Edge Function one at a time. `client_action_id` connects each prediction to its server confirmation. Confirmed actions are removed before authoritative reconciliation, preventing double application; rejected or failed actions are removed and recovered from a server sync. Development builds log local-apply, request, and reconcile timings and preserve safe Supabase/Postgres diagnostics.

The current snapshot-per-action plus two-second reconciliation is intentionally correctness-first. At larger concurrency, move passive ticking to scheduled/server workers and add checkpoint snapshots with action-log retention instead of increasing client sync frequency.

## Phase 9 matchmaking

`float_pool_entries` is the single authenticated queue for both `room` and `global` searches. A user has at most one row; changing modes replaces the prior search. The `float-match` function validates the client/core version and delegates pairing to `float_server_join_pool`, which serializes formation in PostgreSQL, ignores entries older than 45 seconds, chooses the oldest compatible opponent, and creates one existing `float_matches` row with deterministic A/B slots.

Room searches use `event_attendees.status = 'accepted'` plus a non-ended `event_rooms` row as their server-side membership authority. Active/sticky room storage is only used to populate the UI. Pool rows are participant-private under RLS, and Realtime updates the waiting player's own row with the shared match ID. A 15-second client heartbeat refreshes the search; cancellation loses to an already-committed match.

Set `FLOAT_MATCHMAKING_DEBUG=true` on the Edge Function only while diagnosing pool join, cancellation, or match formation events.

## Local verification

With Docker Desktop or Podman running:

```powershell
supabase start
supabase db reset
supabase test db
supabase functions serve float-match
```

Run the web app with `npm run dev`, then open `/dev/balloon-rooms/network` in two browser profiles or one normal and one private window. Sign in with two different PartyUp accounts. Player A creates and copies the join link; Player B joins; both press Ready.
