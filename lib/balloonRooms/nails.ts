import { MAX_NAIL_STRIPS, NAIL_MAX_DURABILITY } from "./constants.ts";
import type { BalloonRoom, GridCell, NailStrip, NailValidationResult, WallSegment } from "./types.ts";

export function createNailStrip(roomId: string, wallSegmentId: string): NailStrip {
  return {
    id: `${roomId}:nails:${wallSegmentId}`,
    roomId,
    wallSegmentId,
    durability: NAIL_MAX_DURABILITY,
    maxDurability: NAIL_MAX_DURABILITY,
    status: "active",
  };
}

export function validateNailPlacement(room: BalloonRoom, wallSegmentId: string): NailValidationResult {
  if (!room.walls.some((wall) => wall.id === wallSegmentId)) {
    return { valid: false, code: "wall_required", message: "Nails need an existing wall" };
  }
  if (room.nailStrips.some((nail) => nail.wallSegmentId === wallSegmentId)) {
    return { valid: false, code: "duplicate", message: "Wall already armed" };
  }
  if (room.nailStrips.length >= MAX_NAIL_STRIPS) {
    return { valid: false, code: "limit_reached", message: "Nail limit reached" };
  }
  return { valid: true, code: "valid", message: "Nails attached" };
}

export function placeNailStrip(room: BalloonRoom, wallSegmentId: string): NailValidationResult {
  const validation = validateNailPlacement(room, wallSegmentId);
  if (!validation.valid) return validation;
  room.nailStrips.push(createNailStrip(room.id, wallSegmentId));
  return validation;
}

export function removeNailStrip(room: BalloonRoom, wallSegmentId: string): NailValidationResult {
  const index = room.nailStrips.findIndex((nail) => nail.wallSegmentId === wallSegmentId);
  if (index < 0) return { valid: false, code: "not_found", message: "Wall has no nails" };
  const removedNailId = room.nailStrips[index].id;
  room.nailStrips.splice(index, 1);
  for (const balloon of room.balloons) {
    balloon.contactingNailIds = balloon.contactingNailIds.filter((id) => id !== removedNailId);
  }
  return { valid: true, code: "valid", message: "Nails removed" };
}

export function wallTouchesCell(wall: WallSegment, cell: GridCell): boolean {
  if (wall.orientation === "vertical") {
    return wall.gridY === cell.row && (cell.column === wall.gridX - 1 || cell.column === wall.gridX);
  }
  return wall.gridX === cell.column && (cell.row === wall.gridY - 1 || cell.row === wall.gridY);
}

export function getNailsTouchingCell(room: BalloonRoom, cell: GridCell): NailStrip[] {
  const wallIds = new Set(room.walls.filter((wall) => wallTouchesCell(wall, cell)).map((wall) => wall.id));
  return room.nailStrips.filter((nail) => wallIds.has(nail.wallSegmentId));
}
