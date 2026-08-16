"use client";
import Link from "next/link";
import React from "react";
import AuthButton from "@/app/components/AuthButton";
import CreateRoomButton from "@/app/components/CreateRoomButton";

export default function HomeHeader({ liveCount }: { liveCount: number }) {
  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-[#0c0118]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link href="/" className="text-2xl font-black tracking-tight">
          party<span className="text-[#bf94ff]">up</span>.io
        </Link>

        <div className="hidden items-center gap-7 text-sm font-bold text-zinc-300 md:flex">
          <Link href="/" className="hover:text-white">Home</Link>
          <Link href="/map" className="hover:text-white">Map</Link>
          <Link href="/following" className="hover:text-white">Following</Link>
          <Link href="/activity" className="hover:text-white">Activity</Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs font-black uppercase text-purple-200 sm:flex">
            <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.9)]" />
            {liveCount} live
          </div>

          <AuthButton />

          <CreateRoomButton />
        </div>
      </div>
    </nav>
  );
}
