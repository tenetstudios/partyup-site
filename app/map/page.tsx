import { connection } from "next/server";
import HomeHeader from "@/app/components/HomeHeader";
import PartyUpMapClient from "@/app/map/PartyUpMapClient";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { getLiveRooms, LiveRoom } from "@/lib/homeHelpers";

export default async function MapPage() {
  await connection();

  let rooms: LiveRoom[] = [];
  let loadError: string | null = null;

  try {
    const liveData = await getLiveRooms();
    rooms = liveData.rooms.filter((room) => room.status === "live");
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load mapped rooms right now.";
  }

  return (
    <PartyUpPageShell intensity="subtle" crowd={false}>
      <HomeHeader liveCount={rooms.length} />
      {loadError ? (
        <section className="mx-auto w-full max-w-[1458px] px-5 py-8 xl:px-0">
          <div className={`${partyUpTheme.glassCard} border-amber-300/20 p-6 text-sm font-bold text-amber-100`}>
            {loadError}
          </div>
        </section>
      ) : (
        <PartyUpMapClient rooms={rooms} />
      )}
    </PartyUpPageShell>
  );
}
