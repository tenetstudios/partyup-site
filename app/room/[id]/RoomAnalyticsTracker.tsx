"use client";

import { useEffect, useMemo } from "react";
import { recordRoomAnalyticsEvent, readRoomAnalyticsSessionId, type RoomAnalyticsEventType } from "@/lib/roomAnalytics";
import { createSupabaseClient } from "@/lib/supabase";

export default function RoomAnalyticsTracker({
  eventType,
  roomId,
}: {
  eventType: Extract<RoomAnalyticsEventType, "room_entry">;
  roomId: string;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);

  useEffect(() => {
    queueMicrotask(() => {
      const sessionId = readRoomAnalyticsSessionId();
      if (!sessionId) return;

      const idempotencyKey = `room-analytics:${eventType}:${roomId}:${sessionId}`;
      void recordRoomAnalyticsEvent(supabase, {
        roomId,
        eventType,
        idempotencyKey,
      }).catch(() => {
        // Analytics must not block room usage.
      });
    });
  }, [eventType, roomId, supabase]);

  return null;
}

