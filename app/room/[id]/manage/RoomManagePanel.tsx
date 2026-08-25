"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type Attendee = {
  event_room_id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  status: string | null;
  can_stream: boolean | null;
};

type StreamQueueEntry = {
  id: string;
  room_id: string;
  user_id: string;
  status: "waiting" | "live" | "ended" | "removed";
  priority: number;
  approved_at: string;
  started_at: string | null;
};

function displayName(attendee?: Attendee) {
  return attendee?.username || "Unknown user";
}

function Avatar({ attendee }: { attendee?: Attendee }) {
  if (attendee?.avatar_url) {
    // User profile images can come from Supabase Storage or an external identity provider.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={attendee.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }

  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#9146ff] font-black">
      {displayName(attendee).slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function RoomManagePanel({ roomId }: { roomId: string }) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [streamQueue, setStreamQueue] = useState<StreamQueueEntry[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadRoomData = useCallback(async () => {
    const supabase = createSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setIsHost(false);
      setLoading(false);
      return;
    }

    const { data: room } = await supabase
      .from("event_rooms")
      .select("host_id")
      .eq("id", roomId)
      .single();

    const host = room?.host_id === user.id;
    setIsHost(host);
    if (!host) {
      setLoading(false);
      return;
    }

    const [{ data: attendeeData, error: attendeeError }, { data: queueData, error: queueError }] =
      await Promise.all([
        supabase
          .from("event_attendees")
          .select("event_room_id,user_id,username,avatar_url,status,can_stream")
          .eq("event_room_id", roomId)
          .order("username", { ascending: true }),
        supabase
          .from("room_stream_queue")
          .select("id,room_id,user_id,status,priority,approved_at,started_at")
          .eq("room_id", roomId)
          .in("status", ["waiting", "live"])
          .order("priority", { ascending: true }),
      ]);

    if (attendeeError || queueError) {
      setError(attendeeError?.message || queueError?.message || "Could not load the stream queue.");
    } else {
      setError("");
    }

    setAttendees((attendeeData ?? []) as Attendee[]);
    setStreamQueue((queueData ?? []) as StreamQueueEntry[]);
    setLoading(false);
  }, [roomId]);

  useEffect(() => {
    queueMicrotask(() => void loadRoomData());
    const supabase = createSupabaseClient();
    const refresh = () => void loadRoomData();
    const channel = supabase
      .channel(`manage-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_attendees", filter: `event_room_id=eq.${roomId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_stream_queue", filter: `room_id=eq.${roomId}` },
        refresh,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadRoomData, roomId]);

  async function runQueueAction(
    userId: string,
    action: () => PromiseLike<{ error: { message: string } | null }>,
  ) {
    if (busyUserId) return;
    setBusyUserId(userId);
    setError("");
    const { error: actionError } = await action();
    if (actionError) setError(actionError.message);
    await loadRoomData();
    setBusyUserId(null);
  }

  function approveStream(userId: string) {
    const supabase = createSupabaseClient();
    return runQueueAction(userId, () =>
      supabase.rpc("approve_room_stream", { p_room_id: roomId, p_user_id: userId }),
    );
  }

  function startStream(userId: string) {
    const supabase = createSupabaseClient();
    return runQueueAction(userId, () =>
      supabase.rpc("start_room_stream", { p_room_id: roomId, p_user_id: userId }),
    );
  }

  function endStream(userId: string) {
    if (!window.confirm("End this broadcast and return the main feed to standby?")) return;
    const supabase = createSupabaseClient();
    return runQueueAction(userId, () =>
      supabase.rpc("end_room_stream", { p_room_id: roomId, p_user_id: userId }),
    );
  }

  function removeFromQueue(userId: string) {
    const supabase = createSupabaseClient();
    return runQueueAction(userId, () =>
      supabase.rpc("remove_room_stream_queue_entry", { p_room_id: roomId, p_user_id: userId }),
    );
  }

  function moveInQueue(userId: string, direction: "up" | "down") {
    const supabase = createSupabaseClient();
    return runQueueAction(userId, () =>
      supabase.rpc("move_room_stream_queue_entry", {
        p_direction: direction,
        p_room_id: roomId,
        p_user_id: userId,
      }),
    );
  }

  async function approveMember(userId: string) {
    const supabase = createSupabaseClient();
    await runQueueAction(userId, () =>
      supabase
        .from("event_attendees")
        .update({ status: "accepted" })
        .eq("event_room_id", roomId)
        .eq("user_id", userId),
    );
  }

  async function kickUser(userId: string) {
    if (!window.confirm("Remove this user from the room?")) return;
    const supabase = createSupabaseClient();
    await runQueueAction(userId, () =>
      supabase.from("event_attendees").delete().eq("event_room_id", roomId).eq("user_id", userId),
    );
  }

  if (loading) {
    return <section className="mt-8 rounded-xl border border-white/10 bg-[#12051e] p-5 text-sm text-zinc-400">Loading queue…</section>;
  }

  if (!isHost) {
    return (
      <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
        Only the room host can manage this room.
      </div>
    );
  }

  const memberRequests = attendees.filter((attendee) =>
    ["pending", "waiting", "requested", "queued"].includes(attendee.status || ""),
  );
  const accepted = attendees.filter((attendee) => attendee.status === "accepted");
  const attendeeByUserId = new Map(attendees.map((attendee) => [attendee.user_id, attendee]));
  const currentStream = streamQueue.find((entry) => entry.status === "live");
  const waiting = streamQueue
    .filter((entry) => entry.status === "waiting")
    .sort((left, right) => left.priority - right.priority);
  const queuedUserIds = new Set(streamQueue.map((entry) => entry.user_id));

  return (
    <section id="people-queue" className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Queue & Members</h2>
        <p className="mt-1 text-sm text-zinc-500">You decide who gets the main feed and who goes next.</p>
      </div>

      {error && <div role="alert" className="border-b border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</div>}

      <div className="divide-y divide-white/10">
        <div className="p-4">
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-pink-300">Current stream</h3>
          {currentStream ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-pink-400/25 bg-pink-500/10 p-4">
              <div className="flex items-center gap-3">
                <Avatar attendee={attendeeByUserId.get(currentStream.user_id)} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-pink-400" />
                    <p className="font-black">{displayName(attendeeByUserId.get(currentStream.user_id))}</p>
                  </div>
                  <p className="mt-1 text-xs font-bold text-pink-200/70">Has control of the main feed</p>
                </div>
              </div>
              <button type="button" disabled={Boolean(busyUserId)} onClick={() => endStream(currentStream.user_id)} className="rounded-md bg-red-600 px-4 py-2 text-xs font-black hover:bg-red-500 disabled:opacity-50">
                {busyUserId === currentStream.user_id ? "Ending…" : "End broadcast"}
              </button>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-sm text-zinc-500">The main feed is on standby. Start someone from the waiting list when ready.</div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-purple-300">Waiting to stream</h3>
            <span className="rounded-full bg-purple-500/15 px-3 py-1 text-xs font-black text-purple-200">{waiting.length} waiting</span>
          </div>
          {waiting.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">Approve a member&apos;s stream to add them here.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {waiting.map((entry, index) => {
                const attendee = attendeeByUserId.get(entry.user_id);
                return (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-black/30 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-black text-purple-200">{index + 1}</span>
                      <Avatar attendee={attendee} />
                      <div className="min-w-0">
                        <p className="truncate font-black">{displayName(attendee)}</p>
                        <p className="text-xs text-zinc-500">Approved and waiting</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={index === 0 || Boolean(busyUserId)} onClick={() => moveInQueue(entry.user_id, "up")} aria-label={`Move ${displayName(attendee)} up`} className="rounded-md border border-white/15 px-3 py-2 text-xs font-black disabled:opacity-30">↑</button>
                      <button type="button" disabled={index === waiting.length - 1 || Boolean(busyUserId)} onClick={() => moveInQueue(entry.user_id, "down")} aria-label={`Move ${displayName(attendee)} down`} className="rounded-md border border-white/15 px-3 py-2 text-xs font-black disabled:opacity-30">↓</button>
                      <button type="button" disabled={Boolean(busyUserId)} onClick={() => startStream(entry.user_id)} className="rounded-md bg-green-600 px-3 py-2 text-xs font-black hover:bg-green-500 disabled:opacity-50">{busyUserId === entry.user_id ? "Starting…" : "Start broadcast"}</button>
                      <button type="button" disabled={Boolean(busyUserId)} onClick={() => removeFromQueue(entry.user_id)} className="rounded-md bg-zinc-700 px-3 py-2 text-xs font-black hover:bg-zinc-600 disabled:opacity-50">Remove</button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="p-4">
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-purple-300">Entry requests</h3>
          {memberRequests.length === 0 ? <p className="mt-3 text-sm text-zinc-500">No one is waiting for room access.</p> : (
            <div className="mt-3 space-y-3">{memberRequests.map((attendee) => (
              <div key={attendee.user_id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-black/30 p-3">
                <div className="flex items-center gap-3"><Avatar attendee={attendee} /><div><p className="font-black">{displayName(attendee)}</p><p className="text-xs text-zinc-500">Room access requested</p></div></div>
                <div className="flex gap-2">
                  <button type="button" disabled={Boolean(busyUserId)} onClick={() => approveMember(attendee.user_id)} className="rounded-md bg-green-600 px-3 py-2 text-xs font-black hover:bg-green-500 disabled:opacity-50">Approve</button>
                  <button type="button" disabled={Boolean(busyUserId)} onClick={() => kickUser(attendee.user_id)} className="rounded-md border border-red-500/40 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/10 disabled:opacity-50">Reject</button>
                </div>
              </div>
            ))}</div>
          )}
        </div>

        <div className="p-4">
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-purple-300">Accepted members</h3>
          {accepted.length === 0 ? <p className="mt-3 text-sm text-zinc-500">No accepted members yet.</p> : (
            <div className="mt-3 space-y-3">{accepted.map((attendee) => {
              const inQueue = queuedUserIds.has(attendee.user_id);
              return (
                <div key={attendee.user_id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-black/30 p-3">
                  <div className="flex items-center gap-3"><Avatar attendee={attendee} /><div><p className="font-black">{displayName(attendee)}</p><p className="text-xs text-zinc-500">{currentStream?.user_id === attendee.user_id ? "Current broadcaster" : inQueue ? "Waiting to stream" : "Member"}</p></div></div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={inQueue || Boolean(busyUserId)} onClick={() => approveStream(attendee.user_id)} className="rounded-md bg-[#9146ff] px-3 py-2 text-xs font-black hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:bg-purple-950 disabled:text-purple-300">{inQueue ? "In stream queue" : busyUserId === attendee.user_id ? "Approving…" : "Approve stream"}</button>
                    <button type="button" disabled={Boolean(busyUserId)} onClick={() => kickUser(attendee.user_id)} className="rounded-md border border-red-500/40 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/10 disabled:opacity-50">Kick</button>
                  </div>
                </div>
              );
            })}</div>
          )}
        </div>
      </div>
    </section>
  );
}
