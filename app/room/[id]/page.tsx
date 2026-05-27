import Link from "next/link";
import { createSupabaseClient } from "@/lib/supabase";
import JoinRoomButton from "./JoinRoomButton";
import DeleteRoomButton from "./DeleteRoomButton";
import WebLiveKitRoom from "./WebLiveKitRoom";
import RoomChat from "./RoomChat";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = createSupabaseClient();

  const { data: room } = await supabase
    .from("event_rooms")
    .select("*")
    .eq("id", id)
    .single();

  if (!room) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07000f] text-white">
        <h1 className="text-3xl font-black">Room not found</h1>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07000f] text-white">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <Link
          href="/"
          className="mb-6 inline-flex rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black"
        >
          Back
        </Link>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#12051e]">
          <div className="h-[520px] bg-black md:h-[620px]">
  <WebLiveKitRoom roomId={id} />
</div>

          <div className="p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded bg-red-600 px-2 py-1 text-xs font-black">
                LIVE
              </span>

              <span className="text-sm text-zinc-400">
                {room.current_users ?? 0} users
              </span>
            </div>

            <h1 className="text-4xl font-black">{room.title}</h1>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-lg bg-black/30 p-4">
                <div className="text-sm text-zinc-500">Type</div>
                <div className="mt-1 font-black">{room.type}</div>
              </div>

              <div className="rounded-lg bg-black/30 p-4">
                <div className="text-sm text-zinc-500">Mode</div>
                <div className="mt-1 font-black">{room.mode}</div>
              </div>

              <div className="rounded-lg bg-black/30 p-4">
                <div className="text-sm text-zinc-500">Status</div>
                <div className="mt-1 font-black">{room.status}</div>
              </div>
            </div>
            
            <JoinRoomButton roomId={id} />
            <DeleteRoomButton roomId={id} hostId={room.host_id} />
            <RoomChat roomId={id} />
          </div>
        </div>
      </div>
    </main>
  );
}