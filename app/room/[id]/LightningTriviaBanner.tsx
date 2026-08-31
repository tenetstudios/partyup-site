"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getRoomTrivia, type TriviaRoundSummary } from "@/lib/lightningTrivia";
import { createSupabaseClient } from "@/lib/supabase";

function dismissedResultStorageKey(roundId: string) {
  return `partyup_trivia_result_dismissed:${roundId}`;
}

export default function LightningTriviaBanner({ roomId }: { roomId: string }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [round, setRound] = useState<TriviaRoundSummary | null>(null);
  const [dismissedRoundId, setDismissedRoundId] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const load = useCallback(() => getRoomTrivia(supabase, roomId).then((nextRound) => {
    setDismissedRoundId(
      nextRound?.status === "ended"
        && window.localStorage.getItem(dismissedResultStorageKey(nextRound.id)) === "1"
        ? nextRound.id
        : null,
    );
    setRound(nextRound);
  }).catch(() => undefined), [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => { setNow(Date.now()); void load(); });
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    const channel = supabase.channel(`trivia-banner-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  function dismissFinalResult() {
    if (!round || round.status !== "ended") return;
    window.localStorage.setItem(dismissedResultStorageKey(round.id), "1");
    setDismissedRoundId(round.id);
  }

  if (!round || (round.status === "ended" && dismissedRoundId === round.id)) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(round.starts_at) - now) / 1000));
  const label = round.status === "scheduled" ? "Join Round" : round.status === "ended" ? "View Results" : "Open Round";
  return <section className={`relative overflow-hidden rounded-xl border border-yellow-300/35 bg-[radial-gradient(circle_at_top_right,rgba(250,204,21,0.2),transparent_45%),#180d20] p-5 shadow-[0_18px_55px_rgba(250,204,21,0.08)] ${round.status === "ended" ? "pr-14" : ""}`}>
    {round.status === "ended" && <button type="button" onClick={dismissFinalResult} aria-label="Dismiss Lightning Trivia results" title="Dismiss results" className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/25 text-2xl leading-none text-zinc-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300"><span aria-hidden="true">&times;</span></button>}
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-black tracking-[0.22em] text-yellow-300">⚡ VERIFIED MISSION</p><h2 className="mt-1 text-2xl font-black">LIGHTNING TRIVIA</h2><p className="mt-1 text-sm font-bold text-zinc-300">{round.status === "scheduled" ? `Join now · starts in ${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}` : round.status === "ended" ? "Round complete" : `10 questions · ${round.seconds_per_question} seconds each`}{round.territory_key ? ` · Fight for ${round.territory_key.replace(/_/g, " ")}` : ""}</p></div>
      <Link href={`/room/${roomId}/trivia`} className="inline-flex min-h-12 items-center rounded-lg bg-yellow-400 px-5 font-black text-black hover:bg-yellow-300">{label}</Link>
    </div>
  </section>;
}
