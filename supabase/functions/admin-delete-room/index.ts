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

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function eventImagePath(publicUrl: unknown) {
  if (typeof publicUrl !== "string" || !publicUrl) return null;
  const marker = "/storage/v1/object/public/event-images/";
  const markerIndex = publicUrl.indexOf(marker);
  if (markerIndex < 0) return null;

  try {
    return decodeURIComponent(publicUrl.slice(markerIndex + marker.length));
  } catch {
    return publicUrl.slice(markerIndex + marker.length);
  }
}

async function removeInBatches(admin: ReturnType<typeof createClient>, bucket: string, paths: string[]) {
  for (let start = 0; start < paths.length; start += 1000) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(start, start + 1000));
    if (error) throw new Error(`${bucket}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  const token = bearerToken(req);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  if (!authorization || !token) {
    return jsonResponse({ error: "Server configuration or authentication is missing." }, 401);
  }

  let body: { roomId?: unknown; reason?: unknown; confirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Malformed JSON request." }, 400);
  }

  if (typeof body.roomId !== "string" || typeof body.reason !== "string") {
    return jsonResponse({ error: "roomId and reason are required." }, 400);
  }

  const reason = body.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    return jsonResponse({ error: "The audit reason must be between 5 and 500 characters." }, 400);
  }

  if (body.confirmation !== "DELETE") {
    return jsonResponse({ error: "Type DELETE to confirm permanent room deletion." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    console.error("ADMIN DELETE ROOM AUTH ERROR", userError?.message || "User not found");
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin, error: accessError } = await userClient.rpc("is_site_admin");
  if (accessError || isAdmin !== true) {
    console.error("ADMIN DELETE ROOM ACCESS ERROR", accessError?.message || "Not a site administrator");
    return jsonResponse({ error: "Site administrator access required." }, 403);
  }

  const { data, error: deletionError } = await userClient.rpc("admin_delete_event_room", {
    p_reason: reason,
    p_room_id: body.roomId,
  });
  if (deletionError) {
    console.error("ADMIN DELETE ROOM DATABASE ERROR", deletionError.message);
    return jsonResponse({ error: deletionError.message }, 400);
  }
  const cleanupErrors: string[] = [];

  try {
    const memoryPaths = Array.isArray(data?.memory_paths)
      ? data.memory_paths.filter((path: unknown): path is string => typeof path === "string" && path.length > 0)
      : [];
    await removeInBatches(admin, "room-memories", memoryPaths);
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : "Could not remove room Memories.");
  }

  try {
    if (typeof data?.idle_media_path === "string" && data.idle_media_path) {
      await removeInBatches(admin, "room-idle-media", [data.idle_media_path]);
    }
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : "Could not remove Idle Loop media.");
  }

  try {
    const coverPath = eventImagePath(data?.cover_image);
    if (coverPath) await removeInBatches(admin, "event-images", [coverPath]);
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : "Could not remove the cover image.");
  }

  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const livekitKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (livekitUrl && livekitKey && livekitSecret) {
    try {
      const httpUrl = livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
      const roomService = new RoomServiceClient(httpUrl, livekitKey, livekitSecret);
      await roomService.deleteRoom(body.roomId);
    } catch {
      // No active LiveKit room is already a valid deleted state.
    }
  }

  return jsonResponse({
    deleted: true,
    room_id: body.roomId,
    cleanup_complete: cleanupErrors.length === 0,
    cleanup_errors: cleanupErrors,
  });
});
