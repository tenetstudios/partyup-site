"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type Attendee = {
  id?: string;
  event_room_id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  status: string | null;
  can_stream: boolean | null;
  stream_status: string | null;
};

export default function RoomManagePanel({ roomId }: { roomId: string }) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isHost, setIsHost] = useState(false);

  async function loadRoomData() {
    const supabase = createSupabaseClient();

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) return;

    const { data: room } = await supabase
      .from("event_rooms")
      .select("host_id")
      .eq("id", roomId)
      .single();

    setIsHost(room?.host_id === user.id);

    const { data } = await supabase
      .from("event_attendees")
      .select("*")
      .eq("event_room_id", roomId)
      .order("username", { ascending: true });

    setAttendees((data ?? []) as Attendee[]);
  }

  useEffect(() => {
    loadRoomData();

    const supabase = createSupabaseClient();

    const channel = supabase
      .channel(`manage-room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_attendees",
          filter: `event_room_id=eq.${roomId}`,
        },
        () => {
          loadRoomData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  async function updateAttendee(userId: string, values: Partial<Attendee>) {
    const supabase = createSupabaseClient();

    const { error } = await supabase
      .from("event_attendees")
      .update(values)
      .eq("event_room_id", roomId)
      .eq("user_id", userId);

    if (error) alert(error.message);
  }

  async function kickUser(userId: string) {
    const confirmed = window.confirm("Kick this user from the room?");
    if (!confirmed) return;

    const supabase = createSupabaseClient();

    const { error } = await supabase
      .from("event_attendees")
      .delete()
      .eq("event_room_id", roomId)
      .eq("user_id", userId);

    if (error) alert(error.message);
  }

 async function testObsIngress() {
  const supabase = createSupabaseClient();

  const { data, error } = await supabase.functions.invoke(
    "create-obs-stream",
    {
      body: {
        roomName: roomId,
        participantName: "OBS Stream",
      },
    },
  );

  console.log("OBS DATA:", data);
  console.log("OBS ERROR:", error);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Check browser console (F12)");
}

  if (!isHost) {
    return (
      <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
        Only the room host can manage this room.
      </div>
    );
  }

  const queue = attendees.filter((attendee) =>
  ["pending", "waiting", "requested", "queued"].includes(
    attendee.status || "",
  ),
);

const accepted = attendees.filter(
  (attendee) => attendee.status === "accepted",
);

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Queue & Members</h2>
      </div>

      <div className="divide-y divide-white/10">
  <div className="p-4">
    <h3 className="mb-3 text-sm font-black uppercase tracking-[0.16em] text-purple-300">
      Waiting Queue
    </h3>

    {queue.length === 0 ? (
      <p className="text-sm text-zinc-500">No one is waiting.</p>
    ) : (
      <div className="space-y-3">
        {queue.map((attendee) => (
          <div
            key={attendee.user_id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-black/30 p-3"
          >
            <div className="flex items-center gap-3">
              {attendee.avatar_url ? (
                <img
                  src={attendee.avatar_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#9146ff] font-black">
                  {(attendee.username || "U").slice(0, 1).toUpperCase()}
                </div>
              )}

              <div>
                <p className="font-black">
                  {attendee.username || "Unknown User"}
                </p>
                <p className="text-xs text-zinc-500">
                  status: {attendee.status || "unknown"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  updateAttendee(attendee.user_id, {
                    status: "accepted",
                  })
                }
                className="rounded-md bg-green-600 px-3 py-2 text-xs font-black hover:bg-green-500"
              >
                Approve
              </button>

              <button
                onClick={() => kickUser(attendee.user_id)}
                className="rounded-md border border-red-500/40 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/10"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  <div className="p-4">
    <h3 className="mb-3 text-sm font-black uppercase tracking-[0.16em] text-purple-300">
      Accepted Members
    </h3>

    {accepted.length === 0 ? (
      <p className="text-sm text-zinc-500">No accepted members yet.</p>
    ) : (
      <div className="space-y-3">
        {accepted.map((attendee) => (
          <div
            key={attendee.user_id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-black/30 p-3"
          >
            <div className="flex items-center gap-3">
              {attendee.avatar_url ? (
                <img
                  src={attendee.avatar_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#9146ff] font-black">
                  {(attendee.username || "U").slice(0, 1).toUpperCase()}
                </div>
              )}

              <div>
                <p className="font-black">
                  {attendee.username || "Unknown User"}
                </p>
                <p className="text-xs text-zinc-500">
                  stream: {attendee.stream_status || "off"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  updateAttendee(attendee.user_id, {
                    can_stream: true,
                  })
                }
                className="rounded-md bg-[#9146ff] px-3 py-2 text-xs font-black hover:bg-[#7b31e8]"
              >
                Approve Stream
              </button>

              <button
                onClick={() =>
                  updateAttendee(attendee.user_id, {
                    can_stream: false,
                    stream_status: "off",
                  })
                }
                className="rounded-md bg-zinc-700 px-3 py-2 text-xs font-black hover:bg-zinc-600"
              >
                Stop Stream
              </button>

              <button
                onClick={() => kickUser(attendee.user_id)}
                className="rounded-md border border-red-500/40 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/10"
              >
                Kick
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
</section>
  );
}