"use client";

import { useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

export default function JoinRoomButton({ roomId }: { roomId: string }) {
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);

  async function joinRoom() {
    if (loading) return;

    setLoading(true);

    try {
      const supabase = createSupabaseClient();

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) {
        alert("You need to sign in first.");
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", user.id)
        .single();

      const { error } = await supabase.from("event_attendees").upsert(
        {
          event_room_id: roomId,
          user_id: user.id,
          username:
  profile?.username ||
  user.user_metadata?.full_name ||
  user.user_metadata?.name ||
  "PartyUp User",
          avatar_url: profile?.avatar_url || "",
          status: "accepted",
          can_stream: false,
          stream_status: "off",
        },
        {
          onConflict: "event_room_id,user_id",
        },
      );

      if (error) {
        alert(error.message);
        setLoading(false);
        return;
      }

      setJoined(true);
      setLoading(false);
    } catch (error) {
      console.error(error);
      alert("Could not join room.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={joinRoom}
      disabled={loading || joined}
      className="mt-8 rounded-md bg-[#9146ff] px-6 py-3 font-black hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {joined ? "Joined" : loading ? "Joining..." : "Join Room"}
    </button>
  );
}