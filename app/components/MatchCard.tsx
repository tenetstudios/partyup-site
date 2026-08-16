import Link from "next/link";
import React from "react";

export default function MatchCard() {
  return (
    <div className="rounded-lg border border-white/10 bg-gradient-to-br from-pink-500/10 via-purple-700/10 to-[#12051e] p-6">
      <h3 className="text-xl font-black">Match</h3>
      <p className="mt-2 text-sm text-zinc-300">Meet someone new in seconds.</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-zinc-400">Online: —</div>
        <Link href="/match" className="rounded-md bg-pink-500 px-4 py-2 font-black text-white">Start Matching</Link>
      </div>
    </div>
  );
}
