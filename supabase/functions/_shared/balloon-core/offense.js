import { ENTRY_LANES } from "./constants.js";
import { BALLOON_TYPES } from "./constants.js";
import { createBalloon, recalculateBalloonPath } from "./simulation.js";
export function createSendBalloonAction(input) {
    return {
        type: "SEND_BALLOON",
        balloonType: input.balloonType ?? "basic",
        lane: input.lane,
        targetRoomId: input.targetRoomId,
        balloonId: createSentBalloonId(input),
        matchId: input.matchId,
        senderId: input.senderId,
        senderSequence: input.senderSequence,
        sentAt: input.sentAt,
    };
}
export function createSentBalloonId(input) {
    return [
        "balloon",
        encodeURIComponent(input.matchId),
        encodeURIComponent(input.senderId),
        encodeURIComponent(input.targetRoomId),
        actionBalloonType(input),
        `lane-${input.lane}`,
        `send-${input.senderSequence}`,
    ].join(":");
}
function actionBalloonType(input) {
    return input.balloonType ?? "basic";
}
export function validateSendBalloon(room, action) {
    if (!ENTRY_LANES.includes(action.lane)) {
        return { valid: false, code: "invalid_lane", message: "Choose Lane 1, 2, 3, or 4" };
    }
    if (action.targetRoomId !== room.id) {
        return { valid: false, code: "target_not_found", message: "Target room not found" };
    }
    if (room.health <= 0) {
        return { valid: false, code: "room_closed", message: "Target room is broken" };
    }
    if (!(action.balloonType in BALLOON_TYPES)) {
        return { valid: false, code: "invalid_balloon_type", message: "Unknown balloon type" };
    }
    if (!action.balloonId || !action.matchId || !action.senderId) {
        return { valid: false, code: "invalid_identity", message: "Balloon identity is required" };
    }
    if (!Number.isSafeInteger(action.senderSequence) || action.senderSequence < 1 || !Number.isFinite(action.sentAt) || action.sentAt < 0) {
        return { valid: false, code: "invalid_metadata", message: "Valid send metadata is required" };
    }
    const expectedBalloonId = createSentBalloonId({
        matchId: action.matchId,
        senderId: action.senderId,
        targetRoomId: action.targetRoomId,
        lane: action.lane,
        senderSequence: action.senderSequence,
        sentAt: action.sentAt,
        balloonType: action.balloonType,
    });
    if (action.balloonId !== expectedBalloonId) {
        return { valid: false, code: "invalid_identity", message: "Balloon identity does not match send metadata" };
    }
    if (room.processedSendIds.includes(action.balloonId)) {
        return { valid: false, code: "duplicate_balloon_id", message: "Balloon already sent" };
    }
    return { valid: true, code: "valid", message: `${action.balloonType} Balloon sent through Lane ${action.lane}` };
}
export function sendBalloon(room, action) {
    const validation = validateSendBalloon(room, action);
    if (!validation.valid)
        return validation;
    const balloon = createBalloon(room.id, action.balloonId, action.balloonType, action.lane, action.senderSequence % 2 === 0 ? "right" : "left", "player", { senderId: action.senderId });
    if (!recalculateBalloonPath(room, balloon)) {
        return { valid: false, code: "path_unavailable", message: "No route to the ceiling" };
    }
    room.processedSendIds.push(action.balloonId);
    room.balloons.push(balloon);
    return { valid: true, code: "valid", message: `${action.balloonType} Balloon sent through Lane ${action.lane}`, balloon };
}
//# sourceMappingURL=offense.js.map