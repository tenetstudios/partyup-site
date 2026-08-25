/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request) {
  const [scheme, token] = (req.headers.get("Authorization") || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livekitKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!supabaseUrl || !anonKey || !serviceKey || !livekitKey || !livekitSecret) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const token = bearerToken(req);
  if (!token) return jsonResponse({ error: "Authentication required." }, 401);

  let body: { roomName?: unknown; participantName?: unknown; canPublish?: unknown };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Malformed JSON request." }, 400); }
  if (typeof body.roomName !== "string" || !uuidPattern.test(body.roomName)) {
    return jsonResponse({ error: "roomName must be an event room UUID." }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: "Authentication required." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: room, error: roomError } = await admin
    .from("event_rooms")
    .select("id,host_id,status,is_private")
    .eq("id", body.roomName)
    .maybeSingle();
  if (roomError) return jsonResponse({ error: "Could not load event room." }, 500);
  if (!room) return jsonResponse({ error: "Event room not found." }, 404);
  if (room.status === "ended") return jsonResponse({ error: "This event has ended." }, 410);

  const isHost = room.host_id === userData.user.id;
  const [{ data: attendee }, { data: queueEntry }] = await Promise.all([
    admin
      .from("event_attendees")
      .select("status,can_stream")
      .eq("event_room_id", room.id)
      .eq("user_id", userData.user.id)
      .maybeSingle(),
    admin
      .from("room_stream_queue")
      .select("status")
      .eq("room_id", room.id)
      .eq("user_id", userData.user.id)
      .maybeSingle(),
  ]);
  const isAccepted = attendee?.status === "accepted";
  if (room.is_private && !isHost && !isAccepted) {
    return jsonResponse({ error: "You are not approved for this private room." }, 403);
  }

  const mayPublish = body.canPublish === true && (
    isHost || (isAccepted && attendee?.can_stream === true && queueEntry?.status === "live")
  );
  const participantName = typeof body.participantName === "string" && body.participantName.trim()
    ? body.participantName.trim().slice(0, 80)
    : `Guest ${userData.user.id.slice(0, 4)}`;

  try {
    const accessToken = new AccessToken(livekitKey, livekitSecret, {
      identity: userData.user.id,
      name: participantName,
      ttl: 15 * 60,
    });
    accessToken.addGrant({
      room: room.id,
      roomJoin: true,
      canPublish: mayPublish,
      canSubscribe: true,
      canPublishData: mayPublish,
    });
    return jsonResponse({ token: await accessToken.toJwt(), roomName: room.id, participantIdentity: userData.user.id, canPublish: mayPublish });
  } catch {
    return jsonResponse({ error: "Could not create LiveKit token." }, 500);
  }
});
