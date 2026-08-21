/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { RoomServiceClient } from "npm:livekit-server-sdk@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const livekitKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  let body: { roomId?: unknown };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Malformed JSON request." }, 400); }
  if (typeof body.roomId !== "string") return jsonResponse({ error: "roomId is required." }, 400);

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("end_event_room", { p_room_id: body.roomId });
  if (error) return jsonResponse({ error: error.message }, 400);

  let mediaRoomClosed = false;
  if (livekitUrl && livekitKey && livekitSecret) {
    try {
      const httpUrl = livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
      const roomService = new RoomServiceClient(httpUrl, livekitKey, livekitSecret);
      await roomService.deleteRoom(body.roomId);
      mediaRoomClosed = true;
    } catch {
      // A room without an active LiveKit session is already effectively closed.
    }
  }

  return jsonResponse({ ...data, media_room_closed: mediaRoomClosed });
});
