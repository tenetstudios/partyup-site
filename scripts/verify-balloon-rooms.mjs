import assert from "node:assert/strict";
import { MAX_WALL_SEGMENTS } from "../lib/balloonRooms/constants.ts";
import { createWallSegment, getLaneCell, SPAWN_LANES } from "../lib/balloonRooms/grid.ts";
import { findPathToCeiling } from "../lib/balloonRooms/pathfinding.ts";
import {
  createBalloonRoom,
  createBasicBalloon,
  createDevBalloonSpawner,
  damageBalloon,
  findBalloonAtPoint,
  recalculateBalloonPath,
  updateDevBalloonSpawner,
  updateRoomSimulation,
} from "../lib/balloonRooms/simulation.ts";
import {
  getUnsupportedHorizontalWalls,
  hasRequiredRoutes,
  placeWall,
  removeWall,
  validateWallPlacement,
} from "../lib/balloonRooms/walls.ts";

function wall(room, orientation, gridX, gridY) {
  return createWallSegment(room.id, orientation, gridX, gridY);
}

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

console.log("Balloon Rooms Phase 2 passed: grid walls, support grammar, four lanes, BFS routing, live reroute, removal safety, Phase 1 popping, and 50 balloons per room.");
