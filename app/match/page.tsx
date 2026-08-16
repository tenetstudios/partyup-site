import React from "react";
import HomeHeader from "@/app/components/HomeHeader";
import MatchScreen from "@/app/match/MatchScreen";

export default function MatchPage() {
  return (
    <main className="min-h-screen bg-[#07000f] text-white">
      <HomeHeader liveCount={0} />

      <section className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">Match</p>
          <h1 className="mt-2 text-3xl font-black">PartyUp Match</h1>
        </div>

        <MatchScreen />
      </section>
    </main>
  );
}
