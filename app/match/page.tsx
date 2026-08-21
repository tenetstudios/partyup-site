import React from "react";
import HomeHeader from "@/app/components/HomeHeader";
import MatchScreen from "@/app/match/MatchScreen";

export default async function MatchPage({
  searchParams,
}: {
  searchParams?: Promise<{ pool?: string | string[]; roomId?: string | string[] }>;
}) {
  const params = await searchParams;
  const poolParam = Array.isArray(params?.pool) ? params.pool[0] : params?.pool;
  const roomIdParam = Array.isArray(params?.roomId) ? params.roomId[0] : params?.roomId;

  return (
    <main className="min-h-screen bg-[#07000f] text-white">
      <HomeHeader liveCount={0} />

      <section className="relative mx-auto max-w-5xl overflow-hidden px-4 py-8 sm:px-6 sm:py-12">
        <div className="pointer-events-none absolute inset-x-8 top-20 h-72 bg-[radial-gradient(circle,rgba(236,72,153,0.14),transparent_68%)]" />
        <div className="relative mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">Electric friendship engine</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">PartyUp Match</h1>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            Social radar online
          </div>
        </div>

        <MatchScreen initialPoolId={poolParam ?? null} initialRoomId={roomIdParam ?? null} />
      </section>
    </main>
  );
}
