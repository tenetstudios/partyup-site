"use client";
import React from "react";

export default function VideoPanel({ label, small }: { label?: string; small?: boolean }) {
  return (
    <div className={"rounded-lg overflow-hidden " + (small ? "h-28 w-40" : "w-full aspect-video") } style={{ background: 'linear-gradient(180deg, rgba(10,4,18,0.8), rgba(6,3,12,0.9))', boxShadow: 'inset 0 0 50px rgba(145,70,255,0.06)'}}>
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-bold text-zinc-400">{label ?? 'Video'}</div>
        </div>
      </div>
    </div>
  );
}
