import Link from "next/link";
import React from "react";

export default function MatchCard() {
  return (
    <div className="rounded-lg border border-white/10 bg-gradient-to-br from-pink-600/6 to-[#12051e] p-6 shadow-[0_8px_30px_rgba(219,39,119,0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-pink-300">Match</h3>
          <p className="mt-2 text-sm text-zinc-300">Meet someone new in seconds.</p>
          <div className="mt-4 text-sm text-zinc-400">Online: —</div>
        </div>
        <div className="flex items-center">
          <Link href="/match" className="rounded-md bg-pink-500 px-4 py-2 font-black text-white hover:bg-pink-600">Start Matching</Link>
        </div>
      </div>
    </div>
  );
}
