/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/*
  Setup in plain English:

  1. Generate one random PUSH_DISPATCH_SECRET.
  2. Save it as a Supabase Edge Function secret.
  3. Put the same value in the Database Webhook header named
     x-partyup-push-secret.

  EXPO_ACCESS_TOKEN is only needed when Expo push access-token security is
  enabled. FCM and APNs credentials are configured through EAS, not here.

  See ./README.md for the copyable manual setup checklist.
*/
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-partyup-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const expoUrl = "https://exp.host/--/api/v2/push/send";
const receiptUrl = "https://exp.host/--/api/v2/push/getReceipts";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function expoHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function checkReceipts(admin: ReturnType<typeof createClient>) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: deliveries } = await admin
    .from("push_notification_deliveries")
    .select("id, device_id, expo_ticket_id")
    .eq("status", "sent")
    .is("receipt_checked_at", null)
    .lte("sent_at", cutoff)
    .limit(300);
  if (!deliveries?.length) return 0;

  let checked = 0;
  for (const group of chunks(deliveries, 300)) {
    const response = await fetch(receiptUrl, {
      method: "POST",
      headers: expoHeaders(),
      body: JSON.stringify({ ids: group.map((item) => item.expo_ticket_id) }),
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const now = new Date().toISOString();
    for (const delivery of group) {
      const receipt = payload?.data?.[delivery.expo_ticket_id];
      if (!receipt) continue;
      const code = receipt.details?.error ?? null;
      const dead = code === "DeviceNotRegistered";
      await admin.from("push_notification_deliveries").update({
        status: receipt.status === "ok" ? "delivered" : dead ? "dead" : "failed",
        error_code: code,
        error_message: receipt.message ?? null,
        receipt_checked_at: now,
        updated_at: now,
      }).eq("id", delivery.id);
      if (dead) {
        await admin.from("push_devices").update({
          enabled: false,
          disabled_at: now,
          disabled_reason: "DeviceNotRegistered",
          updated_at: now,
        }).eq("id", delivery.device_id);
      }
      checked += 1;
    }
  }
  return checked;
}

async function dispatchEvent(admin: ReturnType<typeof createClient>, eventId: string) {
  const { data: event, error: eventError } = await admin
    .from("push_notification_events")
    .select("id, preference_category, data")
    .eq("id", eventId)
    .single();
  if (eventError || !event) return { eventId, sent: 0, skipped: true };

  const preferenceColumn = `${event.preference_category}_enabled`;
  const { data: recipients } = await admin
    .from("push_notification_recipients")
    .select("identity_id, title, body, activity_notification_id")
    .eq("event_id", eventId);
  if (!recipients?.length) return { eventId, sent: 0 };

  const identityIds = recipients.map((item) => item.identity_id);
  const [{ data: preferences }, { data: devices }] = await Promise.all([
    admin.from("notification_preferences").select(`identity_id, ${preferenceColumn}`).in("identity_id", identityIds),
    admin.from("push_devices").select("id, identity_id, expo_push_token").in("identity_id", identityIds).eq("enabled", true),
  ]);
  const allowed = new Map((preferences ?? []).map((item) => [item.identity_id, item[preferenceColumn] !== false]));
  const recipientByIdentity = new Map(recipients.map((item) => [item.identity_id, item]));
  const candidates = (devices ?? []).filter((device) => allowed.get(device.identity_id) !== false);
  const pending: Array<{ deliveryId: string; deviceId: string; message: unknown }> = [];

  for (const device of candidates) {
    const recipient = recipientByIdentity.get(device.identity_id);
    if (!recipient) continue;
    const { data: existing } = await admin.from("push_notification_deliveries")
      .select("id, status").eq("event_id", eventId).eq("device_id", device.id).maybeSingle();
    if (existing && existing.status !== "failed") continue;
    const operation = existing
      ? admin.from("push_notification_deliveries").update({
          status: "pending", error_code: null, error_message: null, attempted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", existing.id)
      : admin.from("push_notification_deliveries").insert({ event_id: eventId, device_id: device.id, status: "pending" });
    const { data: delivery } = await operation.select("id").maybeSingle();
    if (!delivery) continue;
    pending.push({
      deliveryId: delivery.id,
      deviceId: device.id,
      message: {
        to: device.expo_push_token,
        title: recipient.title,
        body: recipient.body,
        sound: "default",
        priority: "high",
        channelId: "partyup",
        data: { ...event.data, activityNotificationId: recipient.activity_notification_id },
      },
    });
  }

  let sent = 0;
  for (const group of chunks(pending, 100)) {
    let tickets: unknown[] = [];
    try {
      const response = await fetch(expoUrl, {
        method: "POST",
        headers: expoHeaders(),
        body: JSON.stringify(group.map((item) => item.message)),
      });
      if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
      const payload = await response.json();
      tickets = Array.isArray(payload?.data) ? payload.data : [];
    } catch (error) {
      const now = new Date().toISOString();
      for (const item of group) {
        await admin.from("push_notification_deliveries").update({
          status: "failed", error_message: String(error), updated_at: now,
        }).eq("id", item.deliveryId);
      }
      continue;
    }

    for (let index = 0; index < group.length; index += 1) {
      const item = group[index];
      const ticket = tickets[index] ?? {};
      const code = ticket?.details?.error ?? null;
      const dead = code === "DeviceNotRegistered";
      const now = new Date().toISOString();
      await admin.from("push_notification_deliveries").update({
        status: ticket.status === "ok" ? "sent" : dead ? "dead" : "failed",
        expo_ticket_id: ticket.id ?? null,
        error_code: code,
        error_message: ticket.message ?? null,
        sent_at: ticket.status === "ok" ? now : null,
        updated_at: now,
      }).eq("id", item.deliveryId);
      if (dead) {
        await admin.from("push_devices").update({
          enabled: false, disabled_at: now, disabled_reason: "DeviceNotRegistered", updated_at: now,
        }).eq("id", item.deviceId);
      }
      if (ticket.status === "ok") sent += 1;
    }
  }
  return { eventId, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ error: "Push sender is not configured." }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return reply({ error: "Malformed JSON request." }, 400); }
  const configuredSecret = Deno.env.get("PUSH_DISPATCH_SECRET");
  const webhookAuthorized = Boolean(configuredSecret) && req.headers.get("x-partyup-push-secret") === configuredSecret;
  const authorization = req.headers.get("Authorization");
  const hostRoomId: string | null = typeof body.roomId === "string" ? body.roomId : null;

  if (!webhookAuthorized) {
    if (!authorization || !hostRoomId) return reply({ error: "Authentication required." }, 401);
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await caller.auth.getUser();
    const { data: room } = await admin.from("event_rooms").select("host_id").eq("id", hostRoomId).single();
    if (!userData.user || room?.host_id !== userData.user.id) return reply({ error: "Only the room host can dispatch." }, 403);
  }

  let eventIds: string[] = [];
  const webhookId = body.record && typeof body.record === "object" ? (body.record as Record<string, unknown>).id : null;
  const requestedId = typeof body.eventId === "string" ? body.eventId : typeof webhookId === "string" ? webhookId : null;
  if (requestedId) {
    eventIds = [requestedId];
  } else if (hostRoomId) {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: events } = await admin.from("push_notification_events")
      .select("id").eq("room_id", hostRoomId).gte("created_at", cutoff).order("created_at", { ascending: true });
    eventIds = (events ?? []).map((event) => event.id);
  }

  const results = [];
  for (const eventId of eventIds) results.push(await dispatchEvent(admin, eventId));
  const receiptsChecked = await checkReceipts(admin);
  return reply({ dispatched: results, receiptsChecked });
});
