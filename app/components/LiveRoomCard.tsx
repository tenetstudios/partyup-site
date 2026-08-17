"use client";
import Link from "next/link";
import React from "react";
import { LiveRoom, HostProfile, getRoomTitle, getActivity, getCategory } from "@/lib/homeHelpers";

function getLocation(room: LiveRoom) {
  return (
    (room.location as string | undefined) ??
    (room.city as string | undefined) ??
    (room.place as string | undefined) ??
    (room.region as string | undefined) ??
    null
  );
}

export default function LiveRoomCard({ room }: { room: LiveRoom; host?: HostProfile }) {
  const location = getLocation(room);
  const activity = getActivity(room);
  const secondaryTag =
    typeof room.mode === "string" && room.mode.trim()
      ? room.mode
      : typeof room.room_mode === "string" && room.room_mode.trim()
        ? room.room_mode
        : null;

  return (
    <article className="relative h-[237px] overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#10101a] shadow-[0_14px_36px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:border-purple-300/40">
      <div
        className="relative h-[146px] bg-cover bg-center"
        style={{
          backgroundImage: room.cover_image
            ? `linear-gradient(rgba(0,0,0,0.18), rgba(0,0,0,0.5)), url(${room.cover_image})`
            : "radial-gradient(circle at 34% 22%,rgba(255,45,154,0.62),transparent 16%),radial-gradient(circle at 68% 14%,rgba(139,61,255,0.72),transparent 24%),linear-gradient(135deg,rgba(32,8,54,0.95),rgba(8,7,15,0.95))",
        }}
      >
        <span className="absolute left-2 top-3 rounded-[4px] bg-[#ff161f] px-2 py-1 text-[11px] font-black uppercase leading-none">LIVE</span>
        <span className="absolute right-2 top-3 flex items-center gap-1 rounded-full bg-black/75 px-2 py-1 text-[11px] font-bold leading-none">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M10 4C5 4 2.2 8.1 2 10c.2 1.9 3 6 8 6s7.8-4.1 8-6c-.2-1.9-3-6-8-6Zm0 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" /></svg>
          {activity}
        </span>
      </div>

      <div className="p-3 pt-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-black leading-5 text-white">{getRoomTitle(room)}</h3>
          <p className="mt-1 truncate text-[13px] leading-4 text-[#aaa4b8]">{location ?? "Online"}</p>
        </div>

        <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
          <span className="max-w-[78px] truncate rounded-[5px] bg-purple-500/20 px-2 py-1 text-[12px] font-bold leading-none text-[#d6b8ff]">{getCategory(room)}</span>
          {secondaryTag && (
            <span className="max-w-[78px] truncate rounded-[5px] bg-white/10 px-2 py-1 text-[12px] font-bold capitalize leading-none text-[#c9c2d7]">{secondaryTag.replace("_", " ")}</span>
          )}
        </div>
      </div>
      <Link href={`/room/${room.id}`} className="absolute inset-0">
        <span className="sr-only">Open {getRoomTitle(room)}</span>
      </Link>
    </article>
  );
}
