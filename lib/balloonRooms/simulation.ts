import {
  BALLOON_SAFE_X_MAX,
  BALLOON_SAFE_X_MIN,
  BALLOON_SPAWN_Y,
  BASIC_BALLOON,
  DEV_SPAWN_MAX_SECONDS,
  DEV_SPAWN_MIN_SECONDS,
  MANUAL_TAP_DAMAGE,
  ROOM_MAX_HEALTH,
} from "./constants.ts";
import type {
  Balloon,
  BalloonDamageResult,
  BalloonRoom,
  BalloonSimulationEvent,
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
    width: 1,
    height: 1,
  };
}

export function createBasicBalloon(roomId: string, id: string, x: number): Balloon {
  return {
    id,
    roomId,
    x: clamp(x, BALLOON_SAFE_X_MIN, BALLOON_SAFE_X_MAX),
    y: BALLOON_SPAWN_Y,
    health: BASIC_BALLOON.maxHealth,
    maxHealth: BASIC_BALLOON.maxHealth,
    speed: BASIC_BALLOON.speed,
    radius: BASIC_BALLOON.radius,
    roomDamage: BASIC_BALLOON.roomDamage,
    status: "active",
  };
}

export function updateBalloonPosition(balloon: Balloon, deltaSeconds: number): void {
  if (balloon.status !== "active") return;
  balloon.y -= balloon.speed * Math.max(0, deltaSeconds);
}

export function updateRoomSimulation(
  room: BalloonRoom,
  deltaSeconds: number,
): BalloonSimulationEvent[] {
  if (room.health <= 0 || deltaSeconds <= 0) return [];

  const events: BalloonSimulationEvent[] = [];
  for (const balloon of room.balloons) {
    updateBalloonPosition(balloon, deltaSeconds);
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
    const x = BALLOON_SAFE_X_MIN + spawner.random() * (BALLOON_SAFE_X_MAX - BALLOON_SAFE_X_MIN);
    const balloon = createBasicBalloon(room.id, `${room.id}-${spawner.sequence}`, x);
    room.balloons.push(balloon);
    spawned.push(balloon);
    spawner.secondsUntilSpawn +=
      DEV_SPAWN_MIN_SECONDS + spawner.random() * (DEV_SPAWN_MAX_SECONDS - DEV_SPAWN_MIN_SECONDS);
  }
  return spawned;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
