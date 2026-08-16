"use client";
import React from "react";

export default function MatchDisconnected({ onRematch }: { onRematch?: () => void }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl bg-gradient-to-br from-[#0b0410]/80 via-[#12051e]/60 to-[#0b0410]/80 p-8 text-center">
        <h2 className="text-2xl font-extrabold">Connection ended</h2>
        <p className="mt-3 text-sm text-zinc-300">The call has ended. You can match again or return to PartyUp.</p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <button onClick={onRematch} className="rounded-full bg-pink-500 px-5 py-2 font-black text-white">Match Again</button>
          <a href="/" className="text-sm font-bold text-zinc-300 hover:underline">Return Home</a>
        </div>
      </div>
    </div>
  );
}
