"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function DeleteRoomButton({
  roomId,
  hostId,
}: {
  roomId: string;
  hostId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function deleteRoom() {
    if (loading) return;

    const confirmed = window.confirm("Delete this room?");
    if (!confirmed) return;

    setLoading(true);

    const supabase = createSupabaseClient();

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user || user.id !== hostId) {
      alert("Only the host can delete this room.");
      setLoading(false);
      return;
    }

    await supabase
      .from("event_attendees")
      .delete()
      .eq("event_room_id", roomId);

    const { error } = await supabase
      .from("event_rooms")
      .delete()
      .eq("id", roomId)
      .eq("host_id", user.id);

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    router.push("/");
  }

  return (
    <button
      onClick={deleteRoom}
      disabled={loading}
      className="mt-4 rounded-md border border-red-500/40 px-6 py-3 font-black text-red-300 hover:bg-red-500/10 disabled:opacity-50"
    >
      {loading ? "Deleting..." : "Delete Room"}
    </button>
  );
}   