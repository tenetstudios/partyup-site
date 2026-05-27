"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function CreateRoomButton() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [maxUsers, setMaxUsers] = useState("12");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [roomType, setRoomType] = useState("party");
  const [roomMode, setRoomMode] = useState("livestream");
  const [roomStatus, setRoomStatus] = useState("scheduled");
  const [venueName, setVenueName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  
  async function createRoom() {
    if (loading) return;

    if (!title.trim()) {
      alert("Enter a room name");
      return;
    }

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
          title: title.trim(),
          host_id: user.id,
          current_users: 0,
          queue_count: 0,
          max_users: Number(maxUsers) || 12,
          is_private: isPrivateRoom,
          type: roomType,
          mode: roomMode,
          status: roomStatus,
          scheduled_at:
  roomStatus === "scheduled" && scheduledAt
    ? scheduledAt
    : null,
          venue_name: venueName.trim() || null,
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

      setTitle("");
      setMaxUsers("12");
      setIsPrivateRoom(false);
      setRoomType("party");
      setRoomMode("livestream");
      setRoomStatus("live");
      setVenueName("");
      setScheduledAt("");
      setOpen(false);
      setLoading(false);

      router.push(`/room/${insertedRoom.id}`);
    } catch (error) {
      console.error(error);
      alert("Room could not be created.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[#9146ff] px-6 py-3 font-black hover:bg-[#7b31e8]"
      >
        Open a Room
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12051e] p-5 text-white shadow-2xl shadow-purple-950/50">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">
                  PartyUp
                </p>
                <h2 className="text-2xl font-black">Open a Room</h2>
              </div>

              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-black">Room name</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Late night party room"
                  className="w-full rounded-md bg-black px-3 py-3 text-white outline-none placeholder:text-zinc-500"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-black">Type</span>
                  <select
                    value={roomType}
                    onChange={(event) => setRoomType(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  >
                    <option value="party">Party</option>
<option value="concert">Concert</option>
<option value="dj_set">DJ Set</option>
<option value="popup">Pop-Up</option>
<option value="sports">Sports</option>
<option value="watch_party">Watch Party</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-black">Mode</span>
                  <select
                    value={roomMode}
                    onChange={(event) => setRoomMode(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  >
                    <option value="livestream">Livestream</option>
                    <option value="irl">IRL</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-black">
                    Max users
                  </span>
                  <input
                    value={maxUsers}
                    onChange={(event) => setMaxUsers(event.target.value)}
                    inputMode="numeric"
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-black">Status</span>
                  <select
                    value={roomStatus}
                    onChange={(event) => setRoomStatus(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  >
                    <option value="scheduled">Scheduled</option>
<option value="live">Live</option>
<option value="ended">Ended</option>
                  </select>
                </label>
                {roomStatus === "scheduled" && (
  <label className="block">
    <span className="mb-1 block text-sm font-black">
      Scheduled Date & Time
    </span>

    <input
      type="datetime-local"
      value={scheduledAt}
      onChange={(event) => setScheduledAt(event.target.value)}
      className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
    />
  </label>
)}
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-black">
                  Venue name
                </span>
                <input
                  value={venueName}
                  onChange={(event) => setVenueName(event.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-md bg-black px-3 py-3 text-white outline-none placeholder:text-zinc-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-md bg-black/40 px-3 py-3">
                <span>
                  <span className="block text-sm font-black">Private room</span>
                  <span className="text-xs text-zinc-500">
                    Hide from public browsing later.
                  </span>
                </span>

                <input
                  type="checkbox"
                  checked={isPrivateRoom}
                  onChange={(event) => setIsPrivateRoom(event.target.checked)}
                  className="h-5 w-5"
                />
              </label>

              <button
                onClick={createRoom}
                disabled={loading}
                className="w-full rounded-md bg-[#9146ff] px-5 py-3 font-black hover:bg-[#7b31e8] disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}