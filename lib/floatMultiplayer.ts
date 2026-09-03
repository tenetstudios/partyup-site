import type { FloatMatchState } from "@partyup/balloon-core";
import { createSupabaseClient } from "@/lib/supabase";

export const FLOAT_GAME_VERSION = "8.1";
export const FLOAT_CORE_VERSION = "8.1.0";
export const FLOAT_SYNC_INTERVAL_MS = 2_000;
export const FLOAT_RECONNECT_AFTER_MS = 20_000;
export const FLOAT_ABANDON_GRACE_MS = 60_000;
export const FLOAT_POOL_HEARTBEAT_MS = 15_000;

export type FloatPlayerId = "playerA" | "playerB";
export type FloatMatchStatus = "waiting" | "active" | "complete" | "abandoned";

export type FloatMatchRow = {
  id: string;
  match_code: string;
  status: FloatMatchStatus;
  player_a_id: string;
  player_b_id: string | null;
  player_a_ready: boolean;
  player_b_ready: boolean;
  match_seed: number;
  game_version: string;
  core_version: string;
  state: FloatMatchState;
  state_revision: number;
  last_sequence: number;
  result: "player_a" | "player_b" | "draw" | "abandoned" | null;
  winner_user_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  player_a_last_seen_at: string;
  player_b_last_seen_at: string | null;
  pool_mode: FloatPoolMode | null;
  source_room_id: string | null;
};

export type FloatPoolMode = "room" | "global";
export type FloatPoolStatus = "idle" | "searching" | "matched" | "cancelled" | "expired";
export type FloatPoolResult = { status: FloatPoolStatus; match?: FloatMatchRow; entry?: { pool_mode: FloatPoolMode; room_id: string | null } };

export type FloatActionIntent = {
  actionType: "PLACE_WALL" | "REMOVE_WALL" | "PLACE_NAILS" | "REMOVE_NAILS" | "PLACE_GLUE" | "REMOVE_GLUE" | "REPAIR_WALL" | "SEND_BALLOON" | "POP_BALLOON";
  payload: Record<string, unknown>;
};

export function playerIdForUser(match: FloatMatchRow, userId: string): FloatPlayerId | null {
  if (match.player_a_id === userId) return "playerA";
  if (match.player_b_id === userId) return "playerB";
  return null;
}

async function invokeFloat<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.functions.invoke("float-match", { body });
  if (error) {
    let message = error.message;
    const context = "context" in error ? error.context : null;
    if (context instanceof Response) {
      try {
        const responseBody = await context.clone().json() as { error?: string };
        if (responseBody.error) message = responseBody.error;
      } catch {
        // Preserve the SDK error when the response is not JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export async function createFloatNetworkMatch() {
  return invokeFloat<{ match: FloatMatchRow }>({ operation: "create" });
}

export async function joinFloatNetworkMatch(matchCode: string) {
  return invokeFloat<{ match: FloatMatchRow }>({ operation: "join", matchCode: matchCode.trim().toUpperCase() });
}

export async function joinFloatPool(poolMode: FloatPoolMode, roomId?: string | null) {
  return invokeFloat<FloatPoolResult>({ operation: "poolJoin", poolMode, roomId: roomId ?? null, platform: "web", gameVersion: FLOAT_GAME_VERSION, coreVersion: FLOAT_CORE_VERSION });
}

export async function getFloatPoolStatus() {
  return invokeFloat<FloatPoolResult>({ operation: "poolStatus" });
}

export async function cancelFloatPool() {
  return invokeFloat<FloatPoolResult>({ operation: "poolCancel" });
}

export async function readyFloatNetworkMatch(matchId: string) {
  return invokeFloat<{ match: FloatMatchRow }>({ operation: "ready", matchId });
}

export async function syncFloatNetworkMatch(matchId: string) {
  return invokeFloat<{ match: FloatMatchRow }>({ operation: "sync", matchId });
}

export async function submitFloatNetworkAction(matchId: string, intent: FloatActionIntent, clientActionId = crypto.randomUUID()) {
  return invokeFloat<{ accepted: boolean; duplicate?: boolean; error?: string; code?: string; match: FloatMatchRow }>({
    operation: "action",
    matchId,
    clientActionId,
    ...intent,
  });
}
