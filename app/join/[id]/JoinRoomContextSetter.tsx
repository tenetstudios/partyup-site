"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { writeActiveRoomContext } from "@/lib/activeRoomContext";

export default function JoinRoomContextSetter({ roomId }: { roomId: string }) {
  const router = useRouter();

  useEffect(() => {
    writeActiveRoomContext(roomId);
    router.replace(`/room/${encodeURIComponent(roomId)}`);
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
