"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getRoomTrivia, type TriviaRoundSummary } from "@/lib/lightningTrivia";
import { createSupabaseClient } from "@/lib/supabase";

export default function LightningTriviaBanner({ roomId }: { roomId: string }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [round, setRound] = useState<TriviaRoundSummary | null>(null);
  const [now, setNow] = useState(0);
  const load = useCallback(() => getRoomTrivia(supabase, roomId).then(setRound).catch(() => undefined), [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => { setNow(Date.now()); void load(); });
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    const channel = supabase.channel(`trivia-banner-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  if (!round) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(round.starts_at) - now) / 1000));
  const label = round.status === "scheduled" ? "Join Round" : round.status === "ended" ? "View Results" : "Open Round";
  return <section className="overflow-hidden rounded-xl border border-yellow-300/35 bg-[radial-gradient(circle_at_top_right,rgba(250,204,21,0.2),transparent_45%),#180d20] p-5 shadow-[0_18px_55px_rgba(250,204,21,0.08)]">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-black tracking-[0.22em] text-yellow-300">⚡ VERIFIED MISSION</p><h2 className="mt-1 text-2xl font-black">LIGHTNING TRIVIA</h2><p className="mt-1 text-sm font-bold text-zinc-300">{round.status === "scheduled" ? `Starts in ${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}` : round.status === "ended" ? "Round complete" : "10 questions · 5 seconds each"}{round.territory_key ? ` · Fight for ${round.territory_key.replace(/_/g, " ")}` : ""}</p></div>
      <Link href={`/room/${roomId}/trivia`} className="inline-flex min-h-12 items-center rounded-lg bg-yellow-400 px-5 font-black text-black hover:bg-yellow-300">{label}</Link>
    </div>
  </section>;
}
