import Link from "next/link";
import { createSupabaseClient } from "@/lib/supabase";
import {
  asNumber,
  asText,
  getCategory,
  getRoomDescription,
  getRoomTitle,
  type LiveRoom,
} from "@/lib/homeHelpers";
import { getActiveRoomAnnouncement } from "@/lib/roomAnnouncements";
import EventMatchButton from "./EventMatchButton";
import JoinRoomButton from "./JoinRoomButton";
import LeaveRoomContextButton from "./LeaveRoomContextButton";
import ManageRoomLink from "./ManageRoomLink";
import RoomAnalyticsTracker from "./RoomAnalyticsTracker";
import RoomAnnouncementBanner from "./RoomAnnouncementBanner";
import RoomChat from "./RoomChat";
import RoomStatusWatcher from "./RoomStatusWatcher";
import WebLiveKitRoom from "./WebLiveKitRoom";

type RoomRecord = LiveRoom & {
  host_id?: string | null;
  current_users?: number | string | null;
  mode?: string | null;
  status?: string | null;
  type?: string | null;
};

function labelize(value: string | null) {
  if (!value) return null;

  return value.replace(/_/g, " ");
}

function isVerified(room: RoomRecord) {
  return Boolean(room.verified || room.is_verified || room.verified_at);
}

function RoomStatusBadge({ status }: { status: string | null }) {
  const normalized = status?.toLowerCase() ?? "live";
  const className =
    normalized === "ended"
      ? "bg-zinc-600/70 text-zinc-100"
      : normalized === "scheduled"
        ? "bg-blue-600/35 text-blue-100"
        : "bg-[#ef2f82]/30 text-[#ff6fad]";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${className}`}>
      {normalized}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#7f3dff] text-white">
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M8.7 13.7 5.2 10.2l1.4-1.4 2.1 2.1 4.7-4.7 1.4 1.4-6.1 6.1Z" />
      </svg>
    </span>
  );
}

function RoomHeader({
  room,
  onlineCount,
}: {
  room: RoomRecord;
  onlineCount: number;
}) {
  const mode = labelize(asText(room.mode)) ?? "livestream";
  const ended = asText(room.status)?.toLowerCase() === "ended";

  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-6">
        <Link
          href="/"
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-[8px] bg-[#9146ff] px-5 text-base font-black text-white shadow-[0_12px_34px_rgba(145,70,255,0.24)] hover:bg-[#7b31e8]"
        >
          <span className="text-2xl leading-none">&lt;</span>
          Back
        </Link>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-[30px] font-black leading-none text-white">
              {getRoomTitle(room)}
            </h1>
            {isVerified(room) && <VerifiedBadge />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[15px] font-bold text-white">
            <span className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${ended ? "bg-zinc-500" : "bg-[#19e68c]"}`} />
              {ended ? "Event ended" : `${onlineCount} online now`}
            </span>
            <span className="h-1 w-1 rounded-full bg-white/70" />
            <span className="uppercase">{mode}</span>
          </div>
        </div>
      </div>

      <ManageRoomLink roomId={String(room.id)} hostId={room.host_id ?? ""} />
    </header>
  );
}

function RoomInfoBar({ room }: { room: RoomRecord }) {
  const ended = asText(room.status)?.toLowerCase() === "ended";
  const tags = [
    getCategory(room),
    labelize(asText(room.mode)),
    labelize(asText(room.status)),
  ].filter((tag): tag is string => Boolean(tag));

  return (
    <section className="flex flex-col gap-4 rounded-[10px] border border-white/10 bg-white/[0.04] px-5 py-4 md:flex-row md:items-center">
      <h2 className="shrink-0 text-[18px] font-black text-[#d8d1e2]">Room Info</h2>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag, index) =>
          index === 2 ? (
            <RoomStatusBadge key={`${tag}-${index}`} status={tag} />
          ) : (
            <span
              key={`${tag}-${index}`}
              className="rounded-full bg-[#7f3dff]/20 px-3 py-1 text-xs font-black uppercase text-[#b587ff]"
            >
              {tag}
            </span>
          ),
        )}
        {isVerified(room) && (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black text-[#d8d1e2]">
            <VerifiedBadge />
            Verified
          </span>
        )}
      </div>
      <p className="min-w-[180px] flex-1 text-[15px] leading-6 text-[#d8d1e2]">
        {getRoomDescription(room)}
      </p>
      <Link
        href={`/room/${room.id}/memories`}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-pink-300/30 bg-pink-500/12 px-4 text-sm font-black text-pink-100 hover:bg-pink-500/20"
      >
        Memories
      </Link>
      {!ended && <LeaveRoomContextButton roomId={String(room.id)} />}
      {!ended && <JoinRoomButton roomId={String(room.id)} />}
    </section>
  );
}

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

  const typedRoom = room as RoomRecord;
  const onlineCount = asNumber(typedRoom.current_users) ?? 0;
  const ended = asText(typedRoom.status)?.toLowerCase() === "ended";
  const activeAnnouncement = await getActiveRoomAnnouncement(supabase, id);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-20%,rgba(77,35,132,0.28),transparent_32%),#07000f] text-white">
      {!ended && <RoomAnalyticsTracker roomId={id} eventType="room_entry" />}
      <RoomStatusWatcher roomId={id} />
      <div className="mx-auto flex min-h-screen max-w-[1760px] flex-col gap-8 px-5 py-8 lg:px-7">
        <RoomHeader room={typedRoom} onlineCount={onlineCount} />

        {ended ? (
          <div className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-5">
            <section className="rounded-[10px] border border-purple-300/20 bg-[#120b1a] p-8 text-center">
              <p className="text-xs font-black uppercase text-[#ff83b8]">Past event</p>
              <h2 className="mt-2 text-3xl font-black">This event has ended</h2>
              <p className="mx-auto mt-3 max-w-2xl leading-7 text-[#aaa4b8]">
                The live room is closed. Its Memories, recap, attendance, and Event Series history remain available.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href={`/room/${id}/memories`} className="rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black">View Memories</Link>
                <Link href={`/recap/${id}`} className="rounded-md border border-white/15 px-5 py-3 text-sm font-black">Open Recap</Link>
              </div>
            </section>
            <RoomInfoBar room={typedRoom} />
          </div>
        ) : (
        <div className="grid flex-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)_350px]">
          <div className="order-2 xl:order-1">
            <EventMatchButton roomId={id} />
          </div>

          <div className="order-1 flex min-w-0 flex-col gap-5 xl:order-2">
            <RoomAnnouncementBanner roomId={id} initialAnnouncement={activeAnnouncement} />
            <section className="aspect-video min-h-[360px] overflow-hidden rounded-[12px] border border-[#7f3dff]/45 bg-black shadow-[0_24px_70px_rgba(0,0,0,0.38)]">
              <WebLiveKitRoom roomId={id} />
            </section>
            <RoomInfoBar room={typedRoom} />
          </div>

          <div className="order-3">
            <RoomChat roomId={id} onlineCount={onlineCount} hostId={typedRoom.host_id ?? null} />
          </div>
        </div>
        )}
      </div>
    </main>
  );
}
