import type { SupabaseClient } from "@supabase/supabase-js";

export type RoomAnalyticsEventType =
  | "qr_scan"
  | "room_entry"
  | "match_started"
  | "match_connected"
  | "match_next"
  | "keep_in_touch"
  | "mutual_connection"
  | "context_return"
  | "context_leave";

export type HostDashboardRoom = {
  id: string;
  title: string | null;
  status: string | null;
  current_users: number | null;
  created_at: string | null;
  scheduled_at: string | null;
};

export type HostDashboardAnnouncement = {
  id: string;
  title: string;
  message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  expires_at: string | null;
  is_active: boolean;
};

export type HostDashboardData = {
  room: HostDashboardRoom;
  window_start: string;
  event_pool_id: string | null;
  live: {
    here_now: number;
    matching: number;
    active_matches: number;
    connections: number;
    waiting_to_stream: number;
    streamers: number;
    bouncers: number;
    obs_ready: boolean;
  };
  announcement: HostDashboardAnnouncement | null;
  funnel: Partial<Record<RoomAnalyticsEventType, number>>;
};

export async function getRoomHostDashboard(
  supabase: SupabaseClient,
  roomId: string,
): Promise<HostDashboardData> {
  const { data, error } = await supabase.rpc("get_room_host_dashboard", {
    p_room_id: roomId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as HostDashboardData;
}

export async function recordRoomAnalyticsEvent(
  supabase: SupabaseClient,
  input: {
    roomId: string;
    eventType: RoomAnalyticsEventType;
    sessionId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.rpc("record_room_analytics_event", {
    p_room_id: input.roomId,
    p_event_type: input.eventType,
    p_session_id: input.sessionId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(error.message);
  }
}

export function readRoomAnalyticsSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = "partyup_room_analytics_session_id";
  const existing = window.sessionStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const next =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  window.sessionStorage.setItem(storageKey, next);
  return next;
}

