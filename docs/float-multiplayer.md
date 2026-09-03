# Float 9.1 multiplayer

Float network matches use the same `@partyup/balloon-core` 8.1.0 build and `@partyup/float-realtime-protocol` 1.0.0 package in the web and mobile clients. PartyUp authentication supplies the user identity; clients never choose their player slot.

The web and Expo development UIs consume the same endpoint, pinned core, and action shapes instead of introducing platform-specific multiplayer rules.

## Authority and recovery

- Gameplay actions are applied immediately and broadcast on private `float-match:{matchId}:playerA|playerB` actor topics. Topic authorization permits both participants to receive, but only the account mapped to that actor may send.
- Every envelope carries protocol version, match ID, random action ID, actor, monotonically increasing actor sequence, integer 60 Hz simulation tick, action type, and validated logical payload. Render coordinates and animation frames are never transmitted.
- Total ordering is `(simulationTick, actorPlayerId, clientSequence, actionId)`. Six-tick checkpoints and a 60-tick journal rewind late actions before replaying deterministically.
- Peer ACKs, gap requests, replay, and action-ID deduplication handle dropped, reordered, and duplicate Broadcast messages. Database acknowledgements are not treated as peer processing.
- Persistence is off the input path: clients batch immutable action-log writes asynchronously. Player A periodically writes a hashed checkpoint with both processed-sequence cursors and is the only checkpoint/final-state coordinator.
- Both peers exchange SHA-256 state hashes only for the same protocol/core version, tick, and A/B cursors. A mismatch, sequence gap outside retained history, reload, or reconnect invokes checkpoint-plus-action-log recovery; recovered checkpoint hashes are recomputed before acceptance.
- The Edge Function remains responsible for matchmaking, create/join/ready, heartbeat/liveness, persistence validation, checkpoints, and recovery. Heartbeats never advance gameplay state.
- The UI shows `OPPONENT RECONNECTING` after 20 seconds without a heartbeat. After the centralized 60-second grace period, the match becomes abandoned with no winner.

Player A is the sole prototype checkpoint/finalization authority. If A disconnects, B may continue transient prediction during the existing grace window, but checkpoint authority is frozen and never transfers; A must recover the latest checkpoint/log on return, otherwise the existing 60-second liveness rule abandons the match. Rewind-generated simulation events are not re-emitted to presentation, so visible effects cannot replay twice.

The legacy `action` operation remains in the Edge source temporarily for rollback compatibility, but Phase 9.1 web and Expo gameplay do not call it.

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

Run `npm run test:float-realtime` for ordering, spoof validation, all action mappings, sequence gaps, loss/replay, duplicates, rapid POP bursts, rewind timings at 0/100/250/500 ms, and two-peer convergence.
