import { MAX_LAUNCH_QUEUE_SIZE, PLAYER_BALLOON_LAUNCH_INTERVAL_MS } from "./constants.js";
import { getLaneCell } from "./grid.js";
import { sendBalloon, validateSendBalloon } from "./offense.js";
import { findPathToCeiling } from "./pathfinding.js";
export function createPlayerAttackState() {
    return { queue: [], lastLaunchAt: null, nextLaunchAt: null };
}
export function validateBalloonPurchase(senderRoom, targetRoom, action) {
    const validation = validateSendBalloon(targetRoom, action);
    if (!validation.valid)
        return validation;
    if (!senderRoom.unlockedBalloonTypes[action.balloonType]) {
        return { valid: false, code: "balloon_locked", message: `${action.balloonType} Balloon unlocks after its wave` };
    }
    if (senderRoom.attack.queue.some((queued) => queued.id === action.balloonId)) {
        return { valid: false, code: "duplicate_balloon_id", message: "Balloon already queued" };
    }
    if (senderRoom.attack.queue.length >= MAX_LAUNCH_QUEUE_SIZE) {
        return { valid: false, code: "queue_full", message: "Queue full" };
    }
    const pathBias = action.senderSequence % 2 === 0 ? "right" : "left";
    if (!findPathToCeiling(getLaneCell(action.lane), targetRoom.walls, pathBias)) {
        return { valid: false, code: "path_unavailable", message: "No route to the ceiling" };
    }
    return validation;
}
export function enqueueBalloon(senderRoom, action) {
    const queued = {
        id: action.balloonId,
        balloonType: action.balloonType,
        lane: action.lane,
        targetRoomId: action.targetRoomId,
        purchasedAt: action.sentAt,
        matchId: action.matchId,
        senderId: action.senderId,
        senderSequence: action.senderSequence,
    };
    senderRoom.attack.queue.push(queued);
    return queued;
}
export function applyLaunchQueue(senderRoom, targetRoom, simulationTimeMs) {
    if (!Number.isFinite(simulationTimeMs) || simulationTimeMs < 0) {
        return { valid: false, code: "invalid_time", message: "Valid simulation time is required" };
    }
    const queued = senderRoom.attack.queue[0];
    if (!queued) {
        senderRoom.attack.nextLaunchAt = null;
        return { valid: true, code: "valid", message: "Launch queue empty" };
    }
    if (senderRoom.attack.nextLaunchAt === null) {
        senderRoom.attack.nextLaunchAt = senderRoom.attack.lastLaunchAt === null
            ? simulationTimeMs
            : Math.max(simulationTimeMs, senderRoom.attack.lastLaunchAt + PLAYER_BALLOON_LAUNCH_INTERVAL_MS);
    }
    if (simulationTimeMs < senderRoom.attack.nextLaunchAt) {
        return { valid: true, code: "valid", message: "Next launch not due" };
    }
    const result = sendBalloon(targetRoom, queuedToSendAction(queued));
    if (!result.valid || !result.balloon)
        return result;
    senderRoom.attack.queue.shift();
    senderRoom.attack.lastLaunchAt = simulationTimeMs;
    senderRoom.attack.nextLaunchAt = senderRoom.attack.queue.length > 0
        ? simulationTimeMs + PLAYER_BALLOON_LAUNCH_INTERVAL_MS
        : null;
    return { valid: true, code: "valid", message: `${queued.balloonType} Balloon launched through Lane ${queued.lane}`, balloon: result.balloon };
}
function queuedToSendAction(queued) {
    return {
        type: "SEND_BALLOON",
        balloonType: queued.balloonType,
        lane: queued.lane,
        targetRoomId: queued.targetRoomId,
        balloonId: queued.id,
        matchId: queued.matchId,
        senderId: queued.senderId,
        senderSequence: queued.senderSequence,
        sentAt: queued.purchasedAt,
    };
}
//# sourceMappingURL=attack.js.map