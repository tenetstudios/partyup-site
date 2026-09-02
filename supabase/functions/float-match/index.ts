/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Supabase Edge Functions are type-checked by Deno, not Next.js.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SIMULATION_STEP_SECONDS,
  applyFloatMatchAction,
  createFloatMatch,
  createWallSegment,
  updateFloatMatch,
} from "../_shared/balloon-core/index.js";

const GAME_VERSION = "8.1";
const CORE_VERSION = "8.1.0";
const MAX_CATCH_UP_SECONDS = 15 * 60;
const MAX_COMMIT_RETRIES = 5;
const RECONNECT_GRACE_SECONDS = 60;
const MATCH_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function randomMatchCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => MATCH_CODE_ALPHABET[byte % MATCH_CODE_ALPHABET.length]).join("");
}

function createInitialState(matchId: string, seed: number) {
  return createFloatMatch({ matchId, playerIds: ["playerA", "playerB"], seed });
}

function actorPlayerId(match: Record<string, unknown>, userId: string) {
  if (match.player_a_id === userId) return "playerA";
  if (match.player_b_id === userId) return "playerB";
  throw new Error("Not a Float match participant");
}

function resultColumns(match: Record<string, unknown>, state: ReturnType<typeof createFloatMatch>) {
  if (state.status !== "complete" || !state.result) {
    return { status: "active", result: null, winnerUserId: null, completedAt: null };
  }
  if (state.result.type === "draw") {
    return { status: "complete", result: "draw", winnerUserId: null, completedAt: new Date().toISOString() };
  }
  const winnerUserId = state.result.winnerPlayerId === "playerA" ? match.player_a_id : match.player_b_id;
  return {
    status: "complete",
    result: state.result.winnerPlayerId === "playerA" ? "player_a" : "player_b",
    winnerUserId,
    completedAt: new Date().toISOString(),
  };
}

function advanceToServerTime(match: Record<string, unknown>) {
  const state = structuredClone(match.state) as ReturnType<typeof createFloatMatch>;
  if (match.status !== "active" || state.status === "complete") return state;
  const startedAt = Date.parse(String(match.started_at));
  if (!Number.isFinite(startedAt)) throw new Error("Float match has no canonical start time");
  const targetTimeMs = Math.max(state.simulationTimeMs, Date.now() - startedAt);
  const catchUpMs = targetTimeMs - state.simulationTimeMs;
  if (catchUpMs > MAX_CATCH_UP_SECONDS * 1000) throw new Error("Float match requires administrator recovery");
  const stepMs = SIMULATION_STEP_SECONDS * 1000;
  while (state.status === "active" && state.simulationTimeMs + stepMs <= targetTimeMs) {
    updateFloatMatch(state, SIMULATION_STEP_SECONDS);
  }
  return state;
}

function finiteInteger(value: unknown, minimum: number, maximum: number, name: string) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`Invalid ${name}`);
  }
  return Number(value);
}

function canonicalAction(match: Record<string, unknown>, userId: string, actionType: unknown, payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid Float action payload");
  const input = payload as Record<string, unknown>;
  const actor = actorPlayerId(match, userId);
  const state = match.state as ReturnType<typeof createFloatMatch>;
  const room = state.players[actor]?.room;
  if (!room) throw new Error("Canonical player room is missing");
  const wallSegmentId = () => {
    if (typeof input.wallSegmentId !== "string" || input.wallSegmentId.length > 200) throw new Error("Invalid wall segment");
    return input.wallSegmentId;
  };

  switch (actionType) {
    case "PLACE_WALL": {
      if (input.orientation !== "vertical" && input.orientation !== "horizontal") throw new Error("Invalid wall orientation");
      const gridX = finiteInteger(input.gridX, 0, 100, "wall grid X");
      const gridY = finiteInteger(input.gridY, 0, 100, "wall grid Y");
      return {
        action: { type: "PLACE_WALL", actorPlayerId: actor, wall: createWallSegment(room.id, input.orientation, gridX, gridY) },
        payload: { orientation: input.orientation, gridX, gridY },
      };
    }
    case "REMOVE_WALL":
    case "PLACE_NAILS":
    case "REMOVE_NAILS":
    case "PLACE_GLUE":
    case "REMOVE_GLUE":
    case "REPAIR_WALL":
      {
        const id = wallSegmentId();
        return { action: { type: actionType, actorPlayerId: actor, wallSegmentId: id }, payload: { wallSegmentId: id } };
      }
    case "POP_BALLOON":
      if (typeof input.balloonId !== "string" || input.balloonId.length > 240) throw new Error("Invalid balloon");
      return {
        action: { type: "POP_BALLOON", actorPlayerId: actor, balloonId: input.balloonId },
        payload: { balloonId: input.balloonId },
      };
    case "SEND_BALLOON": {
      if (input.balloonType !== "basic" && input.balloonType !== "speed" && input.balloonType !== "heavy") throw new Error("Invalid balloon type");
      const lane = finiteInteger(input.lane, 1, 4, "attack lane");
      return {
        action: {
          type: "SEND_BALLOON",
          actorPlayerId: actor,
          targetPlayerId: actor === "playerA" ? "playerB" : "playerA",
          balloonType: input.balloonType,
          lane,
          sentAt: state.simulationTimeMs,
        },
        payload: { balloonType: input.balloonType, lane },
      };
    }
    default:
      throw new Error("Unsupported Float action");
  }
}

async function loadMatch(adminClient: ReturnType<typeof createClient>, matchId: string) {
  const { data, error } = await adminClient.from("float_matches").select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Float match not found");
  return data as Record<string, unknown>;
}

async function syncMatch(adminClient: ReturnType<typeof createClient>, userId: string, matchId: string) {
  for (let attempt = 0; attempt < MAX_COMMIT_RETRIES; attempt += 1) {
    const match = await loadMatch(adminClient, matchId);
    actorPlayerId(match, userId);
    if (match.game_version !== GAME_VERSION || match.core_version !== CORE_VERSION) throw new Error("FLOAT UPDATE REQUIRED");
    if (match.status !== "active") return match;
    const state = advanceToServerTime(match);
    const columns = resultColumns(match, state);
    const { data, error } = await adminClient.rpc("float_server_commit_state", {
      p_match_id: matchId,
      p_expected_revision: match.state_revision,
      p_state: state,
      p_status: columns.status,
      p_result: columns.result,
      p_winner_user_id: columns.winnerUserId,
      p_completed_at: columns.completedAt,
    });
    if (error) throw error;
    if (!data.conflict) return data.match;
  }
  throw new Error("Float match is busy; retry shortly");
}

async function submitAction(adminClient: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  if (typeof body.matchId !== "string" || typeof body.clientActionId !== "string") throw new Error("Match and client action IDs are required");
  for (let attempt = 0; attempt < MAX_COMMIT_RETRIES; attempt += 1) {
    const match = await loadMatch(adminClient, body.matchId);
    actorPlayerId(match, userId);
    if (match.game_version !== GAME_VERSION || match.core_version !== CORE_VERSION) throw new Error("FLOAT UPDATE REQUIRED");
    const { data: duplicateAction, error: duplicateError } = await adminClient
      .from("float_match_actions")
      .select("*")
      .eq("match_id", body.matchId)
      .eq("client_action_id", body.clientActionId)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicateAction) {
      return { accepted: true, duplicate: true, conflict: false, action: duplicateAction, match };
    }
    const state = advanceToServerTime(match);
    match.state = state;
    const canonical = canonicalAction(match, userId, body.actionType, body.payload);
    const result = applyFloatMatchAction(state, canonical.action);
    if (!result.applied) return { accepted: false, error: result.message, code: result.code, match: { ...match, state } };
    const columns = resultColumns(match, state);
    const { data, error } = await adminClient.rpc("float_server_commit_action", {
      p_match_id: body.matchId,
      p_expected_revision: match.state_revision,
      p_actor_user_id: userId,
      p_client_action_id: body.clientActionId,
      p_action_type: body.actionType,
      p_payload: canonical.payload,
      p_simulation_time_ms: state.simulationTimeMs,
      p_state: state,
      p_status: columns.status,
      p_result: columns.result,
      p_winner_user_id: columns.winnerUserId,
      p_completed_at: columns.completedAt,
    });
    if (error) throw error;
    if (!data.conflict) return data;
  }
  throw new Error("Float match is busy; retry shortly");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = bearerToken(request);
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  if (!token) return jsonResponse({ error: "Authentication required." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: "Authentication required." }, 401);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Malformed JSON request." }, 400); }

  try {
    if (body.operation === "create") {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const matchId = crypto.randomUUID();
        const code = randomMatchCode();
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
        const { data, error } = await adminClient.rpc("float_server_create_match", {
          p_user_id: userData.user.id,
          p_match_id: matchId,
          p_match_code: code,
          p_match_seed: seed,
          p_game_version: GAME_VERSION,
          p_core_version: CORE_VERSION,
          p_initial_state: createInitialState(matchId, seed),
        });
        if (!error) return jsonResponse({ match: data });
        if (error.code !== "23505") throw error;
      }
      throw new Error("Could not allocate a Float match code");
    }

    if (body.operation === "join") {
      if (typeof body.matchCode !== "string") throw new Error("Float match code required");
      const { data, error } = await adminClient.rpc("float_server_join_match", {
        p_user_id: userData.user.id,
        p_match_code: body.matchCode,
        p_game_version: GAME_VERSION,
        p_core_version: CORE_VERSION,
      });
      if (error) throw error;
      return jsonResponse({ match: data });
    }

    if (body.operation === "ready") {
      if (typeof body.matchId !== "string") throw new Error("Float match ID required");
      const match = await loadMatch(adminClient, body.matchId);
      actorPlayerId(match, userData.user.id);
      const { data, error } = await adminClient.rpc("float_server_set_ready", {
        p_user_id: userData.user.id,
        p_match_id: body.matchId,
        p_game_version: GAME_VERSION,
        p_core_version: CORE_VERSION,
        p_initial_state: createInitialState(body.matchId, Number(match.match_seed)),
      });
      if (error) throw error;
      return jsonResponse({ match: data });
    }

    if (body.operation === "sync") {
      if (typeof body.matchId !== "string") throw new Error("Float match ID required");
      const { data: heartbeatMatch, error: heartbeatError } = await adminClient.rpc("float_server_heartbeat", {
        p_user_id: userData.user.id,
        p_match_id: body.matchId,
        p_grace_seconds: RECONNECT_GRACE_SECONDS,
      });
      if (heartbeatError) throw heartbeatError;
      if (heartbeatMatch.status === "abandoned") return jsonResponse({ match: heartbeatMatch });
      return jsonResponse({ match: await syncMatch(adminClient, userData.user.id, body.matchId) });
    }

    if (body.operation === "action") return jsonResponse(await submitAction(adminClient, userData.user.id, body));
    return jsonResponse({ error: "Unsupported Float operation." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Float request failed.";
    const status = /Authentication|required|participant/.test(message) ? 403 : /not found/i.test(message) ? 404 : /UPDATE REQUIRED/.test(message) ? 409 : 400;
    return jsonResponse({ error: message }, status);
  }
});
