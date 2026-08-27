"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatMemoryTimestamp,
  getMemoryPublicUrl,
  getRoomMemories,
  type RoomMemory,
} from "@/lib/memories";
import { getRoomIdleMedia, type RoomIdleMedia } from "@/lib/roomIdleMedia";
import { createSupabaseClient } from "@/lib/supabase";
import RoomIdleLoopManager from "./manage/RoomIdleLoopManager";

function ReplayViewer({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [media, setMedia] = useState<RoomIdleMedia | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setMedia(await getRoomIdleMedia(supabase, roomId).catch(() => null));
    setLoading(false);
  }, [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const channel = supabase
      .channel(`ended-room-replay-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_idle_media", filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  const replay = media?.enabled ? media : null;

  return (
    <section className="relative aspect-video min-h-[280px] overflow-hidden rounded-[12px] border border-purple-300/25 bg-black shadow-[0_24px_70px_rgba(0,0,0,0.38)] md:min-h-[420px]">
      {replay ? (
        <>
          {replay.media_type === "video" ? (
            <video src={replay.signed_url} autoPlay loop muted playsInline controls className="h-full w-full object-cover" />
          ) : (
            // A normal img preserves GIF animation without sending signed media through the optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={replay.signed_url} alt="Event Replay" className="h-full w-full object-cover" />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/25" />
          <span className="pointer-events-none absolute left-4 top-4 rounded-md border border-white/20 bg-black/70 px-3 py-2 text-xs font-black tracking-[0.12em] text-white backdrop-blur">
            EVENT ENDED · REPLAY
          </span>
        </>
      ) : (
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-zinc-400">
              <svg viewBox="0 0 32 32" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="8" width="22" height="15" rx="3" />
                <path d="m12 13 9 5-9 5Z" />
                <path d="m6 27 20-22" />
              </svg>
            </span>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Broadcast offline</p>
            <h2 className="mt-2 text-3xl font-black text-white">Livestream ended</h2>
            <p className="mt-3 text-sm font-bold text-zinc-500">
              {loading ? "Checking for an Event Replay..." : "This event is no longer broadcasting."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function EndedRoomArchive({ roomId, hostId }: { roomId: string; hostId: string | null }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [isHost, setIsHost] = useState(false);
  const [hostMessage, setHostMessage] = useState<string | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const loadArchive = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    setIsHost(Boolean(user && hostId && user.id === hostId));

    if (!user) {
      setLoading(false);
      return;
    }

    const [messageResult, memoryResult] = await Promise.all([
      supabase.from("room_recap_messages").select("message").eq("room_id", roomId).maybeSingle(),
      getRoomMemories(supabase, roomId).catch(() => []),
    ]);

    setHostMessage(messageResult.data?.message?.trim() || null);
    setMemories(memoryResult.slice(0, 6));
    setLoading(false);
  }, [hostId, roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void loadArchive());
    const channel = supabase
      .channel(`ended-room-archive-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_recap_messages", filter: `room_id=eq.${roomId}` },
        () => void loadArchive(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_memories", filter: `room_id=eq.${roomId}` },
        () => void loadArchive(),
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadArchive, roomId, supabase]);

  return (
    <div className="grid gap-6">
      {isHost ? <RoomIdleLoopManager roomId={roomId} presentation="event-replay" /> : <ReplayViewer roomId={roomId} />}

      <section className="rounded-xl border border-pink-300/20 bg-[linear-gradient(135deg,rgba(90,26,74,.32),rgba(18,11,26,.96))] p-6 md:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ff83b8]">A message from the host</p>
        <p className="mt-3 max-w-3xl text-xl font-bold leading-8 text-white">
          {loading ? "Opening the event archive..." : hostMessage || "Thanks for joining. This event has ended."}
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#b587ff]">From the event</p>
            <h2 className="mt-2 text-3xl font-black">Memories</h2>
          </div>
          <Link href={`/room/${roomId}/memories`} className="rounded-md border border-pink-300/30 bg-pink-500/10 px-4 py-2.5 text-sm font-black text-pink-100 hover:bg-pink-500/20">
            View all Memories
          </Link>
        </div>

        {memories.length > 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            {memories.map((memory) => {
              const url = getMemoryPublicUrl(supabase, memory.media_path);
              return (
                <article key={memory.id} className="overflow-hidden rounded-lg border border-white/10 bg-black/25">
                  <div className="aspect-square bg-black">
                    {memory.media_type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <video src={url} controls preload="metadata" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-black">{memory.uploader_name || "Guest"}</p>
                    <p className="mt-1 truncate text-xs font-bold text-zinc-500">{formatMemoryTimestamp(memory.created_at)}</p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-white/10 px-5 py-8 text-center text-sm font-bold text-zinc-500">
            {loading ? "Loading Memories..." : "No Memories were posted before this event ended."}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-purple-300/20 bg-[#120b1a] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">Keep the night</p>
          <h2 className="mt-2 text-2xl font-black">The event lives on here.</h2>
          <p className="mt-2 text-sm font-bold text-zinc-400">Browse every Memory or revisit your personalized event recap.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/room/${roomId}/memories`} className="rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black hover:bg-[#7b31e8]">View Memories</Link>
          <Link href={`/recap/${roomId}`} className="rounded-md border border-white/15 px-5 py-3 text-sm font-black hover:bg-white/[0.06]">Open Recap</Link>
        </div>
      </section>
    </div>
  );
}
