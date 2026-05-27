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
    <div className="mt-8 border-t border-white/10 pt-6">
      <Link
        href={`/room/${roomId}/manage`}
        className="inline-flex rounded-md border border-white/15 px-4 py-2 text-sm font-black hover:bg-white/10"
      >
        Manage Room
      </Link>
    </div>
  );
}