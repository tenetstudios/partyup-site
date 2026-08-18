"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { writeActiveRoomContext } from "@/lib/activeRoomContext";
import { recordRoomAnalyticsEvent, readRoomAnalyticsSessionId } from "@/lib/roomAnalytics";
import { createSupabaseClient } from "@/lib/supabase";

export default function JoinRoomContextSetter({ roomId }: { roomId: string }) {
  const router = useRouter();

  useEffect(() => {
    queueMicrotask(() => {
      writeActiveRoomContext(roomId);

      const sessionId = readRoomAnalyticsSessionId();
      if (sessionId) {
        const supabase = createSupabaseClient();
        void recordRoomAnalyticsEvent(supabase, {
          roomId,
          eventType: "qr_scan",
          idempotencyKey: `room-analytics:qr_scan:${roomId}:${sessionId}`,
        }).catch(() => {
          // Analytics must not block QR entry.
        });
      }

      router.replace(`/room/${encodeURIComponent(roomId)}`);
    });
  }, [roomId, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#07000f] px-5 text-white">
      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-[#b587ff]">
          PartyUp venue entry
        </p>
        <h1 className="mt-3 text-3xl font-black">Opening room...</h1>
      </div>
    </main>
  );
}
