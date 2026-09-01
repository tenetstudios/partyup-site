import assert from "node:assert/strict";
import {
  MAX_NAIL_STRIPS,
  MAX_WALL_SEGMENTS,
  NAIL_DAMAGE,
  NAIL_MAX_DURABILITY,
  SPAWN_LANES,
  applyGameAction,
  createBalloonRoom,
  createBasicBalloon,
  createDevBalloonSpawner,
  createSendBalloonAction,
  createWallSegment,
  damageBalloon,
  findBalloonAtPoint,
  findPathToCeiling,
  getCellCenter,
  getLaneCell,
  getUnsupportedHorizontalWalls,
  hasRequiredRoutes,
  placeNailStrip,
  placeWall,
  recalculateBalloonPath,
  removeNailStrip,
  removeWall,
  updateDevBalloonSpawner,
  updateBalloonPosition,
  updateRoomSimulation,
  validateWallPlacement,
} from "@partyup/balloon-core";

function wall(room, orientation, gridX, gridY) {
  return createWallSegment(room.id, orientation, gridX, gridY);
}

function sendAction(room, lane, senderSequence) {
  return createSendBalloonAction({
    matchId: "web-verification",
    senderId: "web-player",
    targetRoomId: room.id,
    lane,
    senderSequence,
    sentAt: senderSequence * 1000,
  });
}

// Phase 4 client contract: each action creates one balloon in the chosen lane and selection can change.
const sendRoom = createBalloonRoom("web-send");
assert.equal(applyGameAction(sendRoom, sendAction(sendRoom, 3, 1)).applied, true);
assert.equal(sendRoom.balloons.length, 1);
assert.equal(sendRoom.balloons[0].spawnLane, 3);
assert.equal(applyGameAction(sendRoom, sendAction(sendRoom, 3, 2)).applied, true);
assert.equal(applyGameAction(sendRoom, sendAction(sendRoom, 1, 3)).applied, true);
assert.deepEqual(sendRoom.balloons.map((balloon) => balloon.spawnLane), [3, 3, 1]);

// Phase 1 regression: one tap is one damage event, three taps pop, and popped balloons never escape.
const popRoom = createBalloonRoom("pop");
const poppedBalloon = createBasicBalloon(popRoom.id, "basic-1", 2, "left");
popRoom.balloons.push(poppedBalloon);
assert.deepEqual(damageBalloon(popRoom, poppedBalloon.id), { balloonId: poppedBalloon.id, remainingHealth: 2, popped: false });
assert.deepEqual(damageBalloon(popRoom, poppedBalloon.id), { balloonId: poppedBalloon.id, remainingHealth: 1, popped: false });
assert.deepEqual(damageBalloon(popRoom, poppedBalloon.id), { balloonId: poppedBalloon.id, remainingHealth: 0, popped: true });
assert.equal(popRoom.balloons.length, 0);
updateRoomSimulation(popRoom, 20);
assert.equal(popRoom.health, 20);

const overlapRoom = createBalloonRoom("overlap");
const first = createBasicBalloon(overlapRoom.id, "first", 2, "left");
const second = createBasicBalloon(overlapRoom.id, "second", 2, "right");
overlapRoom.balloons.push(first, second);
const target = findBalloonAtPoint(overlapRoom, first.x, first.y);
assert.ok(target);
damageBalloon(overlapRoom, target.id);
assert.equal(overlapRoom.balloons.filter((candidate) => candidate.health === 2).length, 1);
assert.equal(overlapRoom.balloons.filter((candidate) => candidate.health === 3).length, 1);

// A. Simple deflection: a supported horizontal segment forces Lane 2 around its left end.
const deflectionRoom = createBalloonRoom("deflection");
assert.equal(placeWall(deflectionRoom, wall(deflectionRoom, "vertical", 3, 5)).valid, true);
assert.equal(placeWall(deflectionRoom, wall(deflectionRoom, "horizontal", 2, 5)).valid, true);
const deflectedPath = findPathToCeiling(getLaneCell(2), deflectionRoom.walls, "left");
assert.ok(deflectedPath);
assert.ok(deflectedPath.some((cell) => cell.column === 1), "Lane 2 should travel around the span");

// B. Supported span: two horizontal pieces connected to a vertical support are valid.
const supportedRoom = createBalloonRoom("supported");
assert.equal(placeWall(supportedRoom, wall(supportedRoom, "vertical", 3, 5)).valid, true);
assert.equal(placeWall(supportedRoom, wall(supportedRoom, "horizontal", 2, 5)).valid, true);
assert.equal(placeWall(supportedRoom, wall(supportedRoom, "horizontal", 3, 5)).valid, true);
assert.equal(getUnsupportedHorizontalWalls(supportedRoom.walls).length, 0);

// C. Unsupported span: the third piece extending from one support exceeds distance two.
const unsupportedRoom = createBalloonRoom("unsupported");
placeWall(unsupportedRoom, wall(unsupportedRoom, "vertical", 1, 5));
assert.equal(placeWall(unsupportedRoom, wall(unsupportedRoom, "horizontal", 1, 5)).valid, true);
assert.equal(placeWall(unsupportedRoom, wall(unsupportedRoom, "horizontal", 2, 5)).valid, true);
const unsupportedResult = validateWallPlacement(unsupportedRoom, wall(unsupportedRoom, "horizontal", 3, 5));
assert.equal(unsupportedResult.code, "needs_support");

// D. Multi-support span: every piece is within two connected edges of either support.
const multiSupportRoom = createBalloonRoom("multi-support");
const multiSupportWalls = [
  wall(multiSupportRoom, "vertical", 1, 4),
  wall(multiSupportRoom, "vertical", 5, 4),
  ...Array.from({ length: 6 }, (_, gridX) => wall(multiSupportRoom, "horizontal", gridX, 5)),
];
assert.equal(getUnsupportedHorizontalWalls(multiSupportWalls).length, 0);

// E. Four lanes retain distinct starts and can produce different routes through one structure.
const lanePaths = SPAWN_LANES.map((lane) => findPathToCeiling(getLaneCell(lane), deflectionRoom.walls, lane % 2 ? "left" : "right"));
assert.ok(lanePaths.every(Boolean));
assert.equal(new Set(SPAWN_LANES.map((lane) => getLaneCell(lane).column)).size, 4);
assert.notDeepEqual(lanePaths[0], lanePaths[1]);

// Equal shortest routes honor persistent bias without overriding BFS distance.
const tieRoom = createBalloonRoom("tie");
const tieWall = wall(tieRoom, "horizontal", 2, 5);
const leftPath = findPathToCeiling(getLaneCell(2), [tieWall], "left");
const rightPath = findPathToCeiling(getLaneCell(2), [tieWall], "right");
assert.ok(leftPath?.some((cell) => cell.column === 1));
assert.ok(rightPath?.some((cell) => cell.column === 3));
assert.equal(leftPath?.length, rightPath?.length);

// F. Live reroute: adding a wall ahead changes an already-moving balloon's route without moving it instantly.
const liveRoom = createBalloonRoom("live");
const liveBalloon = createBasicBalloon(liveRoom.id, "live-balloon", 2, "left");
liveRoom.balloons.push(liveBalloon);
recalculateBalloonPath(liveRoom, liveBalloon);
updateRoomSimulation(liveRoom, 1);
const beforeWall = { x: liveBalloon.x, y: liveBalloon.y };
placeWall(liveRoom, wall(liveRoom, "vertical", 3, 5));
placeWall(liveRoom, wall(liveRoom, "horizontal", 2, 5));
assert.deepEqual({ x: liveBalloon.x, y: liveBalloon.y }, beforeWall, "wall placement must not teleport a balloon");
updateRoomSimulation(liveRoom, 5);
assert.ok(liveBalloon.x < getLaneCell(2).column / 6 + 1 / 12, "balloon should reroute laterally around the new wall");

// G. Illegal seal: the final segment in a supported full-width barrier is rejected.
const sealRoom = createBalloonRoom("seal");
placeWall(sealRoom, wall(sealRoom, "vertical", 1, 4));
placeWall(sealRoom, wall(sealRoom, "vertical", 5, 4));
for (const gridX of [0, 1, 2, 5, 4]) {
  assert.equal(placeWall(sealRoom, wall(sealRoom, "horizontal", gridX, 5)).valid, true);
}
const sealResult = validateWallPlacement(sealRoom, wall(sealRoom, "horizontal", 3, 5));
assert.equal(sealResult.code, "path_required");
assert.equal(hasRequiredRoutes(sealRoom, sealRoom.walls), true);

// H. Removing a support required by active spans is rejected.
const supportId = wall(supportedRoom, "vertical", 3, 5).id;
const supportRemoval = removeWall(supportedRoom, supportId);
assert.equal(supportRemoval.code, "supporting_span");
assert.ok(supportedRoom.walls.some((candidate) => candidate.id === supportId));

// Wall budget is shared by both orientations and capped centrally.
const budgetRoom = createBalloonRoom("budget");
for (let row = 0; row < MAX_WALL_SEGMENTS; row += 1) {
  assert.equal(placeWall(budgetRoom, wall(budgetRoom, "vertical", 1, row)).valid, true);
}
assert.equal(validateWallPlacement(budgetRoom, wall(budgetRoom, "vertical", 2, 0)).code, "budget_reached");

// Dev spawning uses only the four typed lanes, exercises all four deterministically, and rooms remain independent.
const spawnRoom = createBalloonRoom("spawn");
const spawner = createDevBalloonSpawner(2);
updateDevBalloonSpawner(spawnRoom, spawner, 40);
assert.deepEqual([...new Set(spawnRoom.balloons.map((balloon) => balloon.spawnLane))].sort(), [1, 2, 3, 4]);
const independentRoom = createBalloonRoom("independent");
assert.equal(independentRoom.balloons.length, 0);

// Ceiling escape still damages exactly once, and a broken room freezes movement and spawning.
const escapeRoom = createBalloonRoom("escape");
escapeRoom.health = 1;
const escaping = createBasicBalloon(escapeRoom.id, "escape-1", 1, "right");
escapeRoom.balloons.push(escaping);
const escapeEvents = updateRoomSimulation(escapeRoom, 20);
assert.equal(escapeEvents.filter((event) => event.type === "balloon_escaped").length, 1);
assert.equal(escapeRoom.health, 0);
const frozen = createBasicBalloon(escapeRoom.id, "frozen", 4, "left");
escapeRoom.balloons.push(frozen);
const frozenPosition = { x: frozen.x, y: frozen.y };
updateRoomSimulation(escapeRoom, 10);
assert.deepEqual({ x: frozen.x, y: frozen.y }, frozenPosition);
assert.equal(updateDevBalloonSpawner(escapeRoom, createDevBalloonSpawner(1), 10).length, 0);

// Both rooms comfortably process 50 active balloons with independent paths.
for (const roomId of ["crowded-left", "crowded-right"]) {
  const crowdedRoom = createBalloonRoom(roomId);
  for (let index = 0; index < 50; index += 1) {
    crowdedRoom.balloons.push(createBasicBalloon(crowdedRoom.id, `${roomId}-${index}`, SPAWN_LANES[index % 4], index % 2 ? "left" : "right"));
  }
  updateRoomSimulation(crowdedRoom, 0.1);
  assert.equal(crowdedRoom.balloons.length, 50);
}

function createArmedContactRoom(id, durability = NAIL_MAX_DURABILITY) {
  const room = createBalloonRoom(id);
  const armedWall = wall(room, "vertical", 3, 8);
  assert.equal(placeWall(room, armedWall).valid, true);
  assert.equal(placeNailStrip(room, armedWall.id).valid, true);
  room.nailStrips[0].durability = durability;
  return room;
}

// Phase 3 placement requires an existing, unarmed wall and obeys the centralized four-strip limit.
const nailPlacementRoom = createBalloonRoom("nail-placement");
assert.equal(placeNailStrip(nailPlacementRoom, "missing-wall").code, "wall_required");
for (let row = 0; row < MAX_NAIL_STRIPS + 1; row += 1) {
  assert.equal(placeWall(nailPlacementRoom, wall(nailPlacementRoom, "vertical", 1, row)).valid, true);
}
for (const armedWall of nailPlacementRoom.walls.slice(0, MAX_NAIL_STRIPS)) {
  assert.equal(placeNailStrip(nailPlacementRoom, armedWall.id).valid, true);
}
assert.equal(nailPlacementRoom.nailStrips.length, MAX_NAIL_STRIPS);
assert.equal(placeNailStrip(nailPlacementRoom, nailPlacementRoom.walls[MAX_NAIL_STRIPS].id).code, "limit_reached");
assert.equal(placeNailStrip(nailPlacementRoom, nailPlacementRoom.walls[0].id).code, "duplicate");

// A completed logical move into either cell bordering an armed wall is one contact, independent of frames.
const damageRoom = createArmedContactRoom("nail-damage");
const nailTarget = createBasicBalloon(damageRoom.id, "nail-target", 2, "left");
damageRoom.balloons.push(nailTarget);
const firstContactEvents = updateRoomSimulation(damageRoom, 1).filter((event) => event.type === "nail_contact");
assert.equal(firstContactEvents.length, 1);
assert.equal(nailTarget.health, 3 - NAIL_DAMAGE);
assert.equal(damageRoom.nailStrips[0].durability, NAIL_MAX_DURABILITY - 1);
updateRoomSimulation(damageRoom, 0.25);
assert.equal(nailTarget.health, 2, "render/fixed-step frames beside the strip must not duplicate contact");
assert.equal(damageRoom.nailStrips[0].durability, 9);

// The same Nail Strip primitive arms horizontal walls and uses the same contact rule.
const horizontalNailRoom = createBalloonRoom("horizontal-nails");
assert.equal(placeWall(horizontalNailRoom, wall(horizontalNailRoom, "vertical", 3, 8)).valid, true);
const horizontalArmedWall = wall(horizontalNailRoom, "horizontal", 2, 9);
assert.equal(placeWall(horizontalNailRoom, horizontalArmedWall).valid, true);
assert.equal(placeNailStrip(horizontalNailRoom, horizontalArmedWall.id).valid, true);
const horizontalTarget = createBasicBalloon(horizontalNailRoom.id, "horizontal-target", 2, "left");
horizontalNailRoom.balloons.push(horizontalTarget);
const horizontalStart = getCellCenter({ column: 1, row: 9 });
Object.assign(horizontalTarget, {
  x: horizontalStart.x,
  y: horizontalStart.y,
  currentCell: { column: 1, row: 9 },
  targetCell: { column: 2, row: 9 },
  path: [{ column: 1, row: 9 }, { column: 2, row: 9 }],
  pathRevision: horizontalNailRoom.wallRevision,
});
assert.equal(updateBalloonPosition(horizontalNailRoom, horizontalTarget, 2).filter((event) => event.type === "nail_contact").length, 1);
assert.equal(horizontalTarget.health, 2);
assert.equal(horizontalNailRoom.nailStrips[0].durability, 9);

// A legal wall route can make one BFS-driven balloon leave and encounter the same strip from its other side.
const repeatRoom = createBalloonRoom("repeat-contact");
const repeatStructure = [
  wall(repeatRoom, "vertical", 3, 4),
  wall(repeatRoom, "horizontal", 2, 5),
  wall(repeatRoom, "vertical", 1, 3),
  wall(repeatRoom, "horizontal", 1, 4),
  wall(repeatRoom, "horizontal", 0, 4),
  wall(repeatRoom, "horizontal", 3, 4),
];
for (const structureWall of repeatStructure) assert.equal(placeWall(repeatRoom, structureWall).valid, true);
assert.equal(placeNailStrip(repeatRoom, repeatStructure[1].id).valid, true);
const repeatTarget = createBasicBalloon(repeatRoom.id, "repeat-target", 2, "left");
repeatRoom.balloons.push(repeatTarget);
recalculateBalloonPath(repeatRoom, repeatTarget);
const routedPath = repeatTarget.path.map((cell) => `${cell.column}:${cell.row}`);
assert.ok(routedPath.indexOf("2:5") < routedPath.indexOf("2:4"));
const repeatEvents = updateBalloonPosition(repeatRoom, repeatTarget, 8).filter((event) => event.type === "nail_contact");
assert.equal(repeatEvents.length, 2);
assert.equal(repeatTarget.health, 1);
assert.equal(repeatRoom.nailStrips[0].durability, 8);
assert.deepEqual(damageBalloon(repeatRoom, repeatTarget.id), { balloonId: repeatTarget.id, remainingHealth: 0, popped: true });

// Nail kills use the same damage/removal lifecycle and can never escape afterward.
const nailPopRoom = createArmedContactRoom("nail-pop");
const nailPopBalloon = createBasicBalloon(nailPopRoom.id, "nail-pop-target", 2, "right");
nailPopBalloon.health = 1;
nailPopRoom.balloons.push(nailPopBalloon);
const popEvents = updateRoomSimulation(nailPopRoom, 1);
assert.ok(popEvents.some((event) => event.type === "nail_contact" && event.popped));
assert.equal(nailPopRoom.balloons.length, 0);
const healthAfterNailPop = nailPopRoom.health;
updateRoomSimulation(nailPopRoom, 20);
assert.equal(nailPopRoom.health, healthAfterNailPop);

// The last durability point deals damage, then automatically removes the strip while preserving its wall.
const breakRoom = createArmedContactRoom("nail-break", 1);
const breaker = createBasicBalloon(breakRoom.id, "breaker", 2, "left");
breakRoom.balloons.push(breaker);
updateRoomSimulation(breakRoom, 1);
assert.equal(breaker.health, 2);
assert.equal(breakRoom.nailStrips.length, 0);
const afterBreak = createBasicBalloon(breakRoom.id, "after-break", 2, "right");
breakRoom.balloons.push(afterBreak);
updateRoomSimulation(breakRoom, 1);
assert.equal(afterBreak.health, 3);
assert.equal(breakRoom.walls.length, 1);

// Exhaustion returns inventory immediately, and repositioned nails still return at full durability.
const armedWallId = breakRoom.walls[0].id;
assert.equal(placeNailStrip(breakRoom, armedWallId).valid, true);
assert.equal(breakRoom.nailStrips[0].durability, NAIL_MAX_DURABILITY);
assert.equal(breakRoom.nailStrips[0].status, "active");

// Nails are absent from BFS inputs: adding and removing one cannot alter an otherwise identical route.
const pathBeforeNails = findPathToCeiling(getLaneCell(2), breakRoom.walls, "left");
removeNailStrip(breakRoom, armedWallId);
const pathWithoutNails = findPathToCeiling(getLaneCell(2), breakRoom.walls, "left");
placeNailStrip(breakRoom, armedWallId);
const pathAfterNails = findPathToCeiling(getLaneCell(2), breakRoom.walls, "left");
assert.deepEqual(pathBeforeNails, pathWithoutNails);
assert.deepEqual(pathWithoutNails, pathAfterNails);

console.log("Balloon Rooms Phase 4 passed: chosen-lane sends, popping, wall/path rules, deterministic nail contact, automatic nail exhaustion, removal, repeat contact, and path independence.");
