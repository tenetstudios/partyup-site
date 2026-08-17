"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activeRoomContextChangeEvent,
  activeRoomContextStorageKey,
  clearActiveRoomContext,
  readActiveRoomContext,
} from "@/lib/activeRoomContext";

export default function LeaveRoomContextButton({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [isActiveContext, setIsActiveContext] = useState(false);

  useEffect(() => {
    function refresh() {
      setIsActiveContext(readActiveRoomContext()?.roomId === roomId);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === activeRoomContextStorageKey) {
        refresh();
      }
    }

    refresh();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(activeRoomContextChangeEvent, refresh);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(activeRoomContextChangeEvent, refresh);
    };
  }, [roomId]);

  if (!isActiveContext) {
    return null;
  }

  function leaveContext() {
    clearActiveRoomContext();
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={leaveContext}
      className="rounded-[6px] border border-white/10 px-4 py-2 text-sm font-black text-[#d8d1e2] hover:bg-white/10 hover:text-white"
    >
      Leave Venue
    </button>
  );
}
