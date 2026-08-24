"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { createGuestSession, readStoredGuestSession } from "@/lib/matchmaking";
import { completeWildMission, enterWildGame, getWildRoomState, wildFactionByKey, type WildRoomState } from "@/lib/wild";

export default function WildClient({ roomId }: { roomId: string }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const controllersRef = useRef<Record<string, string | null>>({});
  const loadedRef = useRef(false);

  const load = useCallback(async (guestToken?: string | null) => {
    const next = await getWildRoomState(supabase, roomId, guestToken ?? readStoredGuestSession()?.guestToken ?? null);
    if (loadedRef.current) {
      for (const territory of next.territories) {
        const prior = controllersRef.current[territory.key];
        if (prior !== undefined && prior !== territory.controlling_faction && territory.controlling_faction) {
          const faction = next.game?.config.factions.find((item) => item.key === territory.controlling_faction);
          setCapture(`${territory.display_name.toUpperCase()} HAS FALLEN\n${faction?.emoji ?? ""} ${faction?.label.toUpperCase() ?? "A FACTION"} TOOK ${territory.display_name.toUpperCase()}`);
        }
      }
    }
    controllersRef.current = Object.fromEntries(next.territories.map((territory) => [territory.key, territory.controlling_faction]));
    loadedRef.current = true;
    gameIdRef.current = next.game?.id ?? null;
    setState(next);
  }, [roomId, supabase]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let guestRefresh: number | null = null;
    Promise.resolve().then(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Into the Wild.")));
    void supabase.auth.getUser().then(({ data }) => {
      if (active && !data.user) guestRefresh = window.setInterval(() => void load(), 10_000);
    });
    const subscribe = async () => {
      const channelName = `wild-screen-${roomId}`;
      const stale = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (stale) await supabase.removeChannel(stale);
      if (!active) return;
      const refreshGame = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const changedGame = payload.new?.game_id ?? payload.old?.game_id;
        if (!changedGame || changedGame === gameIdRef.current) void load();
      };
      channel = supabase
        .channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_games", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_territories" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, () => void load())
        .subscribe();
    };
    void subscribe();
    return () => {
      active = false;
      if (guestRefresh) window.clearInterval(guestRefresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, roomId, supabase]);

  useEffect(() => {
    if (!capture) return;
    const timer = window.setTimeout(() => setCapture(null), 3200);
    return () => window.clearTimeout(timer);
  }, [capture]);

  async function ensureGuestToken() {
    const { data } = await supabase.auth.getUser();
    let token = readStoredGuestSession()?.guestToken ?? null;
    if (!data.user && !token) token = (await createGuestSession(supabase)).guestToken;
    return token;
  }

  async function enter() {
    if (!state?.game) return;
    setBusy(true); setError(null);
    try {
      const token = await ensureGuestToken();
      await enterWildGame(supabase, state.game.id, token);
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not enter the Wild."); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!state?.mission) return;
    setBusy(true); setError(null);
    try {
      const token = await ensureGuestToken();
      await completeWildMission(supabase, state.mission.id, token);
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this Wild Mission."); }
    finally { setBusy(false); }
  }

  if (!state) return <main className="mx-auto max-w-4xl p-6 text-white">Loading the Wild…</main>;
  if (!state.game) return <main className="mx-auto max-w-4xl p-6 text-white"><Link href={`/room/${roomId}`} className="text-purple-300">← Back to room</Link><h1 className="mt-8 text-4xl font-black">THE WILD IS QUIET</h1><p className="mt-3 text-zinc-400">The host has not started Into the Wild.</p></main>;

  const factions = state.game.config.factions;
  const winners = state.game.winner_summary?.winners ?? [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#36105d_0,#12091f_42%,#07050b_100%)] px-4 py-8 text-white">
      {capture && <div className="pointer-events-none fixed inset-x-4 top-6 z-50 mx-auto max-w-xl whitespace-pre-line rounded-xl border border-fuchsia-300/50 bg-purple-950/95 p-5 text-center text-lg font-black shadow-2xl">{capture}</div>}
      <div className="mx-auto max-w-4xl">
        <Link href={`/room/${roomId}`} className="text-sm font-black text-purple-300">← Back to room</Link>
        <p className="mt-8 text-xs font-black tracking-[0.3em] text-fuchsia-300">PARTYUP PRESENTS</p>
        <h1 className="mt-2 text-4xl font-black sm:text-6xl">INTO THE WILD</h1>

        {state.game.status === "ended" ? (
          <section className="mt-7 rounded-2xl border border-fuchsia-300/30 bg-black/35 p-6 text-center">
            <p className="text-sm font-black tracking-[0.2em] text-fuchsia-300">THE WILD HAS ENDED</p>
            <h2 className="mt-3 text-3xl font-black">{winners.length === 1 ? `${winners[0].emoji} ${winners[0].label.toUpperCase()} WINS` : winners.length ? `${winners.map((winner) => `${winner.emoji} ${winner.label}`).join(" + ")} TIE` : "CONTESTED"}</h2>
            <div className="mt-4 flex flex-wrap justify-center gap-4">{(state.game.winner_summary?.scores ?? []).map((score) => <p key={score.faction_key} className="text-sm font-bold text-zinc-300">{score.emoji} {score.label}: {score.territories_controlled} territories · {score.total_influence} influence</p>)}</div>
          </section>
        ) : state.assignment ? (
          <section className="mt-7 rounded-2xl border border-white/10 bg-black/35 p-5"><p className="text-xs font-black text-zinc-400">YOUR FACTION</p><p className="mt-2 text-3xl font-black">{state.assignment.emoji} {state.assignment.label.toUpperCase()}</p></section>
        ) : (
          <section className="mt-7 rounded-2xl border border-fuchsia-300/30 bg-black/35 p-6"><p className="font-black">Get your faction. Complete Missions. Help your side take the map.</p><button type="button" onClick={() => void enter()} disabled={busy || state.room_closed} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Entering…" : "Enter the Wild"}</button></section>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {state.territories.map((territory) => {
            const controller = wildFactionByKey(state, territory.controlling_faction);
            const total = Object.values(territory.influence).reduce((sum, amount) => sum + amount, 0);
            return <article key={territory.id} className="rounded-2xl border border-purple-300/20 bg-black/40 p-5"><h2 className="text-xl font-black">{territory.display_name.toUpperCase()}</h2><div className="mt-4 space-y-2">{factions.map((faction) => { const amount = territory.influence[faction.key] ?? 0; return <div key={faction.key}><div className="flex justify-between text-sm font-black"><span>{faction.emoji} {faction.label}</span><span>{amount}</span></div>{total > 0 && <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full rounded" style={{ width: `${(amount / total) * 100}%`, backgroundColor: faction.color ?? "#d946ef" }} /></div>}</div>; })}</div><p className="mt-5 text-xs font-black uppercase text-zinc-400">{controller ? `Controlled by ${controller.emoji} ${controller.label}` : "Contested"}</p></article>;
          })}
        </section>

        {state.assignment && state.game.status === "active" && <section className="mt-8 rounded-2xl border border-fuchsia-300/25 bg-black/35 p-5"><p className="text-xs font-black tracking-[0.2em] text-fuchsia-300">YOUR MISSION</p>{state.mission ? <><h2 className="mt-3 text-2xl font-black">{state.mission.title}</h2>{state.mission.description && <p className="mt-2 text-zinc-300">{state.mission.description}</p>}<p className="mt-3 text-sm font-black text-purple-200">+{state.mission.config.influence_reward} influence · {state.territories.find((item) => item.key === state.mission?.config.territory_key)?.display_name}</p>{!state.mission.eligible ? <p className="mt-4 text-sm font-black text-amber-300">This objective belongs to another faction.</p> : state.mission.viewer_completed ? <p className="mt-4 font-black text-emerald-300">✓ Mission complete. Influence added.</p> : <button type="button" onClick={() => void complete()} disabled={busy} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Completing…" : "Complete Mission"}</button>}</> : <p className="mt-3 text-zinc-400">No active Mission right now.</p>}</section>}

        {state.assignment && <section className="mt-8 rounded-2xl border border-white/10 bg-black/35 p-5"><p className="text-xs font-black tracking-[0.2em] text-purple-300">YOUR IMPACT</p><div className="mt-4 flex gap-8"><div><p className="text-3xl font-black">{state.impact.missions_completed}</p><p className="text-sm text-zinc-400">Missions completed</p></div><div><p className="text-3xl font-black">+{state.impact.influence_added}</p><p className="text-sm text-zinc-400">Influence added</p></div></div></section>}
        {error && <p className="mt-5 rounded-lg bg-rose-950/40 p-3 text-sm font-bold text-rose-300">{error}</p>}
      </div>
    </main>
  );
}
