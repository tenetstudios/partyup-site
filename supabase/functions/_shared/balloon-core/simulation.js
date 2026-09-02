import { BALLOON_TYPES, DEV_SPAWN_MAX_SECONDS, DEV_SPAWN_MIN_SECONDS, GLUE_SPEED_MULTIPLIER, MANUAL_POP_DAMAGE, ROOM_MAX_HEALTH } from "./constants.js";
import { getCellCenter, getLaneCell, SPAWN_LANES } from "./grid.js";
import { getNailsTouchingCell, getWallsTouchingCell, removeNailStripById } from "./nails.js";
import { getGlueTouchingCell } from "./glue.js";
import { findPathToCeiling } from "./pathfinding.js";
import { createPlayerEconomy } from "./economy.js";
import { classifyStructuralImpact, damageWallStructure, getStructuralDamage } from "./walls.js";
export function createBalloonRoom(id) {
    return { id, economy: createPlayerEconomy(), attack: { queue: [], lastLaunchAt: null, nextLaunchAt: null }, unlockedBalloonTypes: { basic: true, speed: false, heavy: false }, health: ROOM_MAX_HEALTH, maxHealth: ROOM_MAX_HEALTH, balloons: [], processedSendIds: [], walls: [], nailStrips: [], glueTraps: [], wallRevision: 0, width: 1, height: 1 };
}
export function createBasicBalloon(roomId, id, spawnLane, pathBias = "left") {
    return createBalloon(roomId, id, "basic", spawnLane, pathBias);
}
export function createBalloon(roomId, id, balloonType, spawnLane, pathBias = "left", source = "player", metadata = {}) {
    const config = BALLOON_TYPES[balloonType];
    const currentCell = getLaneCell(spawnLane);
    const position = getCellCenter(currentCell);
    return { id, roomId, x: position.x, y: position.y, health: config.maxHealth, maxHealth: config.maxHealth, speed: config.speed, radius: config.radius, roomDamage: config.roomDamage, balloonType, source, roundId: metadata.roundId ?? null, waveSequence: metadata.waveSequence ?? null, senderId: metadata.senderId ?? null, status: "active", spawnLane, pathBias, currentCell, targetCell: null, path: [], pathRevision: -1, contactingNailIds: [], contactingWallIds: [], glued: false };
}
export function recalculateBalloonPath(room, balloon) {
    const path = findPathToCeiling(balloon.currentCell, room.walls, balloon.pathBias);
    balloon.path = path ?? [];
    balloon.targetCell = path?.[1] ?? null;
    balloon.pathRevision = room.wallRevision;
    return path !== null;
}
export function updateBalloonPosition(room, balloon, deltaSeconds) {
    if (balloon.status !== "active" || deltaSeconds <= 0)
        return [];
    const events = [];
    let remainingSeconds = deltaSeconds;
    let contactOrigin = getContactOrigin(balloon);
    while (remainingSeconds > 0 && balloon.status === "active") {
        events.push(...resolveWallContact(room, balloon, contactOrigin));
        if (balloon.status !== "active")
            return events;
        contactOrigin = { ...balloon.currentCell };
        if (balloon.currentCell.row === 0 && !balloon.targetCell) {
            balloon.y -= balloon.speed * remainingSeconds;
            return events;
        }
        if (balloon.pathRevision !== room.wallRevision && !recalculateBalloonPath(room, balloon))
            return events;
        if (!balloon.targetCell && !recalculateBalloonPath(room, balloon))
            return events;
        const targetCell = balloon.targetCell;
        if (!targetCell)
            continue;
        const target = getCellCenter(targetCell);
        const distance = Math.hypot(target.x - balloon.x, target.y - balloon.y);
        if (distance <= 0.000001) {
            balloon.currentCell = { ...targetCell };
            balloon.targetCell = null;
            balloon.path = [];
            continue;
        }
        const movementSpeed = balloon.speed;
        const travelDistance = movementSpeed * remainingSeconds;
        if (travelDistance < distance) {
            balloon.x += ((target.x - balloon.x) / distance) * travelDistance;
            balloon.y += ((target.y - balloon.y) / distance) * travelDistance;
            return events;
        }
        const previousCell = { ...balloon.currentCell };
        balloon.x = target.x;
        balloon.y = target.y;
        balloon.currentCell = { ...targetCell };
        balloon.targetCell = null;
        balloon.path = [];
        remainingSeconds -= distance / movementSpeed;
        contactOrigin = previousCell;
    }
    return events;
}
function resolveWallContact(room, balloon, movementFrom) {
    const events = [];
    const touchingWalls = getWallsTouchingCell(room, balloon.currentCell);
    const touchingWallIds = touchingWalls.map((wall) => wall.id);
    const previousWallContacts = new Set(balloon.contactingWallIds);
    balloon.contactingWallIds = touchingWallIds;
    const touchingGlue = getGlueTouchingCell(room, balloon.currentCell);
    if (!balloon.glued && touchingGlue.length > 0) {
        const glue = touchingGlue[0];
        const speedBefore = balloon.speed;
        balloon.glued = true;
        balloon.speed = BALLOON_TYPES[balloon.balloonType].speed * GLUE_SPEED_MULTIPLIER;
        events.push({ type: "glue_contact", balloonId: balloon.id, glueId: glue.id, wallSegmentId: glue.wallSegmentId, speedBefore, speedAfter: balloon.speed });
    }
    const touchingNails = getNailsTouchingCell(room, balloon.currentCell);
    const previousNailContacts = new Set(balloon.contactingNailIds);
    balloon.contactingNailIds = touchingNails.map((nail) => nail.id);
    for (const nail of touchingNails) {
        if (previousNailContacts.has(nail.id) || nail.status !== "active")
            continue;
        const balloonHealthBefore = balloon.health;
        const durabilityBefore = nail.durability;
        const damage = Math.min(balloon.health, nail.durability);
        const result = damageBalloon(room, balloon.id, damage);
        if (!result)
            continue;
        nail.durability = Math.max(0, nail.durability - damage);
        if (nail.durability === 0) {
            nail.status = "broken";
            removeNailStripById(room, nail.id);
        }
        events.push({ type: "nail_contact", balloonId: balloon.id, nailStripId: nail.id, wallSegmentId: nail.wallSegmentId, balloonHealthBefore, balloonHealthAfter: result.remainingHealth, durabilityBefore, durabilityAfter: nail.durability, popped: result.popped });
        if (result.popped)
            return events;
    }
    if (balloon.balloonType !== "heavy")
        return events;
    for (const wall of touchingWalls) {
        if (previousWallContacts.has(wall.id) || !room.walls.some((candidate) => candidate.id === wall.id))
            continue;
        const impact = classifyStructuralImpact(movementFrom, balloon.currentCell, wall);
        const damage = getStructuralDamage(balloon.balloonType, impact);
        const result = damageWallStructure(room, wall.id, damage);
        if (!result)
            continue;
        events.push({
            type: "wall_damage",
            balloonId: balloon.id,
            wallSegmentId: wall.id,
            impact,
            damage,
            integrityBefore: result.integrityBefore,
            integrityAfter: result.integrityAfter,
            destroyed: result.destruction !== null,
        });
        if (result.destruction) {
            events.push({ type: "wall_destroyed", balloonId: balloon.id, wall: result.destruction.destroyedWall, collapsedWalls: result.destruction.collapsedWalls, removedNailStripIds: result.destruction.removedNailStripIds, removedGlueIds: result.destruction.removedGlueIds });
        }
    }
    return events;
}
function getContactOrigin(balloon) {
    if (balloon.targetCell) {
        return {
            column: balloon.currentCell.column - (balloon.targetCell.column - balloon.currentCell.column),
            row: balloon.currentCell.row - (balloon.targetCell.row - balloon.currentCell.row),
        };
    }
    return { column: balloon.currentCell.column, row: balloon.currentCell.row + 1 };
}
export function updateRoomSimulation(room, deltaSeconds) {
    if (room.health <= 0 || deltaSeconds <= 0)
        return [];
    const events = [];
    for (const balloon of [...room.balloons]) {
        events.push(...updateBalloonPosition(room, balloon, deltaSeconds));
        if (balloon.status === "active" && balloon.y - balloon.radius <= 0) {
            balloon.status = "escaped";
            const damage = Math.min(room.health, balloon.roomDamage);
            room.health = Math.max(0, room.health - balloon.roomDamage);
            events.push({ type: "balloon_escaped", balloon: { ...balloon }, damage });
        }
    }
    if (events.length > 0)
        room.balloons = room.balloons.filter((balloon) => balloon.status === "active");
    return events;
}
export function damageBalloon(room, balloonId, damage = MANUAL_POP_DAMAGE) {
    const balloonIndex = room.balloons.findIndex((candidate) => candidate.id === balloonId && candidate.status === "active");
    if (balloonIndex < 0 || damage <= 0 || room.health <= 0)
        return null;
    const balloon = room.balloons[balloonIndex];
    if (!balloon)
        return null;
    balloon.health = Math.max(0, balloon.health - damage);
    const popped = balloon.health === 0;
    if (popped) {
        balloon.status = "popped";
        room.balloons.splice(balloonIndex, 1);
    }
    return { balloonId, remainingHealth: balloon.health, popped };
}
export function findBalloonAtPoint(room, x, y, minimumHitRadius = 0) {
    let target = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const balloon of room.balloons) {
        if (balloon.status !== "active")
            continue;
        const distance = Math.hypot(balloon.x - x, balloon.y - y);
        if (distance <= Math.max(balloon.radius, minimumHitRadius) && distance < closestDistance) {
            target = balloon;
            closestDistance = distance;
        }
    }
    return target;
}
export function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
export function createDevBalloonSpawner(seed) {
    return { secondsUntilSpawn: 0.35, sequence: 0, random: createSeededRandom(seed) };
}
export function updateDevBalloonSpawner(room, spawner, deltaSeconds) {
    if (room.health <= 0 || deltaSeconds <= 0)
        return [];
    const spawned = [];
    spawner.secondsUntilSpawn -= deltaSeconds;
    while (spawner.secondsUntilSpawn <= 0) {
        spawner.sequence += 1;
        const lane = SPAWN_LANES[Math.min(SPAWN_LANES.length - 1, Math.floor(spawner.random() * SPAWN_LANES.length))];
        const pathBias = spawner.random() < 0.5 ? "left" : "right";
        const balloon = createBasicBalloon(room.id, `${room.id}-${spawner.sequence}`, lane, pathBias);
        recalculateBalloonPath(room, balloon);
        room.balloons.push(balloon);
        spawned.push(balloon);
        spawner.secondsUntilSpawn += DEV_SPAWN_MIN_SECONDS + spawner.random() * (DEV_SPAWN_MAX_SECONDS - DEV_SPAWN_MIN_SECONDS);
    }
    return spawned;
}
//# sourceMappingURL=simulation.js.map