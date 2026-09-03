import assert from "node:assert/strict";
import {
  createBasicBalloon,
  createFloatMatch,
  createWallSegment,
  recalculateBalloonPath,
} from "@partyup/balloon-core";
import {
  FLOAT_REALTIME_PROTOCOL_VERSION,
  FloatRealtimeTimeline,
  FloatSequenceInbox,
  compareFloatRealtimeActions,
  floatRealtimeActionToCoreAction,
  floatHashCoordinateKey,
  hashFloatState,
  simulationTickToTimeMs,
  simulationTimeMsToTick,
  validateFloatRealtimeAction,
} from "../packages/float-realtime-protocol/dist/index.js";

function action(sequence, simulationTick, balloonId, actorPlayerId = "playerB") {
  const actorDigit = actorPlayerId === "playerA" ? "1" : "2";
  return {
    protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
    matchId: "10000000-0000-0000-0000-000000000091",
    actionId: `20000000-0000-4000-8000-${actorDigit}${String(sequence).padStart(11, "0")}`,
    actorPlayerId,
    clientSequence: sequence,
    simulationTick,
    actionType: "POP_BALLOON",
    payload: { balloonId },
  };
}

function escapeRaceState(balloonId = "late-pop") {
  const state = createFloatMatch({ matchId: "10000000-0000-0000-0000-000000000091", playerIds: ["playerA", "playerB"], seed: 901 });
  const room = state.players.playerB.room;
  const balloon = createBasicBalloon(room.id, balloonId, 1);
  balloon.health = 1;
  balloon.currentCell = { column: balloon.currentCell.column, row: 0 };
  balloon.targetCell = null;
  balloon.path = [];
  balloon.y = balloon.radius + balloon.speed * 0.04;
  recalculateBalloonPath(room, balloon);
  room.balloons.push(balloon);
  return state;
}

assert.equal(simulationTimeMsToTick(1234.6666667), 74);
assert.equal(simulationTickToTimeMs(60), 1000);

const ordering = [action(2, 10, "b", "playerB"), action(1, 10, "a", "playerA"), action(1, 9, "c", "playerB")].sort(compareFloatRealtimeActions);
assert.deepEqual(ordering.map((item) => [item.simulationTick, item.actorPlayerId, item.clientSequence]), [[9, "playerB", 1], [10, "playerA", 1], [10, "playerB", 2]]);
assert.equal(validateFloatRealtimeAction(action(1, 0, "valid"), { matchId: action(1, 0, "valid").matchId, actorPlayerId: "playerB" }).actionType, "POP_BALLOON");
assert.throws(() => validateFloatRealtimeAction({ ...action(1, 0, "spoof"), actorPlayerId: "playerA" }, { matchId: action(1, 0, "spoof").matchId, actorPlayerId: "playerB" }), /actor mismatch/);

const mappingState = createFloatMatch({ matchId: action(1, 0, "mapping").matchId, playerIds: ["playerA", "playerB"], seed: 900 });
const wallId = createWallSegment(mappingState.players.playerA.room.id, "vertical", 1, 1).id;
const mappingCases = [
  ["PLACE_WALL", { orientation: "vertical", gridX: 1, gridY: 1 }],
  ["REMOVE_WALL", { wallSegmentId: wallId }],
  ["PLACE_NAILS", { wallSegmentId: wallId }],
  ["REMOVE_NAILS", { wallSegmentId: wallId }],
  ["PLACE_GLUE", { wallSegmentId: wallId }],
  ["REMOVE_GLUE", { wallSegmentId: wallId }],
  ["REPAIR_WALL", { wallSegmentId: wallId }],
  ["SEND_BALLOON", { balloonType: "basic", lane: 1 }],
  ["POP_BALLOON", { balloonId: "mapping-balloon" }],
];
for (const [index, [actionType, payload]] of mappingCases.entries()) {
  const envelope = { ...action(index + 1, 12, "mapping", "playerA"), actionType, payload };
  assert.equal(floatRealtimeActionToCoreAction(mappingState, envelope).type, actionType);
}

const inbox = new FloatSequenceInbox();
const second = inbox.receive(action(2, 0, "two"));
assert.deepEqual(second.missing, { fromSequence: 1, toSequence: 1 });
assert.equal(second.ready.length, 0);
const first = inbox.receive(action(1, 0, "one"));
assert.deepEqual(first.ready.map((item) => item.clientSequence), [1, 2]);
assert.equal(inbox.receive(action(2, 0, "two")).duplicate, true);

for (const delayedTicks of [0, 6, 15, 30]) {
  const local = new FloatRealtimeTimeline(escapeRaceState());
  const remote = new FloatRealtimeTimeline(escapeRaceState());
  const pop = action(1, 0, "late-pop");
  assert.equal(local.insert(pop).status, "applied");
  local.advanceTo(delayedTicks);
  remote.advanceTo(delayedTicks);
  if (delayedTicks > 0) assert.equal(remote.state.players.playerB.room.health, 19, "Receiver must first reproduce the escape race");
  const result = remote.insert(pop);
  assert.equal(result.status, "applied", `Late POP must replay after ${delayedTicks} ticks`);
  assert.equal(result.rewound, delayedTicks > 0);
  assert.deepEqual(remote.state, local.state, `States must agree after ${Math.round(delayedTicks / 60 * 1000)}ms delayed POP`);
  assert.equal(remote.insert(pop).status, "duplicate");
}

const rapidState = escapeRaceState("rapid-1");
for (const id of ["rapid-2", "rapid-3"]) {
  const balloon = createBasicBalloon(rapidState.players.playerB.room.id, id, 1);
  balloon.health = 1;
  rapidState.players.playerB.room.balloons.push(balloon);
}
const rapid = new FloatRealtimeTimeline(rapidState);
for (const [index, id] of ["rapid-1", "rapid-2", "rapid-3"].entries()) assert.equal(rapid.insert(action(index + 1, 0, id)).status, "applied");
assert.equal(rapid.state.players.playerB.room.balloons.length, 0, "Rapid POP applies without a serialized request queue");

const old = new FloatRealtimeTimeline(createFloatMatch({ matchId: action(1, 0, "old").matchId, playerIds: ["playerA", "playerB"], seed: 902 }));
old.advanceTo(61);
assert.equal(old.insert(action(1, 0, "old")).status, "too_old");

function stressState() {
  const state = createFloatMatch({ matchId: action(1, 0, "stress").matchId, playerIds: ["playerA", "playerB"], seed: 903 });
  for (const actor of ["playerA", "playerB"]) {
    const room = state.players[actor].room;
    for (let index = 1; index <= 40; index += 1) room.balloons.push(createBasicBalloon(room.id, `${actor}-stress-${index}`, (index % 4) + 1));
  }
  return state;
}

const peerA = new FloatRealtimeTimeline(stressState());
const peerB = new FloatRealtimeTimeline(stressState());
const inboxAtA = new FloatSequenceInbox();
const inboxAtB = new FloatSequenceInbox();
const scheduled = [];
const journals = { playerA: [], playerB: [] };
const delayPattern = [0, 6, 15, 30];
for (let tick = 0; tick < 90; tick += 1) {
  if (tick < 10) {
    for (const actor of ["playerA", "playerB"]) {
      for (let offset = 1; offset <= 4; offset += 1) {
        const sequence = tick * 4 + offset;
        const envelope = action(sequence, tick, `${actor}-stress-${sequence}`, actor);
        journals[actor].push(envelope);
        const local = actor === "playerA" ? peerA : peerB;
        assert.equal(local.insert(envelope).status, "applied");
        if (sequence % 7 !== 0) {
          const deliverAt = tick + delayPattern[sequence % delayPattern.length];
          scheduled.push({ deliverAt, envelope });
          if (sequence % 5 === 0) scheduled.push({ deliverAt: deliverAt + 1, envelope });
        }
      }
    }
  }
  if (tick === 40) {
    for (const actor of ["playerA", "playerB"]) {
      for (const envelope of journals[actor]) scheduled.push({ deliverAt: tick, envelope });
    }
  }
  for (const delivery of scheduled.filter((item) => item.deliverAt === tick)) {
    const receiver = delivery.envelope.actorPlayerId === "playerA" ? peerB : peerA;
    const inbox = delivery.envelope.actorPlayerId === "playerA" ? inboxAtB : inboxAtA;
    const received = inbox.receive(delivery.envelope);
    for (const ready of received.ready) assert.notEqual(receiver.insert(ready).status, "rejected");
  }
  peerA.advanceTo(tick + 1);
  peerB.advanceTo(tick + 1);
}
assert.equal(inboxAtA.getThroughSequence(), 40);
assert.equal(inboxAtB.getThroughSequence(), 40);
assert.deepEqual(peerA.state, peerB.state, "Two peers must converge through burst loss, gaps, replay, duplicates, and 500ms jitter");

const alignedCoordinates = { protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION, coreVersion: "8.1.0", simulationTick: 90, playerASequence: 40, playerBSequence: 40 };
assert.equal(await hashFloatState(alignedCoordinates, peerA.state), await hashFloatState(alignedCoordinates, peerB.state), "Aligned identical states must hash equally");
assert.notEqual(floatHashCoordinateKey(alignedCoordinates), floatHashCoordinateKey({ ...alignedCoordinates, simulationTick: 91 }), "Different ticks must never share a comparison key");
assert.notEqual(floatHashCoordinateKey(alignedCoordinates), floatHashCoordinateKey({ ...alignedCoordinates, playerBSequence: 39 }), "A missing action must be detected as a cursor mismatch before hashes are compared");
const divergentState = structuredClone(peerB.state);
divergentState.players.playerB.room.health -= 1;
assert.notEqual(await hashFloatState(alignedCoordinates, peerA.state), await hashFloatState(alignedCoordinates, divergentState), "True aligned divergence must produce a hash mismatch");

console.log("Float Phase 9.1 gate passed: integer ticks, all action mappings, total ordering, actor validation, gaps, loss replay, deduplication, rapid POP bursts, 0/100/250/500ms convergence, and cursor-aligned divergence hashes.");
