"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function RoomStatusWatcher({ roomId }: { roomId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseClient();
    let refreshing = false;

    const refreshEndedRoom = () => {
      if (refreshing) return;
      refreshing = true;
      router.refresh();
    };

    const channel = supabase
      .channel(`room-status-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const status = (payload.new as { status?: string }).status;
          if (status?.toLowerCase() === "ended") refreshEndedRoom();
        },
      )
      .subscribe();

    const fallbackId = window.setInterval(() => {
      void supabase
        .from("event_rooms")
        .select("status")
        .eq("id", roomId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.status?.toLowerCase() === "ended") refreshEndedRoom();
        });
    }, 5000);

    return () => {
      window.clearInterval(fallbackId);
      void supabase.removeChannel(channel);
    };
  }, [roomId, router]);

  return null;
}
