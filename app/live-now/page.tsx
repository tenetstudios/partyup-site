import { connection } from "next/server";
import Link from "next/link";
import HomeHeader from "@/app/components/HomeHeader";
import LiveRoomCard from "@/app/components/LiveRoomCard";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { getLiveRooms, HostProfile, LiveRoom, getActivity } from "@/lib/homeHelpers";

export default async function LiveNowPage() {
  await connection();

  let rooms: LiveRoom[] = [];
  let profilesById = new Map<string, HostProfile>();
  let loadError: string | null = null;

  try {
    const liveData = await getLiveRooms();
    rooms = liveData.rooms
      .filter((room) => room.status === "live")
      .sort((a, b) => Number(getActivity(b)) - Number(getActivity(a)));
    profilesById = liveData.profilesById;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load live rooms right now.";
  }

  return (
    <PartyUpPageShell intensity="standard">
      <HomeHeader liveCount={rooms.length} />

      <section className="relative mx-auto w-full max-w-[1458px] px-5 py-8 md:py-10 xl:px-0">
        <div className="flex flex-col gap-5 border-b border-purple-100/15 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={partyUpTheme.sectionLabel}>PartyUp</p>
            <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">Live Now</h1>
            <p className={`mt-3 text-sm font-bold leading-6 ${partyUpTheme.textSecondary}`}>See what&apos;s happening right now.</p>
          </div>

          <Link
            href="/map"
            className={`${partyUpTheme.ghostButton} w-full px-4 text-sm sm:w-auto`}
          >
            Explore Map
          </Link>
        </div>

        {loadError ? (
          <div className={`${partyUpTheme.glassCard} mt-8 border-amber-300/25 p-6 text-sm font-bold text-amber-100`}>
            {loadError}
          </div>
        ) : rooms.length > 0 ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rooms.map((room) => {
              const host = room.host_id != null ? profilesById.get(String(room.host_id)) : undefined;
              return <LiveRoomCard key={String(room.id)} room={room} host={host} />;
            })}
          </div>
        ) : (
          <div className={`${partyUpTheme.emptyState} mt-8 grid min-h-[320px] place-items-center p-8`}>
            <div>
              <h2 className="text-xl font-black">No rooms are live right now.</h2>
              <Link
                href="/map"
                className={`${partyUpTheme.primaryButton} mt-6 px-5 text-sm`}
              >
                Explore Map
              </Link>
            </div>
          </div>
        )}
      </section>
    </PartyUpPageShell>
  );
}
