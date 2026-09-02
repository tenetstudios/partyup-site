import { placeNailStrip, removeNailStrip } from "./nails.js";
import { damageBalloon } from "./simulation.js";
import { placeWall, removeWall, repairWall, validateWallPlacement } from "./walls.js";
import { validateNailPlacement } from "./nails.js";
import { applyIncomeTicks } from "./economy.js";
import { BALLOON_TYPES, ENTRY_LANES, HORIZONTAL_WALL_COST, NAIL_STRIP_COST, VERTICAL_WALL_COST } from "./constants.js";
import { applyLaunchQueue, enqueueBalloon, validateBalloonPurchase } from "./attack.js";
import { placeGlueTrap, removeGlueTrap, validateGluePlacement } from "./glue.js";
import { GLUE_COST } from "./constants.js";
export function applyGameAction(room, action, targetRoom) {
    if (action.type === "SEND_BALLOON") {
        if (!ENTRY_LANES.includes(action.lane)) {
            return { action: action.type, applied: false, code: "invalid_lane", message: "Choose Lane 1, 2, 3, or 4" };
        }
        if (room.health <= 0)
            return { action: action.type, applied: false, code: "sender_room_closed", message: "Your room is broken" };
        if (!targetRoom)
            return { action: action.type, applied: false, code: "target_not_found", message: "Target room not found" };
        const validation = validateBalloonPurchase(room, targetRoom, action);
        if (!validation.valid)
            return { action: action.type, applied: false, code: validation.code, message: validation.message };
        const config = BALLOON_TYPES[action.balloonType];
        if (room.economy.coins < config.cost)
            return insufficientCoins(action.type, config.cost);
        room.economy.coins -= config.cost;
        room.economy.income += config.incomeGain;
        const queuedBalloon = enqueueBalloon(room, action);
        return { action: action.type, applied: true, code: "valid", message: `${action.balloonType} Balloon queued for Lane ${action.lane}`, queuedBalloon };
    }
    if (action.type === "APPLY_INCOME_TICK") {
        const result = applyIncomeTicks(room, action.simulationTimeMs);
        return result.valid
            ? { action: action.type, applied: true, code: "valid", message: result.message, incomeTicksApplied: result.ticksApplied }
            : { action: action.type, applied: false, code: result.code, message: result.message };
    }
    if (action.type === "APPLY_LAUNCH_QUEUE") {
        if (!targetRoom)
            return { action: action.type, applied: false, code: "target_not_found", message: "Target room not found" };
        const result = applyLaunchQueue(room, targetRoom, action.simulationTimeMs);
        return result.valid
            ? { action: action.type, applied: true, code: "valid", message: result.message, spawnedBalloon: result.balloon, launchedBalloon: result.balloon }
            : { action: action.type, applied: false, code: result.code, message: result.message };
    }
    if (action.type === "POP_BALLOON") {
        const damage = damageBalloon(room, action.balloonId);
        return damage
            ? { action: action.type, applied: true, code: "valid", message: damage.popped ? "Balloon popped" : "Balloon damaged", damage }
            : { action: action.type, applied: false, code: "not_found", message: "Select an active balloon" };
    }
    if (action.type === "PLACE_WALL") {
        const validation = validateWallPlacement(room, action.wall);
        if (!validation.valid)
            return validationResult(action.type, validation);
        const cost = action.wall.orientation === "vertical" ? VERTICAL_WALL_COST : HORIZONTAL_WALL_COST;
        if (room.economy.coins < cost)
            return insufficientCoins(action.type, cost);
        room.economy.coins -= cost;
        return validationResult(action.type, placeWall(room, action.wall));
    }
    if (action.type === "PLACE_NAILS") {
        const validation = validateNailPlacement(room, action.wallSegmentId);
        if (!validation.valid)
            return validationResult(action.type, validation);
        if (room.economy.coins < NAIL_STRIP_COST)
            return insufficientCoins(action.type, NAIL_STRIP_COST);
        room.economy.coins -= NAIL_STRIP_COST;
        return validationResult(action.type, placeNailStrip(room, action.wallSegmentId));
    }
    if (action.type === "REMOVE_NAILS")
        return validationResult(action.type, removeNailStrip(room, action.wallSegmentId));
    if (action.type === "PLACE_GLUE") {
        const validation = validateGluePlacement(room, action.wallSegmentId);
        if (!validation.valid)
            return validationResult(action.type, validation);
        if (room.economy.coins < GLUE_COST)
            return insufficientCoins(action.type, GLUE_COST);
        room.economy.coins -= GLUE_COST;
        return validationResult(action.type, placeGlueTrap(room, action.wallSegmentId));
    }
    if (action.type === "REMOVE_GLUE")
        return validationResult(action.type, removeGlueTrap(room, action.wallSegmentId));
    if (action.type === "REPAIR_WALL")
        return validationResult(action.type, repairWall(room, action.wallSegmentId));
    const armed = room.nailStrips.some((nail) => nail.wallSegmentId === action.wallSegmentId);
    if (armed)
        return validationResult(action.type, removeNailStrip(room, action.wallSegmentId), "One Nail Strip removed; wall remains");
    const glued = room.glueTraps.some((glue) => glue.wallSegmentId === action.wallSegmentId);
    if (glued)
        return validationResult(action.type, removeGlueTrap(room, action.wallSegmentId), "Glue removed; wall remains");
    return validationResult(action.type, removeWall(room, action.wallSegmentId));
}
function insufficientCoins(action, cost) {
    return { action, applied: false, code: "insufficient_coins", message: `Not enough Coins (need ${cost})` };
}
function validationResult(action, result, successMessage = result.message) {
    return result.valid
        ? { action, applied: true, code: "valid", message: successMessage }
        : { action, applied: false, code: result.code, message: result.message };
}
//# sourceMappingURL=actions.js.map