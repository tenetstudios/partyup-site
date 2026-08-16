import Link from "next/link";
import React from "react";

export default function HeroActions() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      <div className="grid gap-8 lg:grid-cols-[1.6fr_0.9fr]">
        <div className="rounded-lg border border-white/10 bg-black/40 p-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-100">
            Live rooms
          </p>
          <h1 className="mt-4 text-4xl font-black md:text-5xl">
            Live rooms. Real people.
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-zinc-200">
            Discover what's happening around you. Or meet someone new.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/map" className="rounded-md bg-[#9146ff] px-6 py-3 font-black hover:bg-[#7b31e8]">
              Explore Map
            </Link>
            <Link href="/match" className="rounded-md bg-pink-500 px-6 py-3 font-black hover:bg-pink-600">
              Start Matching
            </Link>
          </div>
        </div>

        <aside className="hidden rounded-lg border border-white/8 bg-[#12051e] p-6 lg:block">
          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-purple-200">Quick Actions</h3>
          <div className="mt-4 space-y-3">
            <Link href="/create" className="block rounded-md bg-[#9146ff] px-4 py-3 font-black text-center">Open a Room</Link>
            <Link href="/map" className="block rounded-md border border-white/10 px-4 py-3 font-black text-center">Explore Rooms</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
