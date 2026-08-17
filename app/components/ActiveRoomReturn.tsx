"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeRoomContextChangeEvent,
  activeRoomContextStorageKey,
  clearActiveRoomContext,
  readActiveRoomContext,
  type ActiveRoomContext,
} from "@/lib/activeRoomContext";
import { getRoomContextLabel, isRoomContextAvailable, type RoomContextRecord } from "@/lib/roomContextValidation";
import { createSupabaseClient } from "@/lib/supabase";

type ActiveRoomState = {
  context: ActiveRoomContext;
  label: string;
};

export default function ActiveRoomReturn() {
  const pathname = usePathname();
  const [activeRoom, setActiveRoom] = useState<ActiveRoomState | null>(null);

  const loadActiveRoom = useCallback(async () => {
    const context = readActiveRoomContext();

    if (!context) {
      setActiveRoom(null);
      return;
    }

    const supabase = createSupabaseClient();
    const { data: room, error } = await supabase
      .from("event_rooms")
      .select("*")
      .eq("id", context.roomId)
      .single();

    const typedRoom = room as RoomContextRecord | null;

    if (error || !isRoomContextAvailable(typedRoom)) {
      clearActiveRoomContext();
      setActiveRoom(null);
      return;
    }

    setActiveRoom({
      context,
      label: getRoomContextLabel(typedRoom),
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      loadActiveRoom();
    });

    function handleStorage(event: StorageEvent) {
      if (event.key === activeRoomContextStorageKey) {
        loadActiveRoom();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(activeRoomContextChangeEvent, loadActiveRoom);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(activeRoomContextChangeEvent, loadActiveRoom);
    };
  }, [loadActiveRoom]);

  const shouldHide = useMemo(() => {
    if (!activeRoom) {
      return true;
    }

    const encodedRoomId = encodeURIComponent(activeRoom.context.roomId);
    return pathname === `/room/${encodedRoomId}` || pathname === `/join/${encodedRoomId}`;
  }, [activeRoom, pathname]);

  if (shouldHide || !activeRoom) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:justify-start sm:px-6">
      <div className="flex max-w-full items-center gap-2 rounded-[8px] border border-[#7f3dff]/45 bg-[#10051b]/95 p-2 text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur">
        <Link
          href={`/room/${encodeURIComponent(activeRoom.context.roomId)}`}
          className="min-w-0 truncate rounded-[6px] bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8]"
        >
          Back to {activeRoom.label}
        </Link>
        <button
          type="button"
          onClick={clearActiveRoomContext}
          className="rounded-[6px] px-3 py-2 text-sm font-black text-[#c8c0d4] hover:bg-white/10 hover:text-white"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
