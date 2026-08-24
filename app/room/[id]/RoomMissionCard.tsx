"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createSupabaseClient } from "@/lib/supabase";
import { createGuestSession, readStoredGuestSession } from "@/lib/matchmaking";
import {
  animalDetails,
  completeRoomMission,
  createMissionEncounterToken,
  getActiveRoomMission,
  getMissionTimeRemaining,
  getMyAnimalPackState,
  getMyConnectionMissionState,
  joinAnimalPackMission,
  redeemMissionEncounterToken,
  type AnimalPackState,
  type ConnectionMissionState,
  type EncounterResultStatus,
  type MissionEncounterToken,
  type RoomMission,
} from "@/lib/roomMissions";

const encounterMessages: Record<EncounterResultStatus, string> = {
  valid: "PACK MEMBER FOUND ✓",
  self_scan: "That’s your own code.",
  wrong_mission: "This person is in a different Mission.",
  wrong_animal: "You found a different pack.",
  duplicate: "You already found each other.",
  expired: "That code expired. Ask them to refresh it.",
  mission_ended: "This Mission is no longer active.",
  invalid: "That Mission code isn’t valid.",
};

export default function RoomMissionCard({
  roomId,
  initialMission,
}: {
  roomId: string;
  initialMission: RoomMission | null;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [mission, setMission] = useState(initialMission);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [animalState, setAnimalState] = useState<AnimalPackState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionMissionState | null>(null);
  const [mode, setMode] = useState<"details" | "animal" | "qr" | "scan">("details");
  const [encounterToken, setEncounterToken] = useState<MissionEncounterToken | null>(null);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const missionRef = useRef<RoomMission | null>(initialMission);
  const guestTokenRef = useRef<string | null>(null);

  useEffect(() => {
    missionRef.current = mission;
  }, [mission]);

  useEffect(() => {
    guestTokenRef.current = guestToken;
  }, [guestToken]);

  const loadMission = useCallback(async () => {
    const nextMission = await getActiveRoomMission(supabase, roomId);
    setMission(nextMission);
    if (nextMission?.mission_type === "connection") {
      setConnectionState(await getMyConnectionMissionState(supabase, nextMission.id));
    } else {
      setConnectionState(null);
    }
    if (!nextMission) {
      setExpanded(false);
      setAnimalState(null);
    }
  }, [roomId, supabase]);

  const refreshAnimalState = useCallback(async (missionId: string, token: string | null) => {
    setAnimalState(await getMyAnimalPackState(supabase, missionId, token));
  }, [supabase]);

  const prepareAnimalPack = useCallback(async (missionId: string) => {
    const { data: authData } = await supabase.auth.getUser();
    let token = readStoredGuestSession()?.guestToken ?? null;
    if (!authData.user && !token) token = (await createGuestSession(supabase)).guestToken;
    setGuestToken(token);
    await joinAnimalPackMission(supabase, missionId, token);
    await refreshAnimalState(missionId, token);
  }, [refreshAnimalState, supabase]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    Promise.resolve().then(() => {
      setNow(Date.now());
      void loadMission().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load the Mission."));
    });

    const subscribe = async () => {
      const channelName = `room-missions-${roomId}`;
      const existingChannel = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (existingChannel) await supabase.removeChannel(existingChannel);
      if (!active) return;

      channel = supabase
        .channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` }, () => void loadMission())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, () => void loadMission())
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, () => {
          const currentMission = missionRef.current;
          if (currentMission?.mission_type === "animal_pack") {
            void refreshAnimalState(currentMission.id, guestTokenRef.current);
          }
        })
        .subscribe();
    };

    void subscribe().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not subscribe to Mission updates.");
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadMission, refreshAnimalState, roomId, supabase]);

  useEffect(() => {
    if (!mission?.ends_at) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    const timeout = window.setTimeout(() => void loadMission(), Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [loadMission, mission?.ends_at]);

  useEffect(() => {
    if (!expanded || mission?.mission_type !== "animal_pack") return;
    Promise.resolve().then(() => prepareAnimalPack(mission.id)).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not join Find Your Pack."));
    const interval = window.setInterval(() => void refreshAnimalState(mission.id, guestToken), 10_000);
    return () => window.clearInterval(interval);
  }, [expanded, guestToken, mission?.id, mission?.mission_type, prepareAnimalPack, refreshAnimalState]);

  useEffect(() => {
    if (mode !== "qr" || !mission || mission.mission_type !== "animal_pack") return;
    let cancelled = false;
    let refreshTimeout: number | undefined;
    async function refreshCode() {
      try {
        const next = await createMissionEncounterToken(supabase, mission!.id, guestToken);
        if (cancelled) return;
        setEncounterToken(next);
        refreshTimeout = window.setTimeout(refreshCode, Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not create your Mission QR.");
      }
    }
    void refreshCode();
    return () => { cancelled = true; if (refreshTimeout) window.clearTimeout(refreshTimeout); };
  }, [guestToken, mission, mode, supabase]);

  if (!mission) return null;
  const remaining = now ? getMissionTimeRemaining(mission.ends_at, now) : null;
  const isAnimalPack = mission.mission_type === "animal_pack";
  const isConnection = mission.mission_type === "connection";
  const isWild = mission.mission_type === "wild_faction";
  const animalName = animalState ? (animalDetails[animalState.assignment_key]?.plural ?? "pack members") : "pack members";
  const tokenRefreshSeconds = encounterToken && now
    ? Math.max(0, Math.ceil((Date.parse(encounterToken.expires_at) - now - 5_000) / 1000))
    : null;

  async function markComplete() {
    if (busy || mission!.viewer_completed || remaining?.expired) return;
    setBusy(true); setError(null);
    try { await completeRoomMission(supabase, mission!.id); await loadMission(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete the Mission."); }
    finally { setBusy(false); }
  }

  async function redeem() {
    if (!code.trim() || busy) return;
    setBusy(true); setError(null); setFeedback(null);
    try {
      const result = await redeemMissionEncounterToken(supabase, mission!.id, code.trim(), guestToken);
      setFeedback(encounterMessages[result.status]);
      setCode("");
      await refreshAnimalState(mission!.id, guestToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify that code."); }
    finally { setBusy(false); }
  }

  if (expanded && isAnimalPack && mode === "animal" && animalState) {
    return <section className="relative grid min-h-[430px] place-items-center rounded-xl border border-purple-300/30 bg-black p-8 text-center">
      <button type="button" onClick={() => setMode("details")} className="absolute right-4 top-4 rounded-md border border-white/20 px-4 py-2 font-black">Close</button>
      <div><p className="text-sm font-black uppercase tracking-[0.28em] text-purple-200">Show My Animal</p><p className="mt-7 text-[9rem] leading-none">{animalState.assignment_key}</p></div>
    </section>;
  }

  return (
    <section className="rounded-[10px] border border-pink-300/25 bg-[#171020] px-5 py-4 shadow-[0_14px_38px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#ef2f82] px-2 py-1 text-[11px] font-black uppercase text-white">{isAnimalPack ? "Find Your Pack" : isConnection ? "Meet New People" : isWild ? "Into the Wild" : "New Mission"}</span>
            {remaining && <span className="text-xs font-black text-pink-200">{remaining.expired ? "Ending..." : `${remaining.label} remaining`}</span>}
            {(animalState?.completed || connectionState?.completed || mission.viewer_completed) && <span className="text-xs font-black uppercase text-emerald-300">Completed</span>}
          </div>
          <h2 className="mt-2 text-xl font-black text-white">{mission.title}</h2>
        </div>
        <button type="button" onClick={() => { setExpanded((value) => !value); setMode("details"); }} className="min-h-11 shrink-0 rounded-md border border-white/15 px-4 text-sm font-black text-white hover:bg-white/10">{expanded ? "Close" : "View Mission"}</button>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {isAnimalPack ? (
            animalState ? (
              <div className="text-center">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-purple-200">Your Animal</p>
                <button type="button" onClick={() => setMode("animal")} className="mt-3 text-7xl" aria-label="Show my animal full screen">{animalState.assignment_key}</button>
                <p className="mt-4 text-lg font-black text-white">Find {animalState.target_encounters} other {animalName} in this room.</p>
                <p className="mt-2 text-3xl font-black text-pink-300">{Math.min(animalState.progress, animalState.target_encounters)} / {animalState.target_encounters} found</p>
                {animalState.completed ? (
                  <div className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4"><p className="text-xl font-black text-emerald-300">PACK FOUND ✓</p><p className="mt-1 text-sm text-emerald-100">You found {animalState.target_encounters} other {animalName}.</p></div>
                ) : (
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button type="button" onClick={() => { setMode("qr"); setFeedback(null); }} className="min-h-12 rounded-md bg-[#9146ff] px-5 font-black text-white">Show My QR</button>
                    <button type="button" onClick={() => { setMode("scan"); setFeedback(null); }} className="min-h-12 rounded-md bg-[#ef2f82] px-5 font-black text-white">Enter Someone’s Code</button>
                    <button type="button" onClick={() => setMode("animal")} className="min-h-12 rounded-md border border-white/20 px-5 font-black text-white">Show My Animal</button>
                  </div>
                )}

                {mode === "qr" && !animalState.completed && (
                  <div className="mx-auto mt-5 max-w-sm rounded-xl bg-white p-5 text-black">
                    <p className="text-4xl">{animalState.assignment_key}</p>
                    <p className="mt-2 text-sm font-black">Scan this when you find another {animalDetails[animalState.assignment_key]?.singular ?? "pack member"}.</p>
                    {encounterToken ? <><div className="mx-auto mt-4 w-fit"><QRCodeSVG value={encounterToken.qr_payload} size={220} level="M" /></div><p className="mt-4 text-2xl font-black tracking-[0.25em]">{encounterToken.short_code}</p><p className="mt-2 text-xs font-bold text-zinc-500">{tokenRefreshSeconds === 0 ? "Refreshing…" : `Refreshes in ${tokenRefreshSeconds ?? "–"} seconds`}</p></> : <p className="mt-5 font-bold">Creating secure code…</p>}
                  </div>
                )}

                {mode === "scan" && !animalState.completed && (
                  <div className="mx-auto mt-5 max-w-sm rounded-xl bg-black/40 p-5 text-left">
                    <label className="text-sm font-black text-purple-200">Enter their temporary code</label>
                    <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void redeem(); }} maxLength={64} autoCapitalize="characters" placeholder="F7K2A1B9" className="mt-2 w-full rounded-md bg-black px-4 py-3 text-center text-xl font-black uppercase tracking-[0.2em] text-white outline-none" />
                    <button type="button" onClick={() => void redeem()} disabled={busy || !code.trim()} className="mt-3 min-h-12 w-full rounded-md bg-[#ef2f82] font-black text-white disabled:opacity-50">{busy ? "Checking…" : "Confirm Encounter"}</button>
                  </div>
                )}
                {feedback && <p className={`mt-4 text-sm font-black ${feedback.includes("✓") ? "text-emerald-300" : "text-amber-200"}`}>{feedback}</p>}
              </div>
            ) : <p className="text-sm font-bold text-zinc-300">Joining Find Your Pack…</p>
          ) : isConnection ? (
            <div className="text-center">
              {mission.description && <p className="mx-auto max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mission.description}</p>}
              {connectionState ? (
                <>
                  <p className="mt-4 text-4xl font-black text-pink-300">
                    {Math.min(connectionState.progress, connectionState.target_connections)} / {connectionState.target_connections}
                  </p>
                  <p className="mt-1 text-sm font-black text-purple-200">
                    {connectionState.target_connections === 1 ? "new person met" : "new people met"}
                  </p>
                  {connectionState.completed ? (
                    <div className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4">
                      <p className="text-xl font-black text-emerald-300">MISSION COMPLETE</p>
                      <p className="mt-1 text-sm text-emerald-100">You met {connectionState.target_connections} new {connectionState.target_connections === 1 ? "person" : "people"} on PartyUp.</p>
                    </div>
                  ) : (
                    <Link href="/connect" className="mt-5 inline-flex min-h-12 items-center rounded-md bg-[#9146ff] px-5 font-black text-white hover:bg-[#7b31e8]">
                      Open PartyUp Connect
                    </Link>
                  )}
                </>
              ) : <p className="mt-4 text-sm font-bold text-zinc-300">Loading verified connection progress...</p>}
              {mission.can_manage && <p className="mt-3 text-sm font-bold text-zinc-400">{mission.completion_count} completed</p>}
            </div>
          ) : isWild ? (
            <div className="text-center">
              {mission.description && <p className="mx-auto max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mission.description}</p>}
              <p className="mt-3 text-sm font-black text-fuchsia-200">+{mission.config.influence_reward ?? 0} faction influence</p>
              <Link href={`/room/${roomId}/wild`} className="mt-5 inline-flex min-h-12 items-center rounded-md bg-fuchsia-600 px-5 font-black text-white hover:bg-fuchsia-500">Open Into the Wild</Link>
              {mission.can_manage && <p className="mt-3 text-sm font-bold text-zinc-400">{mission.completion_count} completed</p>}
            </div>
          ) : (
            <>
              {mission.description && <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mission.description}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void markComplete()} disabled={busy || mission.viewer_completed || Boolean(remaining?.expired)} className={`min-h-11 rounded-md px-5 text-sm font-black text-white disabled:cursor-not-allowed ${mission.viewer_completed ? "bg-emerald-700" : "bg-[#ef2f82] hover:bg-[#d92773] disabled:opacity-50"}`}>{mission.viewer_completed ? "Completed" : busy ? "Completing..." : "Mark Complete"}</button>
                {mission.can_manage && <span className="text-sm font-bold text-zinc-400">{mission.completion_count} completed</span>}
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm font-bold text-red-300">{error}</p>}
        </div>
      )}
    </section>
  );
}
