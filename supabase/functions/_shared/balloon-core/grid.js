import { ENTRY_LANE_COLUMNS, ENTRY_LANES, GRID_HEIGHT, GRID_WIDTH, WALL_MAX_INTEGRITY } from "./constants.js";
export const SPAWN_LANES = [...ENTRY_LANES];
export function getLaneCell(lane) {
    return { column: ENTRY_LANE_COLUMNS[lane], row: GRID_HEIGHT - 1 };
}
export function getCellCenter(cell) {
    return { x: (cell.column + 0.5) / GRID_WIDTH, y: (cell.row + 0.5) / GRID_HEIGHT };
}
export function cellsEqual(first, second) {
    return first.column === second.column && first.row === second.row;
}
export function isCellInGrid(cell) {
    return cell.column >= 0 && cell.column < GRID_WIDTH && cell.row >= 0 && cell.row < GRID_HEIGHT;
}
export function getAdjacentCells(cell, horizontalPreference) {
    const horizontal = horizontalPreference === "left"
        ? [{ column: cell.column - 1, row: cell.row }, { column: cell.column + 1, row: cell.row }]
        : [{ column: cell.column + 1, row: cell.row }, { column: cell.column - 1, row: cell.row }];
    return [{ column: cell.column, row: cell.row - 1 }, ...horizontal, { column: cell.column, row: cell.row + 1 }].filter(isCellInGrid);
}
export function getWallId(roomId, orientation, gridX, gridY) {
    return `${roomId}:${orientation}:${gridX}:${gridY}`;
}
export function createWallSegment(roomId, orientation, gridX, gridY) {
    return { id: getWallId(roomId, orientation, gridX, gridY), roomId, orientation, gridX, gridY, integrity: WALL_MAX_INTEGRITY, maxIntegrity: WALL_MAX_INTEGRITY };
}
export function isValidWallEdge(wall) {
    if (wall.orientation === "vertical")
        return wall.gridX > 0 && wall.gridX < GRID_WIDTH && wall.gridY >= 0 && wall.gridY < GRID_HEIGHT;
    return wall.gridX >= 0 && wall.gridX < GRID_WIDTH && wall.gridY > 0 && wall.gridY < GRID_HEIGHT;
}
export function wallBlocksCells(wall, first, second) {
    if (wall.orientation === "vertical") {
        return first.row === second.row && first.row === wall.gridY && Math.min(first.column, second.column) === wall.gridX - 1 && Math.max(first.column, second.column) === wall.gridX;
    }
    return first.column === second.column && first.column === wall.gridX && Math.min(first.row, second.row) === wall.gridY - 1 && Math.max(first.row, second.row) === wall.gridY;
}
export function isTraversalBlocked(first, second, walls) {
    return walls.some((wall) => wallBlocksCells(wall, first, second));
}
export function findClosestGridEdge(x, y, renderedWidth, renderedHeight, maximumDistancePixels = 24) {
    const verticalX = Math.round(x * GRID_WIDTH);
    const horizontalY = Math.round(y * GRID_HEIGHT);
    const verticalDistance = Math.abs(x - verticalX / GRID_WIDTH) * renderedWidth;
    const horizontalDistance = Math.abs(y - horizontalY / GRID_HEIGHT) * renderedHeight;
    const vertical = { orientation: "vertical", gridX: verticalX, gridY: Math.min(GRID_HEIGHT - 1, Math.max(0, Math.floor(y * GRID_HEIGHT))) };
    const horizontal = { orientation: "horizontal", gridX: Math.min(GRID_WIDTH - 1, Math.max(0, Math.floor(x * GRID_WIDTH))), gridY: horizontalY };
    const verticalValid = verticalX > 0 && verticalX < GRID_WIDTH;
    const horizontalValid = horizontalY > 0 && horizontalY < GRID_HEIGHT;
    if (verticalValid && verticalDistance <= maximumDistancePixels && (!horizontalValid || verticalDistance <= horizontalDistance))
        return vertical;
    if (horizontalValid && horizontalDistance <= maximumDistancePixels)
        return horizontal;
    if (verticalValid && verticalDistance <= maximumDistancePixels)
        return vertical;
    return null;
}
//# sourceMappingURL=grid.js.map