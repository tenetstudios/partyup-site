import { BASIC_STRUCTURAL_DAMAGE, HEAVY_DIRECT_STRUCTURAL_DAMAGE, HEAVY_GLANCING_STRUCTURAL_DAMAGE, MAX_HORIZONTAL_SUPPORT_DISTANCE, MAX_WALL_SEGMENTS, SPEED_STRUCTURAL_DAMAGE, WALL_MAX_INTEGRITY, WALL_REPAIR_AMOUNT, WALL_REPAIR_COST, WALL_REPAIR_THRESHOLD, } from "./constants.js";
import { getLaneCell, isValidWallEdge, SPAWN_LANES } from "./grid.js";
import { findPathToCeiling } from "./pathfinding.js";
export function getUnsupportedHorizontalWalls(walls) {
    const horizontalWalls = walls.filter((wall) => wall.orientation === "horizontal");
    const supportVertices = new Set();
    for (const wall of walls) {
        if (wall.orientation !== "vertical")
            continue;
        supportVertices.add(vertexKey(wall.gridX, wall.gridY));
        supportVertices.add(vertexKey(wall.gridX, wall.gridY + 1));
    }
    return horizontalWalls.filter((wall) => {
        const distances = new Map();
        const queue = [];
        for (const vertex of supportVertices) {
            const [x, y] = vertex.split(":").map(Number);
            if (x === undefined || y !== wall.gridY)
                continue;
            distances.set(vertex, 0);
            queue.push({ x, distance: 0 });
        }
        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            if (!current || current.distance >= MAX_HORIZONTAL_SUPPORT_DISTANCE)
                continue;
            for (const direction of [-1, 1]) {
                const segmentX = direction < 0 ? current.x - 1 : current.x;
                if (!horizontalWalls.some((candidate) => candidate.gridY === wall.gridY && candidate.gridX === segmentX))
                    continue;
                const nextX = current.x + direction;
                const key = vertexKey(nextX, wall.gridY);
                if (distances.has(key))
                    continue;
                distances.set(key, current.distance + 1);
                queue.push({ x: nextX, distance: current.distance + 1 });
            }
        }
        const leftDistance = distances.get(vertexKey(wall.gridX, wall.gridY));
        const rightDistance = distances.get(vertexKey(wall.gridX + 1, wall.gridY));
        return Math.min(leftDistance ?? Infinity, rightDistance ?? Infinity) >= MAX_HORIZONTAL_SUPPORT_DISTANCE;
    });
}
export function hasRequiredRoutes(room, walls) {
    for (const lane of SPAWN_LANES)
        if (!findPathToCeiling(getLaneCell(lane), walls, "left"))
            return false;
    for (const balloon of room.balloons)
        if (balloon.status === "active" && !findPathToCeiling(balloon.currentCell, walls, balloon.pathBias))
            return false;
    return true;
}
export function validateWallPlacement(room, wall) {
    if (!isValidWallEdge(wall))
        return { valid: false, code: "invalid_edge", message: "Choose an inside grid edge" };
    if (room.walls.some((candidate) => candidate.id === wall.id))
        return { valid: false, code: "duplicate", message: "Wall already placed" };
    if (room.walls.length >= MAX_WALL_SEGMENTS)
        return { valid: false, code: "budget_reached", message: "Wall limit reached" };
    const proposedWalls = [...room.walls, wall];
    if (getUnsupportedHorizontalWalls(proposedWalls).length > 0)
        return { valid: false, code: "needs_support", message: "Needs support" };
    if (!hasRequiredRoutes(room, proposedWalls))
        return { valid: false, code: "path_required", message: "Path required" };
    return { valid: true, code: "valid", message: "Wall placed" };
}
export function placeWall(room, wall) {
    const validation = validateWallPlacement(room, wall);
    if (!validation.valid)
        return validation;
    wall.integrity = WALL_MAX_INTEGRITY;
    wall.maxIntegrity = WALL_MAX_INTEGRITY;
    room.walls.push(wall);
    room.wallRevision += 1;
    return validation;
}
export function classifyStructuralImpact(from, to, wall) {
    const horizontalMovement = Math.abs(to.column - from.column) > Math.abs(to.row - from.row);
    const directlyOpposesMovement = horizontalMovement
        ? wall.orientation === "vertical"
        : wall.orientation === "horizontal";
    return directlyOpposesMovement ? "direct" : "glancing";
}
export function getStructuralDamage(balloonType, impact) {
    if (balloonType === "basic")
        return BASIC_STRUCTURAL_DAMAGE;
    if (balloonType === "speed")
        return SPEED_STRUCTURAL_DAMAGE;
    return impact === "direct" ? HEAVY_DIRECT_STRUCTURAL_DAMAGE : HEAVY_GLANCING_STRUCTURAL_DAMAGE;
}
export function damageWallStructure(room, wallSegmentId, damage) {
    const wall = room.walls.find((candidate) => candidate.id === wallSegmentId);
    if (!wall || damage <= 0)
        return null;
    const integrityBefore = wall.integrity;
    wall.integrity = Math.max(0, wall.integrity - damage);
    if (wall.integrity > 0) {
        return { wallSegmentId, damage, integrityBefore, integrityAfter: wall.integrity, destruction: null };
    }
    const destruction = destroyWallAndCollapse(room, wallSegmentId);
    return { wallSegmentId, damage, integrityBefore, integrityAfter: 0, destruction };
}
export function validateWallRepair(room, wallSegmentId) {
    const wall = room.walls.find((candidate) => candidate.id === wallSegmentId);
    if (!wall)
        return { valid: false, code: "not_found", message: "Select an existing wall", wallSegmentId };
    if (wall.integrity <= 0)
        return { valid: false, code: "destroyed", message: "Destroyed walls cannot be repaired", wallSegmentId };
    if (wall.integrity > WALL_REPAIR_THRESHOLD)
        return { valid: false, code: "above_threshold", message: `Repair available at ${WALL_REPAIR_THRESHOLD} integrity or less`, wallSegmentId };
    if (room.economy.coins < WALL_REPAIR_COST)
        return { valid: false, code: "insufficient_coins", message: `Not enough Coins (need ${WALL_REPAIR_COST})`, wallSegmentId };
    return { valid: true, code: "valid", message: `Wall repaired +${WALL_REPAIR_AMOUNT}`, wallSegmentId };
}
export function repairWall(room, wallSegmentId) {
    const validation = validateWallRepair(room, wallSegmentId);
    if (!validation.valid)
        return validation;
    const wall = room.walls.find((candidate) => candidate.id === wallSegmentId);
    const integrityBefore = wall.integrity;
    const coinsBefore = room.economy.coins;
    room.economy.coins -= WALL_REPAIR_COST;
    wall.integrity = Math.min(wall.maxIntegrity, wall.integrity + WALL_REPAIR_AMOUNT);
    return {
        ...validation,
        integrityBefore,
        integrityAfter: wall.integrity,
        coinsBefore,
        coinsAfter: room.economy.coins,
    };
}
export function destroyWallAndCollapse(room, wallSegmentId) {
    const destroyedWall = room.walls.find((wall) => wall.id === wallSegmentId);
    if (!destroyedWall)
        return null;
    const removedWalls = [{ ...destroyedWall, integrity: 0 }];
    room.walls = room.walls.filter((wall) => wall.id !== wallSegmentId);
    while (true) {
        const unsupported = getUnsupportedHorizontalWalls(room.walls).sort(compareWalls);
        if (unsupported.length === 0)
            break;
        const unsupportedIds = new Set(unsupported.map((wall) => wall.id));
        removedWalls.push(...unsupported.map((wall) => ({ ...wall })));
        room.walls = room.walls.filter((wall) => !unsupportedIds.has(wall.id));
    }
    const removedWallIds = new Set(removedWalls.map((wall) => wall.id));
    const removedNailStripIds = room.nailStrips
        .filter((nail) => removedWallIds.has(nail.wallSegmentId))
        .map((nail) => nail.id)
        .sort();
    const removedGlueIds = room.glueTraps
        .filter((glue) => removedWallIds.has(glue.wallSegmentId))
        .map((glue) => glue.id)
        .sort();
    room.nailStrips = room.nailStrips.filter((nail) => !removedWallIds.has(nail.wallSegmentId));
    room.glueTraps = room.glueTraps.filter((glue) => !removedWallIds.has(glue.wallSegmentId));
    for (const balloon of room.balloons) {
        balloon.contactingNailIds = balloon.contactingNailIds.filter((id) => !removedNailStripIds.includes(id));
        balloon.contactingWallIds = balloon.contactingWallIds.filter((id) => !removedWallIds.has(id));
        balloon.pathRevision = -1;
    }
    room.wallRevision += 1;
    return {
        destroyedWall: removedWalls[0],
        collapsedWalls: removedWalls.slice(1),
        removedNailStripIds,
        removedGlueIds,
    };
}
export function validateWallRemoval(room, wallId) {
    if (!room.walls.some((wall) => wall.id === wallId))
        return { valid: false, code: "not_found", message: "Select an existing wall" };
    const proposedWalls = room.walls.filter((wall) => wall.id !== wallId);
    if (getUnsupportedHorizontalWalls(proposedWalls).length > 0)
        return { valid: false, code: "supporting_span", message: "Supporting active span" };
    return { valid: true, code: "valid", message: "Wall removed" };
}
export function removeWall(room, wallId) {
    const validation = validateWallRemoval(room, wallId);
    if (!validation.valid)
        return validation;
    room.walls = room.walls.filter((wall) => wall.id !== wallId);
    room.nailStrips = room.nailStrips.filter((nail) => nail.wallSegmentId !== wallId);
    room.glueTraps = room.glueTraps.filter((glue) => glue.wallSegmentId !== wallId);
    room.wallRevision += 1;
    return validation;
}
function vertexKey(x, y) { return `${x}:${y}`; }
function compareWalls(first, second) {
    return first.gridY - second.gridY || first.gridX - second.gridX || first.orientation.localeCompare(second.orientation) || first.id.localeCompare(second.id);
}
//# sourceMappingURL=walls.js.map