"use client";
import React from "react";

export default function MatchIdle({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl bg-gradient-to-br from-[#0b0410]/80 via-[#12051e]/60 to-[#0b0410]/80 p-8">
        <h1 className="text-4xl font-extrabold">Meet someone new.</h1>
        <p className="mt-3 text-lg text-zinc-300">Match connects you with another person for a 1-on-1 conversation.</p>

        <div className="mt-8 flex items-center gap-4">
          <button onClick={onStart} className="rounded-full bg-pink-500 px-6 py-3 font-black text-white hover:bg-pink-600">Start Matching</button>
          <a href="/" className="text-sm font-bold text-zinc-300 hover:underline">Back to PartyUp</a>
        </div>
      </div>
    </div>
  );
}
