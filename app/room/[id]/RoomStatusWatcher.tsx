"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function RoomStatusWatcher({ roomId }: { roomId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`room-status-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const status = (payload.new as { status?: string }).status;
          if (status === "ended") router.refresh();
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [roomId, router]);

  return null;
}
