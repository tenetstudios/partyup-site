"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function CreateRoomButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function createRoom() {
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

      const { data: existingProfile } = await supabase
  .from("profiles")
  .select("username, avatar_url")
  .eq("id", user.id)
  .maybeSingle();

let profile = existingProfile;

if (!profile) {
  const { data: createdProfile } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      username:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "Guest",
      avatar_url:
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        "",
      bio: "",
      is_google_verified: !!user.email,
    })
    .select("username, avatar_url")
    .single();

  profile = createdProfile;
}

      const { data: insertedRoom, error: roomError } = await supabase
        .from("event_rooms")
        .insert({
          title: "Web Room",
          host_id: user.id,
          current_users: 0,
          queue_count: 0,
          max_users: 12,
          is_private: false,
          type: "party",
          mode: "livestream",
          status: "live",
          venue_name: null,
          latitude: null,
          longitude: null,
          last_active_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (roomError || !insertedRoom?.id) {
        alert(roomError?.message || "Room could not be created.");
        setLoading(false);
        return;
      }

      const { error: attendeeError } = await supabase
        .from("event_attendees")
        .upsert(
          {
            event_room_id: insertedRoom.id,
            user_id: user.id,
            username: profile?.username || "Host",
            avatar_url: profile?.avatar_url || "",
            status: "accepted",
            can_stream: true,
            stream_status: "off",
          },
          {
            onConflict: "event_room_id,user_id",
          },
        );

      if (attendeeError) {
        alert(attendeeError.message);
        setLoading(false);
        return;
      }

      router.push(`/room/${insertedRoom.id}`);
    } catch (error) {
      console.error(error);
      alert("Room could not be created.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={createRoom}
      disabled={loading}
      className="rounded-md bg-[#9146ff] px-6 py-3 font-black hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Creating..." : "Open a Room"}
    </button>
  );
}