import { connection } from "next/server";
import Link from "next/link";
import HomeHeader from "@/app/components/HomeHeader";
import LiveRoomCard from "@/app/components/LiveRoomCard";
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
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader liveCount={rooms.length} />

      <section className="mx-auto w-full max-w-[1458px] px-5 py-8 xl:px-0">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c35dff]">PartyUp</p>
            <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">Live Now</h1>
            <p className="mt-3 text-sm font-bold leading-6 text-[#aaa4b8]">See what&apos;s happening right now.</p>
          </div>

          <Link
            href="/map"
            className="inline-flex h-10 items-center justify-center rounded-md border border-purple-300/25 px-4 text-sm font-black text-[#d6b8ff] hover:bg-purple-500/15 hover:text-white"
          >
            Explore Map
          </Link>
        </div>

        {loadError ? (
          <div className="mt-8 rounded-lg border border-amber-300/20 bg-amber-950/30 p-6 text-sm font-bold text-amber-100">
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
          <div className="mt-8 grid min-h-[320px] place-items-center rounded-lg border border-dashed border-purple-300/20 bg-[#10101a]/70 p-8 text-center">
            <div>
              <h2 className="text-xl font-black">No rooms are live right now.</h2>
              <Link
                href="/map"
                className="mt-6 inline-flex h-11 items-center rounded-md bg-[#8b3dff] px-5 text-sm font-black text-white hover:bg-[#7b31e8]"
              >
                Explore Map
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
