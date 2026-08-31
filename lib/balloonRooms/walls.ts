import { MAX_HORIZONTAL_SUPPORT_DISTANCE, MAX_WALL_SEGMENTS } from "./constants.ts";
import { getLaneCell, isValidWallEdge, SPAWN_LANES } from "./grid.ts";
import { findPathToCeiling } from "./pathfinding.ts";
import type { BalloonRoom, WallSegment, WallValidationResult } from "./types.ts";

const validResult: WallValidationResult = { valid: true, code: "valid", message: "Wall placed" };

export function getUnsupportedHorizontalWalls(walls: WallSegment[]): WallSegment[] {
  const horizontalWalls = walls.filter((wall) => wall.orientation === "horizontal");
  const supportVertices = new Set<string>();
  for (const wall of walls) {
    if (wall.orientation !== "vertical") continue;
    supportVertices.add(vertexKey(wall.gridX, wall.gridY));
    supportVertices.add(vertexKey(wall.gridX, wall.gridY + 1));
  }

  return horizontalWalls.filter((wall) => {
    const distances = new Map<string, number>();
    const queue: Array<{ x: number; distance: number }> = [];
    for (const vertex of supportVertices) {
      const [x, y] = vertex.split(":").map(Number);
      if (y !== wall.gridY) continue;
      distances.set(vertex, 0);
      queue.push({ x, distance: 0 });
    }

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (current.distance >= MAX_HORIZONTAL_SUPPORT_DISTANCE) continue;
      for (const direction of [-1, 1]) {
        const segmentX = direction < 0 ? current.x - 1 : current.x;
        if (!horizontalWalls.some((candidate) => candidate.gridY === wall.gridY && candidate.gridX === segmentX)) continue;
        const nextX = current.x + direction;
        const key = vertexKey(nextX, wall.gridY);
        if (distances.has(key)) continue;
        distances.set(key, current.distance + 1);
        queue.push({ x: nextX, distance: current.distance + 1 });
      }
    }

    const leftDistance = distances.get(vertexKey(wall.gridX, wall.gridY));
    const rightDistance = distances.get(vertexKey(wall.gridX + 1, wall.gridY));
    return Math.min(leftDistance ?? Infinity, rightDistance ?? Infinity) >= MAX_HORIZONTAL_SUPPORT_DISTANCE;
  });
}

export function hasRequiredRoutes(room: BalloonRoom, walls: WallSegment[]): boolean {
  for (const lane of SPAWN_LANES) {
    if (!findPathToCeiling(getLaneCell(lane), walls, "left")) return false;
  }
  for (const balloon of room.balloons) {
    if (balloon.status === "active" && !findPathToCeiling(balloon.currentCell, walls, balloon.pathBias)) return false;
  }
  return true;
}

export function validateWallPlacement(room: BalloonRoom, wall: WallSegment): WallValidationResult {
  if (!isValidWallEdge(wall)) return { valid: false, code: "invalid_edge", message: "Choose an inside grid edge" };
  if (room.walls.some((candidate) => candidate.id === wall.id)) return { valid: false, code: "duplicate", message: "Wall already placed" };
  if (room.walls.length >= MAX_WALL_SEGMENTS) return { valid: false, code: "budget_reached", message: "Wall limit reached" };

  const proposedWalls = [...room.walls, wall];
  if (getUnsupportedHorizontalWalls(proposedWalls).length > 0) {
    return { valid: false, code: "needs_support", message: "Needs support" };
  }
  if (!hasRequiredRoutes(room, proposedWalls)) {
    return { valid: false, code: "path_required", message: "Path required" };
  }
  return validResult;
}

export function placeWall(room: BalloonRoom, wall: WallSegment): WallValidationResult {
  const validation = validateWallPlacement(room, wall);
  if (!validation.valid) return validation;
  room.walls.push(wall);
  room.wallRevision += 1;
  return validation;
}

export function validateWallRemoval(room: BalloonRoom, wallId: string): WallValidationResult {
  if (!room.walls.some((wall) => wall.id === wallId)) {
    return { valid: false, code: "not_found", message: "Select an existing wall" };
  }
  const proposedWalls = room.walls.filter((wall) => wall.id !== wallId);
  if (getUnsupportedHorizontalWalls(proposedWalls).length > 0) {
    return { valid: false, code: "supporting_span", message: "Supporting active span" };
  }
  return { valid: true, code: "valid", message: "Wall removed" };
}

export function removeWall(room: BalloonRoom, wallId: string): WallValidationResult {
  const validation = validateWallRemoval(room, wallId);
  if (!validation.valid) return validation;
  room.walls = room.walls.filter((wall) => wall.id !== wallId);
  room.nailStrips = room.nailStrips.filter((nail) => nail.wallSegmentId !== wallId);
  room.wallRevision += 1;
  return validation;
}

function vertexKey(x: number, y: number): string {
  return `${x}:${y}`;
}
