import React from "react";
import Link from "next/link";
import LiveRoomCard from "@/app/components/LiveRoomCard";
import { LiveRoom, HostProfile } from "@/lib/homeHelpers";
import CreateRoomButton from "@/app/components/CreateRoomButton";

export default function LiveNowSection({ rooms, profilesById }: { rooms: LiveRoom[]; profilesById: Map<string, HostProfile> }) {
  const liveRooms = rooms.filter((r) => r.status === "live");
  const previewRooms = liveRooms.slice(0, 4);

  return (
    <section id="live-now" className="min-w-0 rounded-[10px] border border-white/[0.04] bg-[linear-gradient(180deg,rgba(13,13,23,0.78),rgba(7,7,14,0.78))] p-2 shadow-[0_0_28px_rgba(139,61,255,0.08)]">
      <div className="mb-2 flex items-center justify-between gap-4 px-1">
        <h2 className="text-[20px] font-black leading-none">Live Now</h2>
        <Link href="/live-now" className="text-[15px] font-medium text-[#b45cff] hover:text-white">View all</Link>
      </div>

      {previewRooms.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {previewRooms.map((room) => {
            const host = room.host_id != null ? profilesById.get(String(room.host_id)) : undefined;
            return <LiveRoomCard key={String(room.id)} room={room} host={host} />;
          })}
        </div>
      ) : (
        <div className="grid min-h-[237px] place-items-center rounded-[10px] border border-dashed border-purple-300/20 bg-[#10101a]/70 px-6 text-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#b995ff]">No Live Rooms</p>
            <p className="mx-auto mt-3 max-w-md leading-6 text-[#aaa4b8]">PartyUp rooms will appear here the moment hosts go live.</p>
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end md:hidden">
        <CreateRoomButton
          label="+ Open a Room"
          className="h-9 px-4 text-[13px] shadow-[0_0_16px_rgba(139,61,255,0.25)]"
        />
      </div>
    </section>
  );
}
