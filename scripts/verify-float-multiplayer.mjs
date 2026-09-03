import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as browserCore from "@partyup/balloon-core";
import * as edgeCore from "../supabase/functions/_shared/balloon-core/index.js";
import {
  floatActionFromIntent,
  isNewerGameplaySnapshot,
  reconcileFloatState,
} from "../lib/floatMultiplayerState.ts";

function exercise(core) {
  const state = core.createFloatMatch({
    matchId: "phase-8-1-parity",
    playerIds: ["playerA", "playerB"],
    seed: 601,
  });
  const wall = core.createWallSegment(state.players.playerA.room.id, "vertical", 2, 5);
  assert.equal(core.applyFloatMatchAction(state, { type: "PLACE_WALL", actorPlayerId: "playerA", wall }).applied, true);
  assert.equal(core.applyFloatMatchAction(state, {
    type: "SEND_BALLOON",
    actorPlayerId: "playerB",
    targetPlayerId: "playerA",
    balloonType: "basic",
    lane: 3,
    sentAt: state.simulationTimeMs,
  }).applied, true);
  for (let step = 0; step < 300; step += 1) core.updateFloatMatch(state, core.SIMULATION_STEP_SECONDS);
  return state;
}

assert.deepEqual(exercise(edgeCore), exercise(browserCore), "Edge and browser core builds must produce identical canonical state");

const fractionalState = browserCore.createFloatMatch({ matchId: "fractional-clock", playerIds: ["playerA", "playerB"], seed: 602 });
for (let step = 0; step < 120; step += 1) browserCore.updateFloatMatch(fractionalState, browserCore.SIMULATION_STEP_SECONDS);
assert.equal(Number.isInteger(fractionalState.simulationTimeMs), false, "The core reproduces fractional 60 Hz milliseconds");
assert.equal(Number.isInteger(Math.floor(fractionalState.simulationTimeMs)), true, "Database action time conversion produces an integer");

const predictionBase = browserCore.createFloatMatch({ matchId: "prediction", playerIds: ["playerA", "playerB"], seed: 603 });
const wallIntent = { actionType: "PLACE_WALL", payload: { orientation: "vertical", gridX: 2, gridY: 5 } };
const predicted = reconcileFloatState(predictionBase, [{ actionId: "pending-wall", actorPlayerId: "playerA", intent: wallIntent, simulationTimeMs: 0 }], 0);
assert.equal(predicted.players.playerA.room.walls.length, 1, "A pending wall is applied optimistically");
const confirmed = structuredClone(predictionBase);
assert.equal(browserCore.applyFloatMatchAction(confirmed, floatActionFromIntent(confirmed, "playerA", wallIntent)).applied, true);
assert.equal(reconcileFloatState(confirmed, [], 0).players.playerA.room.walls.length, 1, "Confirmation does not double-apply a predicted wall");
assert.equal(reconcileFloatState(predictionBase, [], 0).players.playerA.room.walls.length, 0, "Rejection removes a phantom wall");

const sendBase = browserCore.createFloatMatch({ matchId: "prediction-send", playerIds: ["playerA", "playerB"], seed: 604 });
const sendIntent = { actionType: "SEND_BALLOON", payload: { balloonType: "basic", lane: 1 } };
const sendPredicted = reconcileFloatState(sendBase, [{ actionId: "pending-send", actorPlayerId: "playerA", intent: sendIntent, simulationTimeMs: 0 }], 0);
assert.equal(sendPredicted.players.playerA.room.attack.queue.length, 1, "A send enters the local queue immediately");
const sendConfirmed = structuredClone(sendBase);
browserCore.applyFloatMatchAction(sendConfirmed, floatActionFromIntent(sendConfirmed, "playerA", sendIntent));
assert.deepEqual(reconcileFloatState(sendConfirmed, [], 0).players.playerA.room.attack, sendConfirmed.players.playerA.room.attack, "Send confirmation does not enqueue twice");

const popBase = browserCore.createFloatMatch({ matchId: "prediction-pop", playerIds: ["playerA", "playerB"], seed: 605 });
popBase.players.playerA.room.balloons.push(browserCore.createBasicBalloon(popBase.players.playerA.room.id, "tap-target", 1));
const popIntent = { actionType: "POP_BALLOON", payload: { balloonId: "tap-target" } };
const popPredicted = reconcileFloatState(popBase, [{ actionId: "pending-pop", actorPlayerId: "playerA", intent: popIntent, simulationTimeMs: 0 }], 0);
assert.equal(popPredicted.players.playerA.room.balloons[0].health, 2, "A manual pop applies exactly one local damage immediately");
const popConfirmed = structuredClone(popBase);
browserCore.applyFloatMatchAction(popConfirmed, floatActionFromIntent(popConfirmed, "playerA", popIntent));
assert.equal(reconcileFloatState(popConfirmed, [], 0).players.playerA.room.balloons[0].health, 2, "Pop confirmation does not damage twice");

const repairBase = structuredClone(confirmed);
repairBase.players.playerA.room.walls[0].integrity = browserCore.WALL_REPAIR_THRESHOLD;
const repairIntent = { actionType: "REPAIR_WALL", payload: { wallSegmentId: repairBase.players.playerA.room.walls[0].id } };
const repairPredicted = reconcileFloatState(repairBase, [{ actionId: "pending-repair", actorPlayerId: "playerA", intent: repairIntent, simulationTimeMs: 0 }], 0);
assert.equal(repairPredicted.players.playerA.room.walls[0].integrity, browserCore.WALL_MAX_INTEGRITY, "Repair integrity applies immediately");
const repairConfirmed = structuredClone(repairBase);
browserCore.applyFloatMatchAction(repairConfirmed, floatActionFromIntent(repairConfirmed, "playerA", repairIntent));
assert.equal(reconcileFloatState(repairConfirmed, [], 0).players.playerA.room.economy.coins, repairConfirmed.players.playerA.room.economy.coins, "Repair confirmation does not charge twice");
assert.equal(isNewerGameplaySnapshot(4, 4), false, "A same-revision heartbeat cannot replace gameplay state");
assert.equal(isNewerGameplaySnapshot(4, 5), true, "A newer canonical revision can reconcile gameplay state");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.dependencies["@partyup/balloon-core"], "file:vendor/partyup-balloon-core-8.1.0.tgz");

const migration = await readFile(new URL("../supabase/migrations/20260902004000_float_realtime_multiplayer.sql", import.meta.url), "utf8");
const gameplayEdgeFunction = await readFile(new URL("../supabase/functions/float-match/index.ts", import.meta.url), "utf8");
for (const contract of [
  "alter table public.float_matches enable row level security",
  "alter table public.float_match_actions enable row level security",
  "unique (match_id, sequence)",
  "unique (match_id, client_action_id)",
  "grant select on public.float_matches to authenticated",
  "grant execute on function public.float_server_commit_action",
  "to service_role",
  "alter publication supabase_realtime add table public.float_match_actions",
]) assert.ok(migration.includes(contract), `Missing database contract: ${contract}`);
assert.ok(gameplayEdgeFunction.includes("p_simulation_time_ms: toDatabaseSimulationTimeMs(state.simulationTimeMs)"), "Action RPC must use the canonical integer database time conversion");
assert.ok(gameplayEdgeFunction.includes("return Math.floor(simulationTimeMs)"), "The Edge timing boundary must floor fractional elapsed milliseconds");
assert.ok(gameplayEdgeFunction.includes("details: diagnostic.details"), "Edge errors must preserve safe Postgres diagnostics");

const poolMigration = await readFile(new URL("../supabase/migrations/20260903001000_float_matchmaking_pool.sql", import.meta.url), "utf8");
for (const contract of [
  "create table public.float_pool_entries",
  "user_id uuid primary key",
  "pool_mode text not null check (pool_mode in ('room', 'global'))",
  "last_seen_at >= now() - interval '45 seconds'",
  "order by candidate.joined_at, candidate.user_id",
  "for update skip locked",
  "attendee.status::text = 'accepted'",
  "create trigger float_matches_single_active_participant",
  "create policy float_pool_own_select",
  "alter publication supabase_realtime add table public.float_pool_entries",
]) assert.ok(poolMigration.includes(contract), `Missing Float pool contract: ${contract}`);

const edgeFunction = await readFile(new URL("../supabase/functions/float-match/index.ts", import.meta.url), "utf8");
for (const operation of ["poolJoin", "poolStatus", "poolCancel"]) {
  assert.ok(edgeFunction.includes(`body.operation === "${operation}"`), `Missing Float Edge operation: ${operation}`);
}

console.log("Float 8.1 core parity, transport, and Phase 9 room/global pooling contracts verified.");
