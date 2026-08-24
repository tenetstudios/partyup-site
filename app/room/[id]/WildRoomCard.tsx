"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { createGuestSession, readStoredGuestSession } from "@/lib/matchmaking";
import { enterWildGame, getWildRoomState, type WildRoomState } from "@/lib/wild";

export default function WildRoomCard({ roomId }: { roomId: string }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const guestToken = readStoredGuestSession()?.guestToken ?? null;
    setState(await getWildRoomState(supabase, roomId, guestToken));
  }, [roomId, supabase]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    Promise.resolve().then(() => void load().catch(() => undefined));

    const subscribe = async () => {
      const channelName = `wild-room-card-${roomId}`;
      const stale = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (stale) await supabase.removeChannel(stale);
      if (!active) return;
      channel = supabase
        .channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_games", filter: `room_id=eq.${roomId}` }, () => void load())
        .subscribe();
    };
    void subscribe();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, roomId, supabase]);

  if (!state?.game || state.game.status !== "active") return null;

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      let guestToken = readStoredGuestSession()?.guestToken ?? null;
      if (!data.user && !guestToken) guestToken = (await createGuestSession(supabase)).guestToken;
      await enterWildGame(supabase, state!.game!.id, guestToken);
      setState(await getWildRoomState(supabase, roomId, guestToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not enter the Wild.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-fuchsia-400/35 bg-[linear-gradient(135deg,rgba(49,16,85,.92),rgba(15,8,28,.96))] p-4 shadow-[0_18px_50px_rgba(91,33,182,.18)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black tracking-[0.24em] text-fuchsia-300">INTO THE WILD</p>
          {state.assignment ? (
            <p className="mt-2 text-lg font-black text-white">YOU ARE {state.assignment.emoji} {state.assignment.label.toUpperCase()}</p>
          ) : (
            <><p className="mt-2 font-black text-white">Something is happening here.</p><p className="mt-1 text-sm text-zinc-300">Get your faction. Complete Missions. Help your side take the map.</p></>
          )}
        </div>
        {state.assignment ? (
          <Link href={`/room/${roomId}/wild`} className="rounded-lg bg-fuchsia-600 px-4 py-3 text-sm font-black text-white hover:bg-fuchsia-500">View the Wild</Link>
        ) : (
          <button type="button" onClick={() => void enter()} disabled={busy} className="rounded-lg bg-fuchsia-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? "Entering…" : "Enter the Wild"}</button>
        )}
      </div>
      {error && <p className="mt-3 text-sm font-bold text-rose-300">{error}</p>}
    </section>
  );
}
