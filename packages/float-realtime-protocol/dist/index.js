import { SIMULATION_STEP_SECONDS, applyFloatMatchAction, createWallSegment, updateFloatMatch, } from "@partyup/balloon-core";
export const FLOAT_REALTIME_PROTOCOL_VERSION = 1;
export const FLOAT_SIMULATION_HZ = 60;
export const FLOAT_CHECKPOINT_INTERVAL_TICKS = 6;
export const FLOAT_REWIND_HISTORY_TICKS = 60;
export const FLOAT_MAX_FUTURE_TICKS = 6;
export const FLOAT_MAX_SEQUENCE_GAP = 64;
export const FLOAT_MAX_PAYLOAD_BYTES = 2_048;
export const FLOAT_MAX_RESEND_ACTIONS = 256;
export const FLOAT_MAX_ACTIONS_PER_SECOND = 30;
export function simulationTimeMsToTick(simulationTimeMs) {
    if (!Number.isFinite(simulationTimeMs) || simulationTimeMs < 0)
        throw new Error("Invalid Float simulation time");
    return Math.floor(simulationTimeMs * FLOAT_SIMULATION_HZ / 1_000);
}
export function simulationTickToTimeMs(simulationTick) {
    if (!Number.isSafeInteger(simulationTick) || simulationTick < 0)
        throw new Error("Invalid Float simulation tick");
    return simulationTick * 1_000 / FLOAT_SIMULATION_HZ;
}
export function compareFloatRealtimeActions(left, right) {
    return left.simulationTick - right.simulationTick
        || left.actorPlayerId.localeCompare(right.actorPlayerId)
        || left.clientSequence - right.clientSequence
        || left.actionId.localeCompare(right.actionId);
}
export function floatActorTopic(matchId, actorPlayerId) {
    if (!matchId || !/^[0-9a-f-]{36}$/i.test(matchId))
        throw new Error("Invalid Float match ID");
    return `float-match:${matchId}:${actorPlayerId}`;
}
function integer(value, name) {
    if (!Number.isSafeInteger(value))
        throw new Error(`Invalid ${name}`);
    return Number(value);
}
function stringValue(value, name) {
    if (typeof value !== "string" || value.length === 0 || value.length > 240)
        throw new Error(`Invalid ${name}`);
    return value;
}
export function validateFloatRealtimeAction(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid Float action envelope");
    const action = value;
    if (action.protocolVersion !== FLOAT_REALTIME_PROTOCOL_VERSION)
        throw new Error("Float protocol update required");
    if (action.matchId !== expected.matchId)
        throw new Error("Float action match mismatch");
    if (action.actorPlayerId !== expected.actorPlayerId)
        throw new Error("Float action actor mismatch");
    if (typeof action.actionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(action.actionId))
        throw new Error("Invalid Float action ID");
    integer(action.clientSequence, "client sequence");
    integer(action.simulationTick, "simulation tick");
    if (Number(action.clientSequence) < 1 || Number(action.simulationTick) < 0)
        throw new Error("Invalid Float action ordering");
    const allowed = new Set(["PLACE_WALL", "REMOVE_WALL", "PLACE_NAILS", "REMOVE_NAILS", "PLACE_GLUE", "REMOVE_GLUE", "REPAIR_WALL", "SEND_BALLOON", "POP_BALLOON"]);
    if (typeof action.actionType !== "string" || !allowed.has(action.actionType))
        throw new Error("Unsupported Float action");
    if (!action.payload || typeof action.payload !== "object" || Array.isArray(action.payload))
        throw new Error("Invalid Float action payload");
    if (new TextEncoder().encode(JSON.stringify(action.payload)).byteLength > FLOAT_MAX_PAYLOAD_BYTES)
        throw new Error("Float action payload is too large");
    return action;
}
export function floatRealtimeActionToCoreAction(state, envelope) {
    const room = state.players[envelope.actorPlayerId]?.room;
    if (!room)
        throw new Error("Player room is unavailable");
    const payload = envelope.payload;
    if (envelope.actionType === "PLACE_WALL") {
        const orientation = payload.orientation;
        if (orientation !== "vertical" && orientation !== "horizontal")
            throw new Error("Invalid wall orientation");
        return { type: "PLACE_WALL", actorPlayerId: envelope.actorPlayerId, wall: createWallSegment(room.id, orientation, integer(payload.gridX, "wall grid X"), integer(payload.gridY, "wall grid Y")) };
    }
    if (envelope.actionType === "POP_BALLOON")
        return { type: "POP_BALLOON", actorPlayerId: envelope.actorPlayerId, balloonId: stringValue(payload.balloonId, "balloon") };
    if (envelope.actionType === "SEND_BALLOON") {
        const balloonType = payload.balloonType;
        if (balloonType !== "basic" && balloonType !== "speed" && balloonType !== "heavy")
            throw new Error("Invalid balloon type");
        const lane = integer(payload.lane, "attack lane");
        if (lane < 1 || lane > 4)
            throw new Error("Invalid attack lane");
        return { type: "SEND_BALLOON", actorPlayerId: envelope.actorPlayerId, targetPlayerId: envelope.actorPlayerId === "playerA" ? "playerB" : "playerA", balloonType: balloonType, lane: lane, sentAt: simulationTickToTimeMs(envelope.simulationTick) };
    }
    return { type: envelope.actionType, actorPlayerId: envelope.actorPlayerId, wallSegmentId: stringValue(payload.wallSegmentId, "wall segment") };
}
export class FloatRealtimeTimeline {
    state;
    currentTick;
    checkpoints;
    journal = [];
    knownActionIds = new Set();
    appliedActionIds = new Set();
    constructor(initialState, initialTick = simulationTimeMsToTick(initialState.simulationTimeMs)) {
        this.state = structuredClone(initialState);
        this.currentTick = initialTick;
        this.state.simulationTimeMs = simulationTickToTimeMs(initialTick);
        this.checkpoints = [{ simulationTick: initialTick, state: structuredClone(this.state) }];
    }
    advanceTo(targetTick) {
        if (!Number.isSafeInteger(targetTick) || targetTick < this.currentTick)
            throw new Error("Timeline cannot advance backward");
        const updates = [];
        while (this.currentTick < targetTick && this.state.status === "active") {
            this.applyActionsAtCurrentTick();
            updates.push(updateFloatMatch(this.state, SIMULATION_STEP_SECONDS));
            this.currentTick += 1;
            this.state.simulationTimeMs = simulationTickToTimeMs(this.currentTick);
            if (this.currentTick % FLOAT_CHECKPOINT_INTERVAL_TICKS === 0)
                this.saveCheckpoint();
        }
        return updates;
    }
    insert(action) {
        if (this.knownActionIds.has(action.actionId))
            return { status: "duplicate", rewound: false };
        if (action.simulationTick < this.currentTick - FLOAT_REWIND_HISTORY_TICKS)
            return { status: "too_old", rewound: false };
        if (action.simulationTick > this.currentTick + FLOAT_MAX_FUTURE_TICKS)
            return { status: "too_far_ahead", rewound: false };
        this.journal.push(action);
        this.journal.sort(compareFloatRealtimeActions);
        this.knownActionIds.add(action.actionId);
        if (action.simulationTick > this.currentTick) {
            this.trimHistory();
            return { status: "queued", rewound: false };
        }
        const rewound = action.simulationTick < this.currentTick;
        const targetTick = this.currentTick;
        const results = this.rebuildThrough(targetTick, action.simulationTick);
        const result = results.get(action.actionId);
        if (!result || !result.applied) {
            this.journal = this.journal.filter((candidate) => candidate.actionId !== action.actionId);
            this.knownActionIds.delete(action.actionId);
            this.rebuildThrough(targetTick, action.simulationTick);
            return { status: "rejected", rewound, result: result ?? { action: action.actionType, applied: false, code: "replay_failed", message: "Float action could not be replayed" } };
        }
        this.trimHistory();
        return { status: "applied", rewound, result };
    }
    getJournal() {
        return this.journal.map((action) => structuredClone(action));
    }
    exportCheckpoint() {
        return { simulationTick: this.currentTick, state: structuredClone(this.state) };
    }
    rebuildThrough(targetTick, rewindTick) {
        const checkpoint = [...this.checkpoints].reverse().find((candidate) => candidate.simulationTick <= rewindTick) ?? this.checkpoints[0];
        this.checkpoints = this.checkpoints.filter((candidate) => candidate.simulationTick <= checkpoint.simulationTick);
        this.state = structuredClone(checkpoint.state);
        this.currentTick = checkpoint.simulationTick;
        this.appliedActionIds = new Set(this.journal.filter((action) => action.simulationTick < checkpoint.simulationTick).map((action) => action.actionId));
        const results = new Map();
        while (this.currentTick < targetTick && this.state.status === "active") {
            this.applyActionsAtCurrentTick(results);
            updateFloatMatch(this.state, SIMULATION_STEP_SECONDS);
            this.currentTick += 1;
            this.state.simulationTimeMs = simulationTickToTimeMs(this.currentTick);
            if (this.currentTick % FLOAT_CHECKPOINT_INTERVAL_TICKS === 0)
                this.saveCheckpoint();
        }
        this.applyActionsAtCurrentTick(results);
        return results;
    }
    applyActionsAtCurrentTick(results = new Map()) {
        for (const action of this.journal) {
            if (action.simulationTick !== this.currentTick || this.appliedActionIds.has(action.actionId))
                continue;
            results.set(action.actionId, applyFloatMatchAction(this.state, floatRealtimeActionToCoreAction(this.state, action)));
            this.appliedActionIds.add(action.actionId);
        }
        return results;
    }
    saveCheckpoint() {
        this.checkpoints.push({ simulationTick: this.currentTick, state: structuredClone(this.state) });
        this.trimHistory();
    }
    trimHistory() {
        const minimumTick = this.currentTick - FLOAT_REWIND_HISTORY_TICKS;
        const keeper = [...this.checkpoints].reverse().find((checkpoint) => checkpoint.simulationTick <= minimumTick);
        this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.simulationTick >= minimumTick || checkpoint === keeper);
        const earliest = this.checkpoints[0]?.simulationTick ?? minimumTick;
        this.journal = this.journal.filter((action) => action.simulationTick >= earliest);
        this.knownActionIds = new Set(this.journal.map((action) => action.actionId));
        this.appliedActionIds = new Set([...this.appliedActionIds].filter((actionId) => this.knownActionIds.has(actionId)));
    }
}
export function canonicalFloatJson(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Float hash state contains a non-finite number");
        return JSON.stringify(Object.is(value, -0) ? 0 : Number(value.toFixed(9)));
    }
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalFloatJson).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalFloatJson(record[key])}`).join(",")}}`;
}
export function floatHashCoordinateKey(coordinates) {
    return `${coordinates.protocolVersion}:${coordinates.coreVersion}:${coordinates.simulationTick}:${coordinates.playerASequence}:${coordinates.playerBSequence}`;
}
export async function hashFloatState(coordinates, state) {
    const bytes = new TextEncoder().encode(canonicalFloatJson({ coordinates, state }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export class FloatSequenceInbox {
    throughSequence;
    buffered = new Map();
    constructor(throughSequence = 0) {
        if (!Number.isSafeInteger(throughSequence) || throughSequence < 0)
            throw new Error("Invalid Float sequence cursor");
        this.throughSequence = throughSequence;
    }
    receive(action) {
        if (action.clientSequence <= this.throughSequence || this.buffered.has(action.clientSequence))
            return { ready: [], duplicate: true, missing: null };
        if (action.clientSequence - this.throughSequence > FLOAT_MAX_SEQUENCE_GAP)
            throw new Error("Float action sequence gap is too large");
        this.buffered.set(action.clientSequence, action);
        const ready = [];
        while (this.buffered.has(this.throughSequence + 1)) {
            const next = this.buffered.get(this.throughSequence + 1);
            this.buffered.delete(this.throughSequence + 1);
            this.throughSequence += 1;
            ready.push(next);
        }
        const nextBuffered = Math.min(...this.buffered.keys());
        const missing = Number.isFinite(nextBuffered) && nextBuffered > this.throughSequence + 1
            ? { fromSequence: this.throughSequence + 1, toSequence: nextBuffered - 1 }
            : null;
        return { ready, duplicate: false, missing };
    }
    getThroughSequence() {
        return this.throughSequence;
    }
}
//# sourceMappingURL=index.js.map