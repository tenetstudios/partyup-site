import Link from "next/link";
import RoomManagePanel from "./RoomManagePanel";
import DeleteRoomButton from "../DeleteRoomButton";
import { createSupabaseClient } from "@/lib/supabase";
import ObsStreamPanel from "./ObsStreamPanel";
import RoomAnnouncementManager from "./RoomAnnouncementManager";
import RoomDetailsEditor from "./RoomDetailsEditor";

export default async function ManageRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = createSupabaseClient();

const { data: room } = await supabase
  .from("event_rooms")
  .select("host_id")
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
          href={`/room/${id}`}
          className="mb-6 inline-flex rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black"
        >
          Back to room
        </Link>

        <h1 className="text-4xl font-black">Manage Room</h1>
        <p className="mt-2 text-zinc-400">
          Approve streamers, remove users, and manage the room queue.
        </p>
        
        <RoomDetailsEditor roomId={id} />
        <RoomAnnouncementManager roomId={id} />
        <RoomManagePanel roomId={id} />
        <ObsStreamPanel roomId={id} />
        <div className="mt-8">
  <DeleteRoomButton roomId={id} hostId={room.host_id} />
</div>
      </div>
    </main>
  );
}
