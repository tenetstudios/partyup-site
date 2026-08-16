"use client";
import Link from "next/link";
import React from "react";
import { LiveRoom, HostProfile, getRoomTitle, getRoomDescription, getActivity, getHostInitial, getCategory, getScheduledText, getHostName } from "@/lib/homeHelpers";

function getLocation(room: LiveRoom) {
  return (
    (room.location as string | undefined) ??
    (room.city as string | undefined) ??
    (room.place as string | undefined) ??
    (room.region as string | undefined) ??
    null
  );
}

export default function LiveRoomCard({ room, host }: { room: LiveRoom; host?: HostProfile }) {
  const location = getLocation(room);

  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#12051e] transition hover:-translate-y-0.5 hover:border-purple-300/50">
      <div
        className="relative aspect-video bg-cover bg-center"
        style={{
          backgroundImage: room.cover_image
            ? `linear-gradient(rgba(0,0,0,0.18), rgba(0,0,0,0.5)), url(${room.cover_image})`
            : "linear-gradient(135deg,rgba(145,70,255,0.52),rgba(16,2,28,0.95))",
        }}
      >
        <span className="absolute left-3 top-3 rounded-sm bg-red-600 px-2 py-1 text-xs font-black uppercase">LIVE</span>
        <span className="absolute right-3 top-3 rounded-sm bg-black/75 px-2 py-1 text-xs font-bold">{getActivity(room)}</span>
      </div>

      <div className="p-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-extrabold">{getRoomTitle(room)}</h3>
          {location && <p className="mt-1 text-sm text-zinc-400">{location}</p>}
        </div>

        <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-300">{getRoomDescription(room)}</p>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-sm bg-purple-500/15 px-2 py-1 text-xs font-bold text-purple-200">{getCategory(room)}</span>
            {room.status === "scheduled" && getScheduledText(room) && (
              <span className="rounded-sm bg-blue-500/15 px-2 py-1 text-xs font-bold text-blue-200">Starts {getScheduledText(room)}</span>
            )}
          </div>

          <Link href={`/room/${room.id}`} className="rounded-md bg-[#9146ff] px-3 py-1 text-sm font-black hover:bg-[#7b31e8]">Join</Link>
        </div>
      </div>
    </article>
  );
}
