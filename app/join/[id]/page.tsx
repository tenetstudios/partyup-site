import Link from "next/link";
import { createSupabaseClient } from "@/lib/supabase";
import { isRoomContextAvailable, type RoomContextRecord } from "@/lib/roomContextValidation";
import JoinRoomContextSetter from "./JoinRoomContextSetter";

export default async function JoinRoomPage({
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

  const typedRoom = room as RoomContextRecord | null;

  if (!isRoomContextAvailable(typedRoom)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07000f] px-5 text-white">
        <section className="w-full max-w-md rounded-[10px] border border-white/10 bg-white/[0.04] p-6 text-center">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#b587ff]">
            PartyUp venue entry
          </p>
          <h1 className="mt-3 text-3xl font-black">Room unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-[#c8c0d4]">
            This room could not be opened from this entry link.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-11 items-center rounded-[8px] bg-[#9146ff] px-5 text-sm font-black text-white hover:bg-[#7b31e8]"
          >
            Go to PartyUp
          </Link>
        </section>
      </main>
    );
  }

  return <JoinRoomContextSetter roomId={String(typedRoom.id)} />;
}
