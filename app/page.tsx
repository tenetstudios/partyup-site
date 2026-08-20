import React from "react";
import { connection } from "next/server";
import HomeHeader from "@/app/components/HomeHeader";
import HomeHero from "@/app/components/HomeHero";
import LiveNowSection from "@/app/components/LiveNowSection";
import MatchCard from "@/app/components/MatchCard";
import ActivityFeed from "@/app/components/ActivityFeed";
import FollowingStrip from "@/app/components/FollowingStrip";
import FeatureStrip from "@/app/components/FeatureStrip";
import HomeFooter from "@/app/components/HomeFooter";
import { getLiveRooms, LiveRoom, HostProfile } from "@/lib/homeHelpers";

export default async function HomePage() {
  await connection();

  let rooms: LiveRoom[] = [];
  let profilesById = new Map<string, HostProfile>();
  let loadError: string | null = null;

  try {
    const liveData = await getLiveRooms();
    rooms = liveData.rooms.sort((a, b) => {
      return (Number(b.active_count ?? 0) - Number(a.active_count ?? 0));
    });
    profilesById = liveData.profilesById;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load live rooms right now.";
  }

  const liveRooms = rooms.filter((r) => r.status === "live");
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05040b] text-white">
      <HomeHeader liveCount={liveRooms.length} />

      <div className="mx-auto grid w-full max-w-[1458px] gap-5 px-5 pb-0 pt-0 lg:grid-cols-[minmax(0,1fr)_413px] xl:px-0">
        <div className="min-w-0">
          <HomeHero />

          <div className="mt-5 grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <LiveNowSection rooms={rooms} profilesById={profilesById} />
            <MatchCard />
          </div>
        </div>

        <aside className="space-y-6 lg:pt-6">
          <ActivityFeed rooms={rooms} profilesById={profilesById} loadError={loadError} />
          <FollowingStrip />
        </aside>
      </div>

      <div className="mx-auto w-full max-w-[1458px] px-5 pt-5 xl:px-0">
        <FeatureStrip />
      </div>

      <HomeFooter />
    </main>
  );
}
