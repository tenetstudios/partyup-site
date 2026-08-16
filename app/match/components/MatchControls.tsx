"use client";
import React from "react";

export default function MatchControls({ onEnd }: { onEnd?: () => void }) {
  return (
    <div className="flex items-center justify-center gap-4 rounded-md bg-black/30 p-3">
      <button className="rounded-md bg-[#9146ff] px-3 py-2 font-black text-sm">Next</button>
      <button className="rounded-md bg-[#1f1a2b] px-3 py-2 font-bold text-sm">Mute</button>
      <button className="rounded-md bg-[#1f1a2b] px-3 py-2 font-bold text-sm">Camera</button>
      <button className="rounded-md bg-[#1f1a2b] px-3 py-2 font-bold text-sm">Follow</button>
      <button onClick={onEnd} className="rounded-md bg-red-600 px-3 py-2 font-bold text-sm">Report</button>
    </div>
  );
}
