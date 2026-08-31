import assert from "node:assert/strict";
import { BALLOON_SPAWN_Y, BASIC_BALLOON } from "../lib/balloonRooms/constants.ts";
import {
  createBalloonRoom,
  createBasicBalloon,
  createDevBalloonSpawner,
  damageBalloon,
  findBalloonAtPoint,
  updateDevBalloonSpawner,
  updateRoomSimulation,
} from "../lib/balloonRooms/simulation.ts";

const room = createBalloonRoom("left");
const balloon = createBasicBalloon(room.id, "basic-1", 0.5);
assert.equal(balloon.y, BALLOON_SPAWN_Y);
assert.equal(balloon.health, 3);
room.balloons.push(balloon);

updateRoomSimulation(room, 1);
assert.equal(balloon.y, BALLOON_SPAWN_Y - BASIC_BALLOON.speed);

assert.deepEqual(damageBalloon(room, balloon.id), { balloonId: balloon.id, remainingHealth: 2, popped: false });
assert.equal(room.balloons.length, 1);
assert.deepEqual(damageBalloon(room, balloon.id), { balloonId: balloon.id, remainingHealth: 1, popped: false });
assert.deepEqual(damageBalloon(room, balloon.id), { balloonId: balloon.id, remainingHealth: 0, popped: true });
assert.equal(room.balloons.length, 0);
updateRoomSimulation(room, 100);
assert.equal(room.health, 20, "a popped balloon cannot damage its room");

const escaping = createBasicBalloon(room.id, "escape-1", 0.4);
escaping.y = escaping.radius + 0.001;
room.balloons.push(escaping);
const escapeEvents = updateRoomSimulation(room, 1);
assert.equal(escapeEvents.length, 1);
assert.equal(escapeEvents[0].type, "balloon_escaped");
assert.equal(room.health, 19);
assert.equal(room.balloons.length, 0);
updateRoomSimulation(room, 1);
assert.equal(room.health, 19, "an escaped balloon can damage its room only once");

const overlapRoom = createBalloonRoom("overlap");
const first = createBasicBalloon(overlapRoom.id, "first", 0.5);
const second = createBasicBalloon(overlapRoom.id, "second", 0.51);
first.y = second.y = 0.5;
overlapRoom.balloons.push(first, second);
const target = findBalloonAtPoint(overlapRoom, 0.5, 0.5);
assert.ok(target);
damageBalloon(overlapRoom, target.id);
assert.equal(overlapRoom.balloons.filter((candidate) => candidate.health === 2).length, 1);
assert.equal(overlapRoom.balloons.filter((candidate) => candidate.health === 3).length, 1);

const brokenRoom = createBalloonRoom("broken");
brokenRoom.health = 1;
const finalEscape = createBasicBalloon(brokenRoom.id, "final", 0.5);
finalEscape.y = finalEscape.radius;
brokenRoom.balloons.push(finalEscape);
updateRoomSimulation(brokenRoom, 0.1);
assert.equal(brokenRoom.health, 0);
const frozenY = createBasicBalloon(brokenRoom.id, "frozen", 0.5);
brokenRoom.balloons.push(frozenY);
updateRoomSimulation(brokenRoom, 10);
assert.equal(frozenY.y, BALLOON_SPAWN_Y);
const spawner = createDevBalloonSpawner(1);
assert.equal(updateDevBalloonSpawner(brokenRoom, spawner, 10).length, 0);

const independent = createBalloonRoom("independent");
const independentSpawner = createDevBalloonSpawner(2);
assert.equal(updateDevBalloonSpawner(independent, independentSpawner, 0.4).length, 1);
assert.equal(independent.balloons.length, 1);
assert.equal(brokenRoom.health, 0);

const crowdedRooms = [createBalloonRoom("crowded-left"), createBalloonRoom("crowded-right")];
for (const crowdedRoom of crowdedRooms) {
  for (let index = 0; index < 50; index += 1) {
    crowdedRoom.balloons.push(createBasicBalloon(crowdedRoom.id, `${crowdedRoom.id}-${index}`, 0.2 + (index % 10) * 0.06));
  }
  updateRoomSimulation(crowdedRoom, 0.1);
  assert.equal(crowdedRoom.balloons.length, 50);
}

console.log("Balloon Rooms simulation passed: movement, 1:1 damage, popping, escape, room break, independent spawning, and 50 balloons per room.");
