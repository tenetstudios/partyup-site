"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function EndEventButton({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);

  async function endEvent() {
    if (ending) return;

    const confirmed = window.confirm(
      "End this event? The room will become read-only. Memories, recaps, attendance, and Event Series history will be kept.",
    );
    if (!confirmed) return;

    setEnding(true);
    const supabase = createSupabaseClient();
    await supabase.functions.invoke("delete-ingress", { body: { roomName: roomId } }).catch(() => undefined);
    const { error } = await supabase.functions.invoke("end-event-room", {
      body: { roomId },
    });

    if (error) {
      alert(error.message);
      setEnding(false);
      return;
    }

    router.push(`/room/${roomId}`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={endEvent}
      disabled={ending}
      className="rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8] disabled:opacity-50"
    >
      {ending ? "Ending Event..." : "End Event"}
    </button>
  );
}
