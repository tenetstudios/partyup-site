import {
  BASIC_BALLOON,
  DEV_SPAWN_MAX_SECONDS,
  DEV_SPAWN_MIN_SECONDS,
  MANUAL_TAP_DAMAGE,
  ROOM_MAX_HEALTH,
} from "./constants.ts";
import { getCellCenter, getLaneCell, isTraversalBlocked, SPAWN_LANES } from "./grid.ts";
import { findPathToCeiling } from "./pathfinding.ts";
import type {
  Balloon,
  BalloonDamageResult,
  BalloonRoom,
  BalloonSimulationEvent,
  PathBias,
  SpawnLane,
} from "./types.ts";

export type DevBalloonSpawner = {
  secondsUntilSpawn: number;
  sequence: number;
  random: () => number;
};

export function createBalloonRoom(id: string): BalloonRoom {
  return {
    id,
    health: ROOM_MAX_HEALTH,
    maxHealth: ROOM_MAX_HEALTH,
    balloons: [],
    walls: [],
    wallRevision: 0,
    width: 1,
    height: 1,
  };
}

export function createBasicBalloon(
  roomId: string,
  id: string,
  spawnLane: SpawnLane,
  pathBias: PathBias = "left",
): Balloon {
  const currentCell = getLaneCell(spawnLane);
  const position = getCellCenter(currentCell);
  return {
    id,
    roomId,
    x: position.x,
    y: position.y,
    health: BASIC_BALLOON.maxHealth,
    maxHealth: BASIC_BALLOON.maxHealth,
    speed: BASIC_BALLOON.speed,
    radius: BASIC_BALLOON.radius,
    roomDamage: BASIC_BALLOON.roomDamage,
    status: "active",
    spawnLane,
    pathBias,
    currentCell,
    targetCell: null,
    path: [],
    pathRevision: -1,
  };
}

export function recalculateBalloonPath(room: BalloonRoom, balloon: Balloon): boolean {
  const path = findPathToCeiling(balloon.currentCell, room.walls, balloon.pathBias);
  balloon.path = path ?? [];
  balloon.targetCell = path?.[1] ?? null;
  balloon.pathRevision = room.wallRevision;
  return path !== null;
}

export function updateBalloonPosition(room: BalloonRoom, balloon: Balloon, deltaSeconds: number): void {
  if (balloon.status !== "active" || deltaSeconds <= 0) return;
  let remainingSeconds = deltaSeconds;

  while (remainingSeconds > 0) {
    if (balloon.currentCell.row === 0 && !balloon.targetCell) {
      balloon.y -= balloon.speed * remainingSeconds;
      return;
    }

    if (balloon.pathRevision !== room.wallRevision && balloon.targetCell) {
      if (isTraversalBlocked(balloon.currentCell, balloon.targetCell, room.walls)) {
        balloon.targetCell = { ...balloon.currentCell };
        balloon.path = [{ ...balloon.currentCell }];
        balloon.pathRevision = room.wallRevision;
      }
    }

    if (!balloon.targetCell && !recalculateBalloonPath(room, balloon)) return;
    const targetCell = balloon.targetCell;
    if (!targetCell) continue;
    const target = getCellCenter(targetCell);
    const distance = Math.hypot(target.x - balloon.x, target.y - balloon.y);

    if (distance <= 0.000001) {
      balloon.currentCell = { ...targetCell };
      balloon.targetCell = null;
      balloon.path = [];
      continue;
    }

    const travelDistance = balloon.speed * remainingSeconds;
    if (travelDistance < distance) {
      balloon.x += ((target.x - balloon.x) / distance) * travelDistance;
      balloon.y += ((target.y - balloon.y) / distance) * travelDistance;
      return;
    }

    balloon.x = target.x;
    balloon.y = target.y;
    balloon.currentCell = { ...targetCell };
    balloon.targetCell = null;
    balloon.path = [];
    remainingSeconds -= distance / balloon.speed;
  }
}

export function updateRoomSimulation(
  room: BalloonRoom,
  deltaSeconds: number,
): BalloonSimulationEvent[] {
  if (room.health <= 0 || deltaSeconds <= 0) return [];

  const events: BalloonSimulationEvent[] = [];
  for (const balloon of room.balloons) {
    updateBalloonPosition(room, balloon, deltaSeconds);
    if (balloon.status === "active" && balloon.y - balloon.radius <= 0) {
      balloon.status = "escaped";
      const damage = Math.min(room.health, balloon.roomDamage);
      room.health = Math.max(0, room.health - balloon.roomDamage);
      events.push({ type: "balloon_escaped", balloon: { ...balloon }, damage });
    }
  }

  if (events.length > 0) {
    room.balloons = room.balloons.filter((balloon) => balloon.status === "active");
  }
  return events;
}

export function damageBalloon(
  room: BalloonRoom,
  balloonId: string,
  damage = MANUAL_TAP_DAMAGE,
): BalloonDamageResult | null {
  const balloonIndex = room.balloons.findIndex(
    (candidate) => candidate.id === balloonId && candidate.status === "active",
  );
  if (balloonIndex < 0 || damage <= 0 || room.health <= 0) return null;

  const balloon = room.balloons[balloonIndex];
  balloon.health = Math.max(0, balloon.health - damage);
  const popped = balloon.health === 0;
  if (popped) {
    balloon.status = "popped";
    room.balloons.splice(balloonIndex, 1);
  }

  return { balloonId, remainingHealth: balloon.health, popped };
}

export function findBalloonAtPoint(
  room: BalloonRoom,
  x: number,
  y: number,
  minimumHitRadius = 0,
): Balloon | null {
  let target: Balloon | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const balloon of room.balloons) {
    if (balloon.status !== "active") continue;
    const hitRadius = Math.max(balloon.radius, minimumHitRadius);
    const distance = Math.hypot(balloon.x - x, balloon.y - y);
    if (distance <= hitRadius && distance < closestDistance) {
      target = balloon;
      closestDistance = distance;
    }
  }
  return target;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createDevBalloonSpawner(seed: number): DevBalloonSpawner {
  return { secondsUntilSpawn: 0.35, sequence: 0, random: createSeededRandom(seed) };
}

export function updateDevBalloonSpawner(
  room: BalloonRoom,
  spawner: DevBalloonSpawner,
  deltaSeconds: number,
): Balloon[] {
  if (room.health <= 0 || deltaSeconds <= 0) return [];

  const spawned: Balloon[] = [];
  spawner.secondsUntilSpawn -= deltaSeconds;
  while (spawner.secondsUntilSpawn <= 0) {
    spawner.sequence += 1;
    const lane = SPAWN_LANES[Math.min(SPAWN_LANES.length - 1, Math.floor(spawner.random() * SPAWN_LANES.length))];
    const pathBias: PathBias = spawner.random() < 0.5 ? "left" : "right";
    const balloon = createBasicBalloon(room.id, `${room.id}-${spawner.sequence}`, lane, pathBias);
    recalculateBalloonPath(room, balloon);
    room.balloons.push(balloon);
    spawned.push(balloon);
    spawner.secondsUntilSpawn +=
      DEV_SPAWN_MIN_SECONDS + spawner.random() * (DEV_SPAWN_MAX_SECONDS - DEV_SPAWN_MIN_SECONDS);
  }
  return spawned;
}
