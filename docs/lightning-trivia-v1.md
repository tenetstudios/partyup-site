# PartyUp Lightning Trivia V1

Lightning Trivia is a verified `lightning_trivia` Room Mission. It uses the current room, identity, push, realtime, Wild faction assignment, territory, and contribution systems; it is not a separate trivia product.

## Authoritative timing and scoring

- The host creates a round with one backend `starts_at`. Joining closes exactly at that timestamp.
- Every client derives the same question from `starts_at`, question order, `seconds_per_question`, and the 650 ms feedback interval. Realtime only refreshes state; it is never the timer.
- Each answer window starts at `starts_at + (order - 1) * (question_ms + 650)` and ends after `question_ms`.
- The database validates server receipt before the deadline and records server-derived `response_ms`. V1 intentionally accepts ordinary network latency as a documented Night 1 limitation; clients cannot submit a score, response time, correctness, faction, or correct answer.
- Correct score: `750 + round(250 * remaining_fraction ^ 1.1)`, capped at 1,000. Wrong and unanswered answers score zero.
- Reference values for a five-second question: 0 ms = 1,000; 500 ms = 973; 2,000 ms = 893; 4,000 ms = 793; 4,900 ms = 753; 5,000 ms = 750.

## Integrity, access, and lifecycle

- A launch transaction requires exactly ten distinct active questions and copies text, four answers, correct answer, category, and difficulty into `trivia_round_questions`.
- Bank edits and soft deletion (`archived`) cannot change or corrupt existing rounds.
- Only the owning room host or a site administrator can use question-bank RPCs. Only the room host can launch or cancel a round.
- Active player RPCs return question text and choices but never `correct_answer`. Snapshot and answer tables have no attendee-facing direct select grant.
- A participant can join only while scheduled. Reopening resumes the current authoritative question; remaining questions never restart. Late players see the in-progress notice and results when scoring ends.
- Room end cancels a live round. If the Wild game ends first, trivia finishes recreationally with `reward_status = wild_ended` and adds no influence.
- An active client poll transitions the due round through `scoring` to `ended`; finalization is transactionally locked and retry-safe.

## Faction result and Wild reward

- An engaged player is a pre-start participant with at least one accepted answer.
- For each Wild faction, players are sorted by total score, correct count, average correct response time, then identity UUID. Only the best ten count.
- Factions below the configured minimum (default five) are marked insufficient and cannot place.
- Placement sorts by Top-10 average, then total correct answers among counted players, then lower average response time on counted correct answers. Exact ties share the same rank.
- Placement rewards default to 50/20/10. Each qualifying faction writes one normal `wild_contributions` row and a unique `(round_id, faction_key)` reward mapping. The territory row is locked and updated in the same finalization transaction, preventing double awards.
- Non-Wild participants can play room-wide trivia. In a Wild-linked round, a participant without an authoritative Wild assignment can play but does not enter faction scoring.

## Cross-platform manual test

1. Apply migrations, run the web and Expo clients against the same Supabase project, and enter the same active room on one browser and one device.
2. Start Into the Wild, enroll both players, and confirm their faction assignments.
3. In Room Settings → Engagement → Lightning Trivia, create at least ten valid questions. Edit one and delete one to verify the archive confirmation; create a replacement.
4. Select ten questions, target a territory, keep five seconds / ten-second countdown / five-player minimum / 50-20-10 rewards, then launch.
5. Confirm both room banners show the same countdown. Join both before zero. Verify no join is available from a third client after zero.
6. Compare question number and countdown on web and native throughout the round. Tap once and attempt another choice; the first choice must remain locked.
7. Exercise correct, wrong, and timeout paths. Background and reopen the native app during a later question; it must resume rather than restart.
8. After question ten, confirm the calculating state, identical faction standings, the private personal score, and counted/not-counted message. Confirm there is no public individual leaderboard.
9. Seed or run enough players to check: four engaged players is insufficient; thirty players uses only the best ten; adding an eleventh lower score does not lower the faction average.
10. Confirm one `wild_contributions` row per rewarded faction, the territory influence increments once, and retrying `finalize_lightning_trivia_round` indirectly through state polling does not add more rows.
11. Repeat with the Wild ended before question ten and confirm results finish with no reward.

## V1 deferrals

- Random question selection and final per-question answer review are not included.
- A dedicated scheduled database worker is not required for Night 1; connected clients trigger the idempotent due-round finalizer. Server timestamps still define every deadline and result.
- V1 uses server receipt time, so network latency is not separated from reaction time. The implementation does not claim sub-network precision.
