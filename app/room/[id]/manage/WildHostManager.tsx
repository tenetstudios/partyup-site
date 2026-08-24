"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { endWildGame, getWildEncounterState, getWildRoomState, publishWildMission, startWildGame, type WildEncounterState, type WildRoomState } from "@/lib/wild";

export default function WildHostManager({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [state, setState] = useState<WildRoomState | null>(null);
  const [faction, setFaction] = useState("all");
  const [territory, setTerritory] = useState("grove");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("10");
  const [duration, setDuration] = useState("10");
  const [verification, setVerification] = useState<"none" | "same_faction" | "different_faction" | "specific_faction" | "memory_upload">("none");
  const [requiredEncounters, setRequiredEncounters] = useState("1");
  const [targetFaction, setTargetFaction] = useState("pack");
  const [requiredMediaType, setRequiredMediaType] = useState<"any" | "image" | "video">("any");
  const [encounterAnalytics, setEncounterAnalytics] = useState<WildEncounterState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const next = await getWildRoomState(supabase, roomId);
    gameIdRef.current = next.game?.id ?? null;
    setState(next);
    if (next.mission?.config.verification_type === "encounter") {
      setEncounterAnalytics(await getWildEncounterState(supabase, next.mission.id));
    } else {
      setEncounterAnalytics(null);
    }
  }, [roomId, supabase]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    Promise.resolve().then(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Into the Wild.")));
    const subscribe = async () => {
      const channelName = `wild-host-${roomId}`;
      const stale = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (stale) await supabase.removeChannel(stale);
      if (!active) return;
      const refreshGame = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const changedGame = payload.new?.game_id ?? payload.old?.game_id;
        if (!changedGame || changedGame === gameIdRef.current) void load();
      };
      channel = supabase.channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_games", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_territories" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshGame)
        .subscribe();
    };
    void subscribe();
    return () => { active = false; if (channel) void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Wild operation failed."); }
    finally { setBusy(false); }
  }

  const game = state?.game;
  const factions = game?.config.factions ?? [];

  return <section className="mt-6 rounded-xl border border-fuchsia-400/25 bg-fuchsia-950/10 p-5">
    <p className="text-xs font-black tracking-[0.22em] text-fuchsia-300">INTO THE WILD</p>
    <h2 className="mt-2 text-2xl font-black">Night 1 controls</h2>
    <p className="mt-1 text-sm text-zinc-400">Three factions. Three territories. One shared room game.</p>
    {error && <p className="mt-4 rounded bg-rose-950/40 p-3 text-sm font-bold text-rose-300">{error}</p>}
    {!game ? <button type="button" disabled={busy || roomEnded} onClick={() => void run(() => startWildGame(supabase, roomId))} className="mt-5 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Starting…" : "Start Into the Wild"}</button> : <>
      <div className="mt-5 flex flex-wrap gap-3">{(state?.populations ?? []).map((item) => <div key={item.faction_key} className="rounded-lg bg-black/35 px-4 py-3"><p className="font-black">{item.emoji} {item.label}</p><p className="text-sm text-zinc-400">{item.population} players</p></div>)}</div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">{state?.territories.map((item) => <div key={item.id} className="rounded-lg bg-black/35 p-3"><p className="font-black">{item.display_name}</p><p className="mt-1 text-xs text-zinc-400">{item.controlling_faction ? `${factions.find((f) => f.key === item.controlling_faction)?.emoji ?? ""} ${factions.find((f) => f.key === item.controlling_faction)?.label ?? item.controlling_faction}` : "Contested"}</p></div>)}</div>
      {game.status === "active" && !roomEnded && <div className="mt-6 border-t border-white/10 pt-5">
        <h3 className="font-black">Launch faction Mission</h3>
        {state?.mission?.config.verification_type === "encounter" && <p className="mt-2 text-sm font-bold text-fuchsia-200">Active verified encounters: {encounterAnalytics?.verified_encounter_count ?? 0}</p>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-bold text-zinc-300">Faction<select value={faction} onChange={(event) => setFaction(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white"><option value="all">All factions</option>{factions.map((item) => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}</select></label>
          <label className="text-sm font-bold text-zinc-300">Territory<select value={territory} onChange={(event) => setTerritory(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white">{state?.territories.map((item) => <option key={item.key} value={item.key}>{item.display_name}</option>)}</select></label>
          <label className="text-sm font-bold text-zinc-300 md:col-span-2">Mission title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className="mt-1 w-full rounded bg-black p-3 text-white" placeholder="Find another member of your faction" /></label>
          <label className="text-sm font-bold text-zinc-300 md:col-span-2">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} className="mt-1 w-full rounded bg-black p-3 text-white" /></label>
          <label className="text-sm font-bold text-zinc-300">Influence reward<input type="number" min={1} max={100} value={reward} onChange={(event) => setReward(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white" /></label>
          <label className="text-sm font-bold text-zinc-300">Minutes<input type="number" min={1} max={1440} value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white" /></label>
          <label className="text-sm font-bold text-zinc-300 md:col-span-2">Verification<select value={verification} onChange={(event) => setVerification(event.target.value as typeof verification)} className="mt-1 w-full rounded bg-black p-3 text-white"><option value="none">None — manual completion</option><option value="same_faction">Find same faction</option><option value="different_faction">Find different faction</option><option value="specific_faction">Find specific faction</option><option value="memory_upload">Memory upload</option></select></label>
          {verification === "memory_upload" ? <><label className="text-sm font-bold text-zinc-300">Required media<select value={requiredMediaType} onChange={(event) => setRequiredMediaType(event.target.value as typeof requiredMediaType)} className="mt-1 w-full rounded bg-black p-3 text-white"><option value="any">Photo or video</option><option value="image">Photo</option><option value="video">Video</option></select></label><div className="rounded border border-fuchsia-300/20 bg-fuchsia-950/20 p-3 text-sm text-fuchsia-100 md:col-span-2">Participants must post a new Room Memory while the Mission is active before influence can be awarded.</div></> : verification !== "none" && <><label className="text-sm font-bold text-zinc-300">Required unique encounters<select value={requiredEncounters} onChange={(event) => setRequiredEncounters(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white">{[1,2,3].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>{verification === "specific_faction" && <label className="text-sm font-bold text-zinc-300">Target faction<select value={targetFaction} onChange={(event) => setTargetFaction(event.target.value)} className="mt-1 w-full rounded bg-black p-3 text-white">{factions.map((item) => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}</select></label>}<div className="rounded border border-fuchsia-300/20 bg-fuchsia-950/20 p-3 text-sm text-fuchsia-100 md:col-span-2">Participants must exchange a temporary PartyUp QR/code with {verification === "same_faction" ? "another player in their faction" : verification === "different_faction" ? "a player from another faction" : `a ${factions.find((item) => item.key === targetFaction)?.label ?? "target faction"} player`} before influence can be awarded.</div></>}
        </div>
        <button type="button" disabled={busy || !title.trim()} onClick={() => void run(() => publishWildMission(supabase, { gameId: game.id, factionKey: faction, territoryKey: territory, title, description, influenceReward: Number(reward), durationMinutes: Number(duration), verificationType: verification === "memory_upload" ? "memory_upload" : verification === "none" ? "none" : "encounter", encounterRelationship: verification === "none" || verification === "memory_upload" ? null : verification, requiredEncounters: Number(requiredEncounters), targetFaction: verification === "specific_faction" ? targetFaction : null, requiredMediaType }))} className="mt-4 rounded-lg bg-purple-600 px-5 py-3 font-black disabled:opacity-50">Launch Mission</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm("End Into the Wild and calculate the winner?")) void run(() => endWildGame(supabase, game.id)); }} className="ml-3 mt-4 rounded-lg border border-rose-300/30 px-5 py-3 font-black text-rose-200 disabled:opacity-50">End Wild</button>
      </div>}
      {game.status === "ended" && <div className="mt-5"><p className="font-black text-fuchsia-200">The Wild has ended. {(game.winner_summary?.winners ?? []).map((winner) => `${winner.emoji} ${winner.label}`).join(" + ") || "No faction"} won.</p><a href={`/room/${roomId}/wild`} className="mt-3 inline-flex rounded border border-fuchsia-300/25 px-4 py-2 text-sm font-black text-fuchsia-200">View final result</a>{!roomEnded && <button type="button" disabled={busy} onClick={() => void run(() => startWildGame(supabase, roomId))} className="ml-3 mt-3 rounded bg-fuchsia-600 px-4 py-2 text-sm font-black disabled:opacity-50">Start another Wild</button>}</div>}
    </>}
  </section>;
}
