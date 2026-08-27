import Link from "next/link";
import RoomManagePanel from "./RoomManagePanel";
import DeleteRoomButton from "../DeleteRoomButton";
import { createSupabaseClient } from "@/lib/supabase";
import ObsStreamPanel from "./ObsStreamPanel";
import RoomAnnouncementManager from "./RoomAnnouncementManager";
import RoomMissionManager from "./RoomMissionManager";
import RoomDetailsEditor from "./RoomDetailsEditor";
import RoomEntryLinkPanel from "./RoomEntryLinkPanel";
import HostDashboardOverview from "./HostDashboardOverview";
import AfterEventMessageManager from "./AfterEventMessageManager";
import ChatModerationManager from "./ChatModerationManager";
import ChatReportInbox from "./ChatReportInbox";
import ClearRoomPanel from "./ClearRoomPanel";
import RoomIdleLoopManager from "./RoomIdleLoopManager";
import RoomSettingsAccordion from "./RoomSettingsAccordion";
import WildHostManager from "./WildHostManager";
import LiveNodesManager from "./LiveNodesManager";

export default async function ManageRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = createSupabaseClient();

  const { data: room } = await supabase
    .from("event_rooms")
    .select("host_id,status")
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

        <h1 className="text-4xl font-black">Room Settings</h1>
        <p className="mt-2 text-zinc-400">
          Host dashboard, room tools, and live operations for this event.
        </p>

        {room.status === "ended" && (
          <div className="mt-8 rounded-lg border border-emerald-300/20 bg-emerald-950/20 p-5 text-sm font-bold text-emerald-100">
            This event has ended. Its history and Memories are retained.
          </div>
        )}
        
        <HostDashboardOverview roomId={id} roomEnded={room.status === "ended"} />

        <RoomSettingsAccordion
          roomBroadcast={(
            <>
              {room.status !== "ended" ? (
                <>
                  <RoomManagePanel roomId={id} />
                  <RoomDetailsEditor roomId={id} />
                  <RoomEntryLinkPanel roomId={id} />
                  <RoomIdleLoopManager roomId={id} />
                  <ObsStreamPanel roomId={id} />
                </>
              ) : (
                <RoomIdleLoopManager roomId={id} presentation="event-replay" />
              )}
            </>
          )}
          engagement={(
            <>
              {room.status !== "ended" && <RoomAnnouncementManager roomId={id} />}
              <WildHostManager roomId={id} roomEnded={room.status === "ended"} />
              <LiveNodesManager roomId={id} roomEnded={room.status === "ended"} />
              <RoomMissionManager roomId={id} roomEnded={room.status === "ended"} />
            </>
          )}
          safety={(
            <>
              {room.status !== "ended" && <ChatModerationManager roomId={id} />}
              <ChatReportInbox roomId={id} />
              {room.status !== "ended" && <ClearRoomPanel roomId={id} hostId={room.host_id} />}
            </>
          )}
          lifecycle={(
            <>
              <AfterEventMessageManager roomId={id} roomEnded={room.status === "ended"} />
              <section className="mt-10 border-t border-red-400/20 p-5">
                <h2 className="text-lg font-black text-red-200">Exceptional deletion</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Delete only accidental or test rooms that should leave no PartyUp history. Completed events should be ended instead.
                </p>
                <DeleteRoomButton roomId={id} hostId={room.host_id} />
              </section>
            </>
          )}
        />
      </div>
    </main>
  );
}
