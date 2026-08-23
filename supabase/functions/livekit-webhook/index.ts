/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { WebhookReceiver } from "npm:livekit-server-sdk@2";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livekitKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitSecret = Deno.env.get("LIVEKIT_API_SECRET");

  if (!supabaseUrl || !serviceKey || !livekitKey || !livekitSecret) {
    return response({ error: "Server configuration is incomplete." }, 500);
  }

  try {
    const rawBody = await req.text();
    const receiver = new WebhookReceiver(livekitKey, livekitSecret);
    const event = await receiver.receive(rawBody, req.headers.get("Authorization") || undefined);
    const roomId = event.room?.name || event.ingressInfo?.roomName || null;

    if (!roomId || !uuidPattern.test(roomId)) {
      return response({ accepted: true, ignored: "not_an_event_room" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: room } = await admin
      .from("event_rooms")
      .select("id,status")
      .eq("id", roomId)
      .maybeSingle();

    if (!room || room.status === "ended") {
      return response({ accepted: true, ignored: "inactive_event_room" });
    }

    const eventName = event.event || "unknown";
    const participantIdentity = event.participant?.identity || event.ingressInfo?.participantIdentity || null;
    const trackSid = event.track?.sid || null;
    const isVideoTrack =
      Number(event.track?.type) === 1 || String(event.track?.type).toUpperCase() === "VIDEO";

    if (eventName === "track_published" && participantIdentity && trackSid && isVideoTrack) {
      await admin.from("room_live_publishers").upsert(
        {
          room_id: roomId,
          participant_identity: participantIdentity,
          track_sid: trackSid,
          source: "livekit",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,participant_identity,track_sid" },
      );
    }

    if (eventName === "track_unpublished" && participantIdentity && trackSid) {
      await admin
        .from("room_live_publishers")
        .delete()
        .eq("room_id", roomId)
        .eq("participant_identity", participantIdentity)
        .eq("track_sid", trackSid);
    }

    if (eventName === "participant_left" && participantIdentity) {
      await admin
        .from("room_live_publishers")
        .delete()
        .eq("room_id", roomId)
        .eq("participant_identity", participantIdentity);
    }

    const ingressId = event.ingressInfo?.ingressId || null;
    if (eventName === "ingress_started" && ingressId) {
      await admin.from("room_live_publishers").upsert(
        {
          room_id: roomId,
          participant_identity: participantIdentity || `ingress-${ingressId}`,
          track_sid: `ingress-${ingressId}`,
          source: "ingress",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,participant_identity,track_sid" },
      );
    }

    if (eventName === "ingress_ended" && ingressId) {
      await admin
        .from("room_live_publishers")
        .delete()
        .eq("room_id", roomId)
        .eq("track_sid", `ingress-${ingressId}`);
    }

    if (eventName === "room_finished") {
      await admin.from("room_live_publishers").delete().eq("room_id", roomId);
    }

    const { data: publishers } = await admin
      .from("room_live_publishers")
      .select("participant_identity")
      .eq("room_id", roomId);
    const publisherCount = new Set(
      (publishers ?? []).map((publisher) => publisher.participant_identity),
    ).size;

    await admin.from("room_live_state").upsert(
      {
        room_id: roomId,
        is_live: publisherCount > 0,
        active_publisher_count: publisherCount,
        signal_authoritative: true,
        signal_source: `livekit:${eventName}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_id" },
    );

    return response({ accepted: true, event: eventName, room_id: roomId });
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : "Invalid webhook." },
      401,
    );
  }
});
