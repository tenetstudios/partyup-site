import { cellsEqual, getAdjacentCells, isTraversalBlocked } from "./grid.js";
export function findPathToCeiling(start, walls, pathBias) {
    const queue = [{ ...start }];
    const visited = new Set([cellKey(start)]);
    const previous = new Map();
    let goal = null;
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (!current)
            continue;
        if (current.row === 0) {
            goal = current;
            break;
        }
        for (const neighbor of getAdjacentCells(current, pathBias)) {
            const key = cellKey(neighbor);
            if (visited.has(key) || isTraversalBlocked(current, neighbor, walls))
                continue;
            visited.add(key);
            previous.set(key, current);
            queue.push(neighbor);
        }
    }
    if (!goal)
        return null;
    const path = [goal];
    while (!cellsEqual(path[0], start)) {
        const parent = previous.get(cellKey(path[0]));
        if (!parent)
            return null;
        path.unshift(parent);
    }
    return path;
}
function cellKey(cell) { return `${cell.column}:${cell.row}`; }
//# sourceMappingURL=pathfinding.js.map