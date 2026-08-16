"use client";
import Link from "next/link";
import React from "react";
import { LiveRoom, HostProfile, getRoomTitle, getRoomDescription, getActivity, getHostInitial, getCategory, getScheduledText } from "@/lib/homeHelpers";

export default function LiveRoomCard({ room, host }: { room: LiveRoom; host?: HostProfile }) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#12051e] transition hover:-translate-y-0.5 hover:border-purple-300/50">
      <div
        className="relative aspect-video bg-cover bg-center"
        style={{
          backgroundImage: room.cover_image
            ? `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.35)), url(${room.cover_image})`
            : "linear-gradient(135deg,rgba(145,70,255,0.52),rgba(16,2,28,0.95))",
        }}
      >
        <span className="absolute left-3 top-3 rounded-sm bg-red-600 px-2 py-1 text-xs font-black uppercase">Live</span>
        <span className="absolute bottom-3 right-3 rounded-sm bg-black/75 px-2 py-1 text-xs font-bold">{getActivity(room)} active</span>
      </div>

      <div className="p-4">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#9146ff] text-sm font-black">{getHostInitial(host)}</div>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black">{getRoomTitle(room)}</h3>
            <p className="mt-1 truncate text-sm text-zinc-400">{getHostInitial(host) ? getHostInitial(host) : "Host"}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-300">{getRoomDescription(room)}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-sm bg-purple-500/15 px-2 py-1 text-xs font-bold text-purple-200">{getCategory(room)}</span>

            {room.status === "scheduled" && getScheduledText(room) && (
              <span className="rounded-sm bg-blue-500/15 px-2 py-1 text-xs font-bold text-blue-200">Starts {getScheduledText(room)}</span>
            )}
          </div>

          <Link href={`/room/${room.id}`} className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8]">Join Room</Link>
        </div>
      </div>
    </article>
  );
}
