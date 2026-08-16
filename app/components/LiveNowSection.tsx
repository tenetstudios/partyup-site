import React from "react";
import LiveRoomCard from "@/app/components/LiveRoomCard";
import { LiveRoom, HostProfile } from "@/lib/homeHelpers";

export default function LiveNowSection({ rooms, profilesById }: { rooms: LiveRoom[]; profilesById: Map<string, HostProfile> }) {
  const liveRooms = rooms.filter((r) => r.status === "live");

  return (
    <section id="live-now" className="mx-auto max-w-7xl px-0 py-6">
      <div className="mb-4 flex items-end justify-between gap-4 px-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">Live Now</p>
          <h2 className="mt-2 text-2xl font-black md:text-3xl">Discover active rooms</h2>
        </div>
        <p className="text-sm font-semibold text-zinc-400">{liveRooms.length} room{liveRooms.length === 1 ? "" : "s"}</p>
      </div>

      {liveRooms.length > 0 ? (
        <div className="grid gap-4 px-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {liveRooms.map((room) => {
            const host = room.host_id != null ? profilesById.get(String(room.host_id)) : undefined;
            return <LiveRoomCard key={String(room.id)} room={room} host={host} />;
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-purple-300/30 bg-[#12051e] px-6 py-14 text-center mx-5">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">No Live Rooms</p>
          <h2 className="mt-3 text-3xl font-black">Nothing is live right now.</h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-zinc-400">Check back soon. PartyUp rooms will appear here the moment hosts go live.</p>
        </div>
      )}
    </section>
  );
}
