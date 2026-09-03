import {
  SIMULATION_STEP_SECONDS,
  applyFloatMatchAction,
  createWallSegment,
  updateFloatMatch,
  type BalloonType,
  type FloatMatchAction,
  type FloatMatchState,
  type SpawnLane,
  type WallOrientation,
} from "@partyup/balloon-core";
import type { FloatActionIntent, FloatPlayerId } from "@/lib/floatMultiplayer";

export type PendingFloatAction = {
  actionId: string;
  actorPlayerId: FloatPlayerId;
  intent: FloatActionIntent;
  simulationTimeMs: number;
};

function integer(value: unknown, name: string) {
  if (!Number.isInteger(value)) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
}

export function floatActionFromIntent(
  state: FloatMatchState,
  actorPlayerId: FloatPlayerId,
  intent: FloatActionIntent,
  simulationTimeMs = state.simulationTimeMs,
): FloatMatchAction {
  const room = state.players[actorPlayerId]?.room;
  if (!room) throw new Error("Player room is unavailable");
  const payload = intent.payload;

  if (intent.actionType === "PLACE_WALL") {
    const orientation = payload.orientation;
    if (orientation !== "vertical" && orientation !== "horizontal") throw new Error("Invalid wall orientation");
    return {
      type: "PLACE_WALL",
      actorPlayerId,
      wall: createWallSegment(
        room.id,
        orientation as WallOrientation,
        integer(payload.gridX, "wall grid X"),
        integer(payload.gridY, "wall grid Y"),
      ),
    };
  }

  if (intent.actionType === "POP_BALLOON") {
    return { type: "POP_BALLOON", actorPlayerId, balloonId: stringValue(payload.balloonId, "balloon") };
  }

  if (intent.actionType === "SEND_BALLOON") {
    const balloonType = payload.balloonType;
    if (balloonType !== "basic" && balloonType !== "speed" && balloonType !== "heavy") throw new Error("Invalid balloon type");
    const lane = integer(payload.lane, "attack lane");
    if (lane < 1 || lane > 4) throw new Error("Invalid attack lane");
    return {
      type: "SEND_BALLOON",
      actorPlayerId,
      targetPlayerId: actorPlayerId === "playerA" ? "playerB" : "playerA",
      balloonType: balloonType as BalloonType,
      lane: lane as SpawnLane,
      sentAt: simulationTimeMs,
    };
  }

  return {
    type: intent.actionType,
    actorPlayerId,
    wallSegmentId: stringValue(payload.wallSegmentId, "wall segment"),
  } as FloatMatchAction;
}

export function advanceFloatStateTo(state: FloatMatchState, targetTimeMs: number) {
  const stepMs = SIMULATION_STEP_SECONDS * 1000;
  while (state.status === "active" && state.simulationTimeMs + stepMs <= targetTimeMs) {
    updateFloatMatch(state, SIMULATION_STEP_SECONDS);
  }
  return state;
}

export function reconcileFloatState(
  authoritativeState: FloatMatchState,
  pendingActions: readonly PendingFloatAction[],
  targetTimeMs: number,
) {
  const state = structuredClone(authoritativeState);
  for (const pending of pendingActions) {
    advanceFloatStateTo(state, Math.min(pending.simulationTimeMs, targetTimeMs));
    const action = floatActionFromIntent(state, pending.actorPlayerId, pending.intent, pending.simulationTimeMs);
    applyFloatMatchAction(state, action);
  }
  return advanceFloatStateTo(state, targetTimeMs);
}

export function isNewerGameplaySnapshot(currentRevision: number | null, incomingRevision: number) {
  return currentRevision === null || incomingRevision > currentRevision;
}
