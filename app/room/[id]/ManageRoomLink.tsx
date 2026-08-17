"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

export default function ManageRoomLink({
  roomId,
  hostId,
}: {
  roomId: string;
  hostId: string;
}) {
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    async function checkHost() {
      const supabase = createSupabaseClient();
      const { data } = await supabase.auth.getUser();

      setIsHost(data.user?.id === hostId);
    }

    checkHost();
  }, [hostId]);

  if (!isHost) return null;

  return (
    <Link
      href={`/room/${roomId}/manage`}
      className="inline-flex min-h-12 items-center gap-3 rounded-[8px] border border-white/15 bg-white/[0.04] px-5 text-sm font-black text-[#c9c2d7] shadow-[0_12px_36px_rgba(0,0,0,0.24)] hover:bg-white/10"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.2 2.2 0 1 1-3.11 3.11l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.09 1.65V21.5a2.2 2.2 0 0 1-4.4 0v-.12a1.8 1.8 0 0 0-1.09-1.65 1.8 1.8 0 0 0-1.98.36l-.04.04a2.2 2.2 0 1 1-3.11-3.11l.04-.04A1.8 1.8 0 0 0 3.4 15a1.8 1.8 0 0 0-1.65-1.09H1.6a2.2 2.2 0 0 1 0-4.4h.15A1.8 1.8 0 0 0 3.4 8.42a1.8 1.8 0 0 0-.36-1.98L3 6.4a2.2 2.2 0 1 1 3.11-3.11l.04.04a1.8 1.8 0 0 0 1.98.36h.01A1.8 1.8 0 0 0 9.23 2V1.9a2.2 2.2 0 0 1 4.4 0V2a1.8 1.8 0 0 0 1.09 1.65h.01a1.8 1.8 0 0 0 1.98-.36l.04-.04a2.2 2.2 0 1 1 3.11 3.11l-.04.04a1.8 1.8 0 0 0-.36 1.98v.01a1.8 1.8 0 0 0 1.65 1.09h.13a2.2 2.2 0 0 1 0 4.4h-.13A1.8 1.8 0 0 0 19.4 15Z" />
      </svg>
      Room Settings
    </Link>
  );
}
