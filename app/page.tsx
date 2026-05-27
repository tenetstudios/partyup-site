import Link from "next/link";
import { connection } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import CreateRoomButton from "@/app/components/CreateRoomButton";
import AuthButton from "@/app/components/AuthButton";

type DatabaseRecord = Record<string, unknown>;

type LiveRoom = DatabaseRecord & {
  id: string | number;
  host_id?: string | number | null;
  status?: string | null;
  scheduled_at?: string | null;
};

type HostProfile = DatabaseRecord & {
  id: string | number;
};

function asText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getRoomTitle(room: LiveRoom) {
  return (
    asText(room.title) ??
    asText(room.name) ??
    asText(room.room_name) ??
    "Live Room"
  );
}

function getRoomDescription(room: LiveRoom) {
  return (
    asText(room.description) ??
    asText(room.topic) ??
    asText(room.subtitle) ??
    "Jump into the live conversation happening now."
  );
}

function getActivity(room: LiveRoom) {
  const activityFields = [
    "active_count",
    "participant_count",
    "participants_count",
    "viewer_count",
    "viewers_count",
    "listener_count",
    "listeners_count",
    "member_count",
    "members_count",
    "live_count",
  ];

  return activityFields.reduce((highest, field) => {
    return Math.max(highest, asNumber(room[field]) ?? 0);
  }, 0);
}

function getHostName(profile?: HostProfile) {
  if (!profile) {
    return "PartyUp host";
  }

  return (
    asText(profile.display_name) ??
    asText(profile.full_name) ??
    asText(profile.username) ??
    asText(profile.name) ??
    "PartyUp host"
  );
}

function getHostInitial(profile?: HostProfile) {
  return getHostName(profile).slice(0, 1).toUpperCase();
}

function getCategory(room: LiveRoom) {
  return (
    asText(room.category) ??
    asText(room.room_type) ??
    asText(room.type) ??
    "Live"
  );
}

function getScheduledText(room: LiveRoom) {
  const rawDate = asText(room.scheduled_at);

  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function getLiveRooms() {
  const supabase = createSupabaseClient();

  const { data: rooms, error: roomsError } = await supabase
    .from("event_rooms")
    .select("*")
    .in("status", ["live", "scheduled"]);

  if (roomsError) {
    throw roomsError;
  }

  const liveRooms = ((rooms ?? []) as LiveRoom[]).filter((room) => room.id);
  const hostIds = Array.from(
    new Set(
      liveRooms
        .map((room) => room.host_id)
        .filter((hostId): hostId is string | number => hostId != null),
    ),
  );

  if (hostIds.length === 0) {
    return { rooms: liveRooms, profilesById: new Map<string, HostProfile>() };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", hostIds);

  if (profilesError) {
    throw profilesError;
  }

  return {
    rooms: liveRooms,
    profilesById: new Map(
      ((profiles ?? []) as HostProfile[]).map((profile) => [
        String(profile.id),
        profile,
      ]),
    ),
  };
}

export default async function HomePage() {
  await connection();

  let rooms: LiveRoom[] = [];
  let profilesById = new Map<string, HostProfile>();
  let loadError: string | null = null;

  try {
    const liveData = await getLiveRooms();
    rooms = liveData.rooms.sort((first, second) => {
      return getActivity(second) - getActivity(first);
    });
    profilesById = liveData.profilesById;
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Unable to load live rooms right now.";
  }

const liveRooms = rooms.filter((room) => room.status === "live");
const scheduledRooms = rooms.filter((room) => room.status === "scheduled");

  const featuredRoom = liveRooms[0];
  const featuredHost =
    featuredRoom?.host_id != null
      ? profilesById.get(String(featuredRoom.host_id))
      : undefined;

  return (
    <main className="min-h-screen bg-[#07000f] text-white">
      <nav className="sticky top-0 z-20 border-b border-white/10 bg-[#0c0118]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-2xl font-black tracking-tight">
            party<span className="text-[#bf94ff]">up</span>.io
          </Link>

          <div className="hidden items-center gap-7 text-sm font-bold text-zinc-300 md:flex">
            <a href="#featured" className="hover:text-white">
              Featured
            </a>
            <a href="#live-now" className="hover:text-white">
              Live Now
            </a>
          </div>

          <div className="flex items-center gap-3">
  <div className="hidden items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs font-black uppercase text-purple-200 sm:flex">
    <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.9)]" />
    {liveRooms.length} live
  </div>

  <AuthButton />

  <CreateRoomButton />
</div>
        </div>
      </nav>
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(145,70,255,0.45),transparent_34%),linear-gradient(135deg,#130024,#07000f_58%)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[1.4fr_0.8fr] lg:py-12">
          <div id="featured">
            <div className="mb-4 flex items-center gap-3">
              <span className="rounded-sm bg-red-600 px-2 py-1 text-xs font-black uppercase">
                Featured Live
              </span>
              <span className="text-sm font-semibold text-purple-100/80">
                Most active room on PartyUp
              </span>
            </div>

            {featuredRoom ? (
              <div className="overflow-hidden rounded-lg border border-purple-300/20 bg-black shadow-2xl shadow-purple-950/50">
                <div className="relative flex min-h-[360px] items-end bg-[linear-gradient(135deg,rgba(145,70,255,0.42),rgba(25,4,40,0.88)),radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.22),transparent_25%)] p-6 md:min-h-[460px] md:p-8">
                  <div className="absolute left-4 top-4 rounded-sm bg-red-600 px-2 py-1 text-xs font-black uppercase">
                    Live
                  </div>
                  <div className="max-w-3xl">
                    <p className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-purple-100">
                      {getCategory(featuredRoom)}
                    </p>
                    <h1 className="text-4xl font-black tracking-tight md:text-6xl">
                      {getRoomTitle(featuredRoom)}
                    </h1>
                    <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-200">
                      {getRoomDescription(featuredRoom)}
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-4">
                      <Link
                        href={`/room/${featuredRoom.id}`}
                        className="rounded-md bg-[#9146ff] px-6 py-3 font-black hover:bg-[#7b31e8]"
                      >
                        Join Room
                      </Link>
                      <span className="text-sm font-bold text-zinc-300">
                        {getActivity(featuredRoom)} active
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState loadError={loadError} />
            )}
          </div>

          <aside className="rounded-lg border border-white/10 bg-[#12051e] p-4 lg:self-end">
            <h2 className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-purple-200">
              Host Spotlight
            </h2>
            {featuredRoom ? (
              <div>
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-[#9146ff] text-lg font-black">
                    {getHostInitial(featuredHost)}
                  </div>
                  <div>
                    <p className="font-black">{getHostName(featuredHost)}</p>
                    <p className="text-sm text-zinc-400">Hosting now</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md bg-black/35 p-3">
                    <p className="text-zinc-500">Status</p>
                    <p className="mt-1 font-black text-red-400">LIVE</p>
                  </div>
                  <div className="rounded-md bg-black/35 p-3">
                    <p className="text-zinc-500">Active</p>
                    <p className="mt-1 font-black">
                      {getActivity(featuredRoom)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-6 text-zinc-400">
                When a room goes live, the most active one will appear here.
              </p>
            )}
          </aside>
        </div>
      </section>

      <section id="live-now" className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">
              Live Now
            </p>
            <h2 className="mt-2 text-3xl font-black md:text-4xl">
              Discover active rooms
            </h2>
          </div>
          <p className="text-sm font-semibold text-zinc-400">
            {liveRooms.length} room{liveRooms.length === 1 ? "" : "s"}
          </p>
        </div>

        {liveRooms.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {liveRooms.map((room) => {
              const host =
                room.host_id != null
                  ? profilesById.get(String(room.host_id))
                  : undefined;

              return (
                <article
                  key={String(room.id)}
                  className="overflow-hidden rounded-lg border border-white/10 bg-[#12051e] transition hover:-translate-y-0.5 hover:border-purple-300/50"
                >
                  <div className="relative aspect-video bg-[linear-gradient(135deg,rgba(145,70,255,0.52),rgba(16,2,28,0.95)),radial-gradient(circle_at_75%_25%,rgba(255,255,255,0.24),transparent_25%)]">
                    <span className="absolute left-3 top-3 rounded-sm bg-red-600 px-2 py-1 text-xs font-black uppercase">
                      Live
                    </span>
                    <span className="absolute bottom-3 right-3 rounded-sm bg-black/75 px-2 py-1 text-xs font-bold">
                      {getActivity(room)} active
                    </span>
                  </div>

                  <div className="p-4">
                    <div className="flex gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#9146ff] text-sm font-black">
                        {getHostInitial(host)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-black">
                          {getRoomTitle(room)}
                        </h3>
                        <p className="mt-1 truncate text-sm text-zinc-400">
                          {getHostName(host)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-300">
                      {getRoomDescription(room)}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
  <span className="rounded-sm bg-purple-500/15 px-2 py-1 text-xs font-bold text-purple-200">
    {getCategory(room)}
  </span>

  {room.status === "scheduled" && getScheduledText(room) && (
    <span className="rounded-sm bg-blue-500/15 px-2 py-1 text-xs font-bold text-blue-200">
      Starts {getScheduledText(room)}
    </span>
  )}
</div>

<Link
  href={`/room/${room.id}`}
  className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8]"
>
  Join Room
</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState loadError={loadError} />
        )}
     </section>

{/* Upcoming Rooms */}
<section id="upcoming" className="mx-auto max-w-7xl px-5 py-10">
  <div className="mb-6 flex items-end justify-between gap-4">
    <div>
      <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">
        Upcoming
      </p>
      <h2 className="mt-2 text-3xl font-black md:text-4xl">
        Scheduled rooms
      </h2>
    </div>

    <p className="text-sm font-semibold text-zinc-400">
      {scheduledRooms.length} room
      {scheduledRooms.length === 1 ? "" : "s"}
    </p>
  </div>

  {scheduledRooms.length > 0 ? (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {scheduledRooms.map((room) => {
        const host =
          room.host_id != null
            ? profilesById.get(String(room.host_id))
            : undefined;

        return (
          <article
            key={String(room.id)}
            className="overflow-hidden rounded-lg border border-white/10 bg-[#12051e]"
          >
            <div className="relative aspect-video bg-[linear-gradient(135deg,rgba(59,130,246,0.42),rgba(16,2,28,0.95))]">
              <span className="absolute left-3 top-3 rounded-sm bg-blue-600 px-2 py-1 text-xs font-black uppercase">
                Scheduled
              </span>
            </div>

            <div className="p-4">
              <h3 className="truncate text-lg font-black">
                {getRoomTitle(room)}
              </h3>

              {getScheduledText(room) && (
                <p className="mt-2 text-sm font-black text-purple-300">
                  Starts {getScheduledText(room)}
                </p>
              )}

              <p className="mt-2 text-sm text-zinc-400">
                Hosted by {getHostName(host)}
              </p>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="rounded-sm bg-purple-500/15 px-2 py-1 text-xs font-bold text-purple-200">
                  {getCategory(room)}
                </span>

                <Link
                  href={`/room/${room.id}`}
                  className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8]"
                >
                  View
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  ) : (
    <p className="rounded-lg border border-white/10 bg-[#12051e] p-6 text-zinc-400">
      No scheduled rooms yet.
    </p>
  )}
</section>

</main>
  );
}

function EmptyState({ loadError }: { loadError: string | null }) {
  return (
    <div className="rounded-lg border border-dashed border-purple-300/30 bg-[#12051e] px-6 py-14 text-center">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">
        No Live Rooms
      </p>
      <h2 className="mt-3 text-3xl font-black">Nothing is live right now.</h2>
      <p className="mx-auto mt-3 max-w-xl leading-7 text-zinc-400">
        {loadError ??
          "Check back soon. PartyUp rooms will appear here the moment hosts go live."}
      </p>
    </div>
  );
}
