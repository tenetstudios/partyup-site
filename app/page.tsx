import React from "react";
import { connection } from "next/server";
import HomeHeader from "@/app/components/HomeHeader";
import HeroActions from "@/app/components/HeroActions";
import LiveNowSection from "@/app/components/LiveNowSection";
import MatchCard from "@/app/components/MatchCard";
import ActivityFeed from "@/app/components/ActivityFeed";
import FollowingStrip from "@/app/components/FollowingStrip";
import FeatureStrip from "@/app/components/FeatureStrip";
import { getLiveRooms, LiveRoom, HostProfile } from "@/lib/homeHelpers";

export default async function HomePage() {
  await connection();

  let rooms: LiveRoom[] = [];
  let profilesById = new Map<string, HostProfile>();
  let loadError: string | null = null;

  try {
    const liveData = await getLiveRooms();
    rooms = liveData.rooms.sort((a, b) => {
      return (Number((b as any).active_count ?? 0) - Number((a as any).active_count ?? 0));
    });
    profilesById = liveData.profilesById;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load live rooms right now.";
  }

  const liveRooms = rooms.filter((r) => r.status === "live");
  const scheduledRooms = rooms.filter((r) => r.status === "scheduled");

  return (
    <main className="min-h-screen bg-[#07000f] text-white">
      <HomeHeader liveCount={liveRooms.length} />

      <header className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(145,70,255,0.45),transparent_34%),linear-gradient(135deg,#130024,#07000f_58%)]">
        <HeroActions />
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 lg:grid lg:grid-cols-[1fr_320px] gap-8">
        <div>
          <LiveNowSection rooms={rooms} profilesById={profilesById} />

          <section id="upcoming" className="mt-8">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">Upcoming</p>
                <h2 className="mt-2 text-3xl font-black md:text-4xl">Scheduled rooms</h2>
              </div>
              <p className="text-sm font-semibold text-zinc-400">{scheduledRooms.length} room{scheduledRooms.length === 1 ? "" : "s"}</p>
            </div>

            {scheduledRooms.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {scheduledRooms.map((room) => {
                  const host = room.host_id != null ? profilesById.get(String(room.host_id)) : undefined;

                  return (
                    <article key={String(room.id)} className="overflow-hidden rounded-lg border border-white/10 bg-[#12051e]">
                      <div
                        className="relative aspect-video bg-cover bg-center"
                        style={{
                          backgroundImage: room.cover_image
                            ? `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.35)), url(${room.cover_image})`
                            : "linear-gradient(135deg,rgba(59,130,246,0.42),rgba(16,2,28,0.95))",
                        }}
                      >
                        <span className="absolute left-3 top-3 rounded-sm bg-blue-600 px-2 py-1 text-xs font-black uppercase">Scheduled</span>
                      </div>

                      <div className="p-4">
                        <h3 className="truncate text-lg font-black">{String(room.title ?? room.name ?? "Scheduled Room")}</h3>
                        <p className="mt-2 text-sm text-zinc-400">Hosted by {String((host && (host.display_name ?? host.username)) ?? "Unknown")}</p>

                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="rounded-sm bg-purple-500/15 px-2 py-1 text-xs font-bold text-purple-200">{String(room.category ?? "Scheduled")}</span>
                          <a href={`/room/${room.id}`} className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8]">View</a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-white/10 bg-[#12051e] p-6 text-zinc-400">No scheduled rooms yet.</p>
            )}
          </section>

          <FeatureStrip />
        </div>

        <aside className="space-y-6">
          <MatchCard />
          <ActivityFeed />
          <FollowingStrip />
        </aside>
      </div>
    </main>
  );
}
