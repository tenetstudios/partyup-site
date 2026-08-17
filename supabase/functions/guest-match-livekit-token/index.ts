// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedSessionStatuses = new Set(["created", "connecting", "active"]);

type JsonBody = {
  guestToken?: unknown;
  matchSessionId?: unknown;
};

type MatchSession = {
  id: string;
  participant_a_identity: string;
  participant_b_identity: string;
  livekit_room_name: string | null;
  status: string | null;
  expires_at: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

function isUuid(value: unknown) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);

  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs <= Date.now();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");

  if (!supabaseUrl || !supabaseServiceRoleKey || !livekitApiKey || !livekitApiSecret) {
    return errorResponse("Server configuration is incomplete.", 500);
  }

  let body: JsonBody;

  try {
    body = await req.json();
  } catch {
    return errorResponse("Malformed JSON request.", 400);
  }

  if (typeof body.guestToken !== "string" || body.guestToken.length < 32) {
    return errorResponse("guestToken is required.", 400);
  }

  if (!isUuid(body.matchSessionId)) {
    return errorResponse("matchSessionId must be a valid UUID.", 400);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: identityId, error: identityError } = await adminClient.rpc("resolve_guest_identity", {
    p_guest_token: body.guestToken,
  });

  if (identityError || !identityId) {
    return errorResponse("Invalid guest credential.", 401);
  }

  const { data: matchSession, error: sessionError } = await adminClient
    .from("match_sessions")
    .select("id, participant_a_identity, participant_b_identity, livekit_room_name, status, expires_at")
    .eq("id", body.matchSessionId)
    .maybeSingle<MatchSession>();

  if (sessionError) {
    return errorResponse("Could not load Match session.", 500);
  }

  if (!matchSession) {
    return errorResponse("Match session not found.", 404);
  }

  const belongsToSession =
    matchSession.participant_a_identity === identityId ||
    matchSession.participant_b_identity === identityId;

  if (!belongsToSession) {
    return errorResponse("Not authorized for this Match session.", 403);
  }

  if (!matchSession.status || !allowedSessionStatuses.has(matchSession.status)) {
    return errorResponse("Match session is not joinable.", 403);
  }

  if (isExpired(matchSession.expires_at)) {
    return errorResponse("Match session expired.", 410);
  }

  if (!matchSession.livekit_room_name) {
    return errorResponse("Match session is missing a LiveKit room.", 500);
  }

  try {
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: identityId,
      ttl: 15 * 60,
    });

    token.addGrant({
      room: matchSession.livekit_room_name,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return jsonResponse({
      token: await token.toJwt(),
      roomName: matchSession.livekit_room_name,
      participantIdentity: identityId,
    });
  } catch {
    return errorResponse("Could not create LiveKit token.", 500);
  }
});
