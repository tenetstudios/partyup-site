import { ENTRY_LANE_COLUMNS, GRID_COLUMNS, GRID_ROWS } from "./constants.ts";
import type { GridCell, SpawnLane, WallOrientation, WallSegment } from "./types.ts";

export const SPAWN_LANES: SpawnLane[] = [1, 2, 3, 4];

export function getLaneCell(lane: SpawnLane): GridCell {
  return { column: ENTRY_LANE_COLUMNS[lane], row: GRID_ROWS - 1 };
}

export function getCellCenter(cell: GridCell): { x: number; y: number } {
  return {
    x: (cell.column + 0.5) / GRID_COLUMNS,
    y: (cell.row + 0.5) / GRID_ROWS,
  };
}

export function cellsEqual(first: GridCell, second: GridCell): boolean {
  return first.column === second.column && first.row === second.row;
}

export function isCellInGrid(cell: GridCell): boolean {
  return cell.column >= 0 && cell.column < GRID_COLUMNS && cell.row >= 0 && cell.row < GRID_ROWS;
}

export function getAdjacentCells(cell: GridCell, horizontalPreference: "left" | "right"): GridCell[] {
  const horizontal = horizontalPreference === "left"
    ? [{ column: cell.column - 1, row: cell.row }, { column: cell.column + 1, row: cell.row }]
    : [{ column: cell.column + 1, row: cell.row }, { column: cell.column - 1, row: cell.row }];
  return [
    { column: cell.column, row: cell.row - 1 },
    ...horizontal,
    { column: cell.column, row: cell.row + 1 },
  ].filter(isCellInGrid);
}

export function getWallId(
  roomId: string,
  orientation: WallOrientation,
  gridX: number,
  gridY: number,
): string {
  return `${roomId}:${orientation}:${gridX}:${gridY}`;
}

export function createWallSegment(
  roomId: string,
  orientation: WallOrientation,
  gridX: number,
  gridY: number,
): WallSegment {
  return { id: getWallId(roomId, orientation, gridX, gridY), roomId, orientation, gridX, gridY };
}

export function isValidWallEdge(wall: WallSegment): boolean {
  if (wall.orientation === "vertical") {
    return wall.gridX > 0 && wall.gridX < GRID_COLUMNS && wall.gridY >= 0 && wall.gridY < GRID_ROWS;
  }
  return wall.gridX >= 0 && wall.gridX < GRID_COLUMNS && wall.gridY > 0 && wall.gridY < GRID_ROWS;
}

export function wallBlocksCells(wall: WallSegment, first: GridCell, second: GridCell): boolean {
  if (wall.orientation === "vertical") {
    return first.row === second.row
      && first.row === wall.gridY
      && Math.min(first.column, second.column) === wall.gridX - 1
      && Math.max(first.column, second.column) === wall.gridX;
  }
  return first.column === second.column
    && first.column === wall.gridX
    && Math.min(first.row, second.row) === wall.gridY - 1
    && Math.max(first.row, second.row) === wall.gridY;
}

export function isTraversalBlocked(first: GridCell, second: GridCell, walls: WallSegment[]): boolean {
  return walls.some((wall) => wallBlocksCells(wall, first, second));
}

export function findClosestGridEdge(
  x: number,
  y: number,
  renderedWidth: number,
  renderedHeight: number,
  maximumDistancePixels = 24,
): { orientation: WallOrientation; gridX: number; gridY: number } | null {
  const verticalX = Math.round(x * GRID_COLUMNS);
  const horizontalY = Math.round(y * GRID_ROWS);
  const verticalDistance = Math.abs(x - verticalX / GRID_COLUMNS) * renderedWidth;
  const horizontalDistance = Math.abs(y - horizontalY / GRID_ROWS) * renderedHeight;

  const vertical = {
    orientation: "vertical" as const,
    gridX: verticalX,
    gridY: Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(y * GRID_ROWS))),
  };
  const horizontal = {
    orientation: "horizontal" as const,
    gridX: Math.min(GRID_COLUMNS - 1, Math.max(0, Math.floor(x * GRID_COLUMNS))),
    gridY: horizontalY,
  };

  const verticalValid = verticalX > 0 && verticalX < GRID_COLUMNS;
  const horizontalValid = horizontalY > 0 && horizontalY < GRID_ROWS;
  if (verticalValid && verticalDistance <= maximumDistancePixels && (!horizontalValid || verticalDistance <= horizontalDistance)) return vertical;
  if (horizontalValid && horizontalDistance <= maximumDistancePixels) return horizontal;
  if (verticalValid && verticalDistance <= maximumDistancePixels) return vertical;
  return null;
}
