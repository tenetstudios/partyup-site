import { type FloatMatchAction, type FloatMatchState, type GameActionResult } from "@partyup/balloon-core";
export declare const FLOAT_REALTIME_PROTOCOL_VERSION: 1;
export declare const FLOAT_SIMULATION_HZ = 60;
export declare const FLOAT_CHECKPOINT_INTERVAL_TICKS = 6;
export declare const FLOAT_REWIND_HISTORY_TICKS = 60;
export declare const FLOAT_MAX_FUTURE_TICKS = 6;
export declare const FLOAT_MAX_SEQUENCE_GAP = 64;
export declare const FLOAT_MAX_PAYLOAD_BYTES = 2048;
export declare const FLOAT_MAX_RESEND_ACTIONS = 256;
export declare const FLOAT_MAX_ACTIONS_PER_SECOND = 30;
export type FloatPlayerId = "playerA" | "playerB";
export type FloatRealtimeActionType = "PLACE_WALL" | "REMOVE_WALL" | "PLACE_NAILS" | "REMOVE_NAILS" | "PLACE_GLUE" | "REMOVE_GLUE" | "REPAIR_WALL" | "SEND_BALLOON" | "POP_BALLOON";
export type FloatRealtimeAction = {
    protocolVersion: typeof FLOAT_REALTIME_PROTOCOL_VERSION;
    matchId: string;
    actionId: string;
    actorPlayerId: FloatPlayerId;
    clientSequence: number;
    simulationTick: number;
    actionType: FloatRealtimeActionType;
    payload: Record<string, unknown>;
};
export type FloatActionAck = {
    protocolVersion: typeof FLOAT_REALTIME_PROTOCOL_VERSION;
    type: "ACTION_ACK";
    actorPlayerId: FloatPlayerId;
    throughSequence: number;
};
export type FloatActionRequest = {
    protocolVersion: typeof FLOAT_REALTIME_PROTOCOL_VERSION;
    type: "REQUEST_ACTIONS";
    actorPlayerId: FloatPlayerId;
    fromSequence: number;
    toSequence: number;
};
export type FloatHashCoordinates = {
    protocolVersion: typeof FLOAT_REALTIME_PROTOCOL_VERSION;
    coreVersion: string;
    simulationTick: number;
    playerASequence: number;
    playerBSequence: number;
};
export type FloatHashReport = FloatHashCoordinates & {
    type: "HASH_REPORT";
    actorPlayerId: FloatPlayerId;
    stateHash: string;
};
export type FloatTimelineInsertResult = {
    status: "applied";
    rewound: boolean;
    result: GameActionResult;
} | {
    status: "queued";
    rewound: false;
} | {
    status: "duplicate";
    rewound: false;
} | {
    status: "too_old" | "too_far_ahead";
    rewound: false;
} | {
    status: "rejected";
    rewound: boolean;
    result: GameActionResult;
};
export declare function simulationTimeMsToTick(simulationTimeMs: number): number;
export declare function simulationTickToTimeMs(simulationTick: number): number;
export declare function compareFloatRealtimeActions(left: FloatRealtimeAction, right: FloatRealtimeAction): number;
export declare function floatActorTopic(matchId: string, actorPlayerId: FloatPlayerId): string;
export declare function validateFloatRealtimeAction(value: unknown, expected: {
    matchId: string;
    actorPlayerId: FloatPlayerId;
}): FloatRealtimeAction;
export declare function floatRealtimeActionToCoreAction(state: FloatMatchState, envelope: FloatRealtimeAction): FloatMatchAction;
export declare class FloatRealtimeTimeline {
    state: FloatMatchState;
    currentTick: number;
    private checkpoints;
    private journal;
    private knownActionIds;
    private appliedActionIds;
    constructor(initialState: FloatMatchState, initialTick?: number);
    advanceTo(targetTick: number): import("@partyup/balloon-core").FloatMatchUpdateResult[];
    insert(action: FloatRealtimeAction): FloatTimelineInsertResult;
    getJournal(): FloatRealtimeAction[];
    exportCheckpoint(): {
        simulationTick: number;
        state: FloatMatchState;
    };
    private rebuildThrough;
    private applyActionsAtCurrentTick;
    private saveCheckpoint;
    private trimHistory;
}
export declare function canonicalFloatJson(value: unknown): string;
export declare function floatHashCoordinateKey(coordinates: FloatHashCoordinates): string;
export declare function hashFloatState(coordinates: FloatHashCoordinates, state: FloatMatchState): Promise<string>;
export type FloatSequenceReceiveResult = {
    ready: FloatRealtimeAction[];
    duplicate: boolean;
    missing: {
        fromSequence: number;
        toSequence: number;
    } | null;
};
export declare class FloatSequenceInbox {
    private throughSequence;
    private buffered;
    constructor(throughSequence?: number);
    receive(action: FloatRealtimeAction): FloatSequenceReceiveResult;
    getThroughSequence(): number;
}
//# sourceMappingURL=index.d.ts.map