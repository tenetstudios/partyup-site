import Link from "next/link";
import React from "react";

export default function HeroActions() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-10">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="rounded-lg p-8" style={{ background: 'radial-gradient(circle at 10% 10%, rgba(145,70,255,0.12), transparent 20%), linear-gradient(180deg, rgba(10,4,18,0.6), rgba(6,3,12,0.6))' }}>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-100">Live rooms</p>
          <h1 className="mt-4 text-5xl font-black leading-tight">Live rooms. <span className="text-[#bf94ff]">Real people.</span></h1>
          <p className="mt-3 max-w-2xl text-lg leading-7 text-zinc-200">Discover what's happening around you. Or meet someone new.</p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-white/8 bg-gradient-to-b from-[#1b0730]/60 to-[#0f0614]/60 p-6">
              <h3 className="text-lg font-black">Explore Rooms</h3>
              <p className="mt-2 text-sm text-zinc-300">See what's live around you and join the vibe.</p>
              <div className="mt-4">
                <Link href="/map" className="inline-block rounded-md bg-[#9146ff] px-5 py-2 font-black hover:bg-[#7b31e8]">Explore Map</Link>
              </div>
            </div>

            <div className="rounded-lg border border-white/8 bg-gradient-to-b from-[#3b0b2e]/50 to-[#12051e]/60 p-6 ring-1 ring-pink-500/20">
              <h3 className="text-lg font-black text-pink-300">Match</h3>
              <p className="mt-2 text-sm text-zinc-300">Meet someone new for a 1-on-1 video chat.</p>
              <div className="mt-4">
                <Link href="/match" className="inline-block rounded-md bg-pink-500 px-5 py-2 font-black text-white hover:bg-pink-600">Start Matching</Link>
              </div>
            </div>
          </div>
        </div>

        {/* Right column intentionally left to be replaced by Activity Feed in page layout */}
        <div className="hidden lg:block" />
      </div>
    </section>
  );
}
