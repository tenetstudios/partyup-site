"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createSupabaseClient } from "@/lib/supabase";
import { createGuestSession, ensurePartyUpIdentity, getOrCreateEventMatchPool, readStoredGuestSession } from "@/lib/matchmaking";
import { claimMemoryMissionCompletion, verifyMemoryMissionCompletion } from "@/lib/roomMissions";
import { beginWildSquad, completeWildMission, createWildEncounterToken, createWildSquadToken, enterWildGame, getMyWildSquadMissionState, getMyWildSquadState, getWildEncounterState, getWildMatchState, getWildRoomState, redeemWildEncounterToken, redeemWildSquadToken, wildFactionByKey, type WildEncounterState, type WildEncounterStatus, type WildMatchState, type WildRoomState, type WildSquadFormationStatus, type WildSquadMissionState, type WildSquadState } from "@/lib/wild";

function formatCountdown(endsAt: string | null, now: number) {
  if (!endsAt) return "No time limit";
  const seconds = Math.ceil((Date.parse(endsAt) - now) / 1000);
  if (seconds <= 0) return "MISSION EXPIRED";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`;
}

const encounterMessages: Record<WildEncounterStatus, string> = {
  valid: "Verified encounter ✓", self_scan: "You can't scan yourself.", wrong_mission: "This code belongs to another Mission.", wrong_game: "This player isn't in this Wild game.", wrong_room: "This code belongs to another room.", wrong_faction: "This objective belongs to another faction.", wrong_animal: "That player is in another Animal Pack.", same_faction_required: "Find someone from your own faction.", different_faction_required: "Find someone from another faction.", specific_faction_required: "That player isn't in the required faction.", duplicate: "You've already verified with this player for this Mission.", expired: "That code expired. Ask them to refresh it.", mission_ended: "This Mission is no longer active.", game_ended: "The Wild has ended.", invalid: "That temporary Mission code isn't valid.",
};

const squadMessages: Record<WildSquadFormationStatus, string> = {
  ...encounterMessages,
  valid: "Squad verification accepted ✓",
  duplicate: "You already verified with this player for squad formation.",
  wrong_faction: "Squads can only include members of your faction.",
  already_in_squad: "That player already belongs to another squad.",
  squad_full: "This squad already has 5 members.",
};

export default function WildClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createSupabaseClient());
  const [state, setState] = useState<WildRoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [memoryUploading, setMemoryUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [encounterState, setEncounterState] = useState<WildEncounterState | null>(null);
  const [matchState, setMatchState] = useState<WildMatchState | null>(null);
  const [squad, setSquad] = useState<WildSquadState | null>(null);
  const [squadMissionState, setSquadMissionState] = useState<WildSquadMissionState | null>(null);
  const [squadMode, setSquadMode] = useState<"details" | "qr" | "code">("details");
  const [squadToken, setSquadToken] = useState<{ qr_payload: string; short_code: string; expires_at: string } | null>(null);
  const [squadCode, setSquadCode] = useState("");
  const [squadFeedback, setSquadFeedback] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [encounterMode, setEncounterMode] = useState<"details" | "qr" | "code">("details");
  const [encounterToken, setEncounterToken] = useState<{ qr_payload: string; short_code: string; expires_at: string } | null>(null);
  const [encounterCode, setEncounterCode] = useState("");
  const [encounterFeedback, setEncounterFeedback] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const controllersRef = useRef<Record<string, string | null>>({});
  const loadedRef = useRef(false);

  const ensureGuestToken = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    let token = readStoredGuestSession()?.guestToken ?? null;
    if (!data.user && !token) token = (await createGuestSession(supabase)).guestToken;
    return token;
  }, [supabase]);

  const load = useCallback(async (guestToken?: string | null) => {
    const token = guestToken ?? readStoredGuestSession()?.guestToken ?? null;
    const next = await getWildRoomState(supabase, roomId, token);
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
    if (next.assignment && next.game) {
      setSquad(await getMyWildSquadState(supabase, next.game.id, token));
    } else {
      setSquad(null);
    }
    if (next.assignment && next.mission?.config.scope === "squad") {
      setSquadMissionState(await getMyWildSquadMissionState(supabase, next.mission.id, token));
    } else {
      setSquadMissionState(null);
    }
    if (next.assignment && next.mission?.config.scope !== "squad" && next.mission?.config.verification_type === "encounter") {
      setEncounterState(await getWildEncounterState(supabase, next.mission.id, token));
    } else {
      setEncounterState(null);
      setEncounterMode("details");
    }
    if (next.assignment && next.mission?.config.scope !== "squad" && next.mission?.config.verification_type === "match_faction") {
      setMatchState(await getWildMatchState(supabase, next.mission.id, token));
    } else {
      setMatchState(null);
    }
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
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_match_verifications" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squads" }, refreshGame)
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_members" }, () => void load())
        .on("postgres_changes", { event: "*", schema: "public", table: "wild_squad_mission_completions" }, () => void load())
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
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!capture) return;
    const timer = window.setTimeout(() => setCapture(null), 3200);
    return () => window.clearTimeout(timer);
  }, [capture]);

  const encounterMissionId = state?.mission?.config.verification_type === "encounter" ? state.mission.id : null;

  useEffect(() => {
    if (encounterMode !== "qr" || !encounterMissionId) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      try {
        const token = await ensureGuestToken();
        const next = await createWildEncounterToken(supabase, encounterMissionId, token);
        if (cancelled) return;
        setEncounterToken(next);
        refreshTimer = window.setTimeout(() => void refresh(), Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not create a temporary encounter code."); }
    };
    void refresh();
    return () => { cancelled = true; if (refreshTimer) window.clearTimeout(refreshTimer); };
  }, [encounterMissionId, encounterMode, ensureGuestToken, supabase]);

  const squadGameId = state?.game?.status === "active" && state.assignment ? state.game.id : null;

  useEffect(() => {
    if (squadMode !== "qr" || !squadGameId || squad?.can_add_members === false) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      try {
        const token = await ensureGuestToken();
        await beginWildSquad(supabase, squadGameId, token);
        const next = await createWildSquadToken(supabase, squadGameId, token);
        if (cancelled) return;
        setSquadToken(next);
        refreshTimer = window.setTimeout(() => void refresh(), Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not create a temporary squad code."); }
    };
    void refresh();
    return () => { cancelled = true; if (refreshTimer) window.clearTimeout(refreshTimer); };
  }, [ensureGuestToken, squad, squadGameId, squadMode, supabase]);

  async function startSquad() {
    if (!state?.game) return;
    setBusy(true); setError(null);
    try {
      const token = await ensureGuestToken();
      await beginWildSquad(supabase, state.game.id, token);
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not begin squad formation."); }
    finally { setBusy(false); }
  }

  async function redeemSquad() {
    if (!state?.game || !squadCode.trim()) return;
    setBusy(true); setError(null); setSquadFeedback(null);
    try {
      const token = await ensureGuestToken();
      const result = await redeemWildSquadToken(supabase, state.game.id, squadCode.trim(), token);
      setSquadFeedback(squadMessages[result.status]);
      setSquadCode("");
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify this squad member."); }
    finally { setBusy(false); }
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
      if (state.mission.config.verification_type === "memory_upload") {
        await claimMemoryMissionCompletion(supabase, state.mission.id);
        await load();
      } else {
        const token = await ensureGuestToken();
        await completeWildMission(supabase, state.mission.id, token);
        await load(token);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this Wild Mission."); }
    finally { setBusy(false); }
  }

  async function uploadMissionMemory(file: File | null) {
    if (!file || !state?.mission || memoryUploading) return;
    setMemoryUploading(true); setError(null);
    let uploadedPath: string | null = null;
    let memoryCreated = false;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Sign in to upload and verify a Mission Memory.");

      const mediaType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
      if (!mediaType) throw new Error("Choose a photo or video file.");
      const requiredType = state.mission.config.required_media_type ?? "any";
      if (requiredType !== "any" && mediaType !== requiredType) {
        throw new Error(requiredType === "image" ? "This Mission requires a photo." : "This Mission requires a video.");
      }
      const sizeLimit = mediaType === "image" ? 12 * 1024 * 1024 : 50 * 1024 * 1024;
      if (file.size > sizeLimit) throw new Error(mediaType === "image" ? "Photos must be 12 MB or smaller." : "Videos must be 50 MB or smaller.");

      const identity = await ensurePartyUpIdentity(supabase);
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      uploadedPath = `${roomId}/${identity.id}/${Date.now()}-${cleanName}`;
      const { error: uploadError } = await supabase.storage.from("room-memories").upload(uploadedPath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);

      const { data: memory, error: insertError } = await supabase.from("room_memories").insert({
        room_id: roomId,
        uploader_identity_id: identity.id,
        media_type: mediaType,
        media_path: uploadedPath,
      }).select("id").single<{ id: string }>();
      if (insertError) throw new Error(insertError.message);
      memoryCreated = true;

      await verifyMemoryMissionCompletion(supabase, state.mission.id, memory.id);
      await load();
    } catch (reason) {
      if (uploadedPath && !memoryCreated) await supabase.storage.from("room-memories").remove([uploadedPath]);
      const detail = reason instanceof Error ? reason.message : "Could not upload this Memory.";
      setError(memoryCreated ? `Memory uploaded, but Mission verification failed: ${detail}` : detail);
    } finally {
      setMemoryUploading(false);
    }
  }

  async function redeemEncounter() {
    if (!state?.mission || !encounterCode.trim()) return;
    setBusy(true); setError(null); setEncounterFeedback(null);
    try {
      const token = await ensureGuestToken();
      const result = await redeemWildEncounterToken(supabase, state.mission.id, encounterCode.trim(), token);
      setEncounterFeedback(encounterMessages[result.status]);
      setEncounterCode("");
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify this encounter."); }
    finally { setBusy(false); }
  }

  async function startEventMatch() {
    setBusy(true); setError(null);
    try {
      const pool = await getOrCreateEventMatchPool(supabase, roomId);
      router.push(`/match?pool=${encodeURIComponent(pool.poolId)}&roomId=${encodeURIComponent(roomId)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this event's Match pool.");
      setBusy(false);
    }
  }

  if (!state) return <main className="mx-auto max-w-4xl p-6 text-white">Loading the Wild…</main>;
  if (!state.game) return <main className="mx-auto max-w-4xl p-6 text-white"><Link href={`/room/${roomId}`} className="text-purple-300">← Back to room</Link><h1 className="mt-8 text-4xl font-black">THE WILD IS QUIET</h1><p className="mt-3 text-zinc-400">The host has not started Into the Wild.</p></main>;

  const factions = state.game.config.factions;
  const winners = state.game.winner_summary?.winners ?? [];
  const assignmentScore = state.assignment
    ? state.game.winner_summary?.scores.find((score) => score.faction_key === state.assignment?.key) ?? null
    : null;
  const assignmentWon = Boolean(
    state.assignment && winners.some((winner) => winner.faction_key === state.assignment?.key),
  );
  const encounterRequirement = state.mission?.config.encounter_relationship === "same_faction" ? `Meet another ${state.assignment?.emoji ?? ""} ${state.assignment?.label ?? "faction"} player.` : state.mission?.config.encounter_relationship === "different_faction" ? "Meet a player from another faction." : state.mission?.config.encounter_relationship === "specific_faction" ? `Meet a ${wildFactionByKey(state, state.mission.config.target_faction)?.emoji ?? ""} ${wildFactionByKey(state, state.mission.config.target_faction)?.label ?? "specific faction"} player.` : null;
  const isSquadMission = state.mission?.config.scope === "squad";
  const isFormSquadMission = state.mission?.config.verification_type === "form_squad";
  const missionEligible = isSquadMission ? Boolean(squadMissionState?.eligible) : Boolean(state.mission?.eligible);
  const missionCompleted = isSquadMission ? Boolean(squadMissionState?.completed) : Boolean(state.mission?.viewer_completed);

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
            {state.assignment && <div className={`mt-6 rounded-xl border px-5 py-4 ${assignmentWon ? "border-emerald-300/35 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]"}`}><p className={`text-xs font-black tracking-[0.18em] ${assignmentWon ? "text-emerald-300" : "text-zinc-400"}`}>{assignmentWon ? "YOUR FACTION WON" : "YOUR FACTION"}</p><p className="mt-2 text-xl font-black">{state.assignment.emoji} {state.assignment.label.toUpperCase()}</p>{assignmentScore && <p className="mt-2 text-sm text-zinc-300">{assignmentScore.territories_controlled} {assignmentScore.territories_controlled === 1 ? "territory" : "territories"} controlled · {assignmentScore.total_influence} final influence</p>}</div>}
          </section>
        ) : state.assignment ? (
          <section className="mt-7 rounded-2xl border border-white/10 bg-black/35 p-5"><p className="text-xs font-black text-zinc-400">YOUR FACTION</p><p className="mt-2 text-3xl font-black">{state.assignment.emoji} {state.assignment.label.toUpperCase()}</p></section>
        ) : (
          <section className="mt-7 rounded-2xl border border-fuchsia-300/30 bg-black/35 p-6"><p className="font-black">Get your faction. Complete Missions. Help your side take the map.</p><button type="button" onClick={() => void enter()} disabled={busy || state.room_closed} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Entering…" : "Enter the Wild"}</button></section>
        )}

        {state.assignment && squad && !isFormSquadMission && (
          <section className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-950/10 p-5">
            <p className="text-xs font-black tracking-[0.2em] text-emerald-300">YOUR SQUAD</p>
            <h2 className="mt-2 text-2xl font-black">{state.assignment.emoji} {squad.label}</h2>
            <div className="mt-3 flex flex-wrap gap-2">{squad.members.map((member) => <span key={member.identity_id} className="rounded-full bg-white/[0.07] px-3 py-1.5 text-sm font-bold">{member.display_name}{member.is_you ? " (you)" : ""}</span>)}</div>
            <p className="mt-3 text-sm font-bold text-zinc-300">{squad.member_count} {squad.member_count === 1 ? "member" : "members"}</p>
            {squad.status === "active" && <p className="mt-2 font-black text-emerald-300">SQUAD FORMED ✓</p>}
          </section>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {state.territories.map((territory) => {
            const controller = wildFactionByKey(state, territory.controlling_faction);
            const total = Object.values(territory.influence).reduce((sum, amount) => sum + amount, 0);
            return <article key={territory.id} className="rounded-2xl border border-purple-300/20 bg-black/40 p-5"><h2 className="text-xl font-black">{territory.display_name.toUpperCase()}</h2><div className="mt-4 space-y-2">{factions.map((faction) => { const amount = territory.influence[faction.key] ?? 0; return <div key={faction.key}><div className="flex justify-between text-sm font-black"><span>{faction.emoji} {faction.label}</span><span>{amount}</span></div>{total > 0 && <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full rounded" style={{ width: `${(amount / total) * 100}%`, backgroundColor: faction.color ?? "#d946ef" }} /></div>}</div>; })}</div><p className="mt-5 text-xs font-black uppercase text-zinc-400">{controller ? `Controlled by ${controller.emoji} ${controller.label}` : "Contested"}</p></article>;
          })}
        </section>

        {state.assignment && state.game.status === "active" && (
          <section className="mt-8 rounded-2xl border border-fuchsia-300/25 bg-black/35 p-5">
            <p className="text-xs font-black tracking-[0.2em] text-fuchsia-300">YOUR MISSION</p>
            {state.mission ? <>
              <h2 className="mt-3 text-2xl font-black">{state.mission.title}</h2>
              {state.mission.description && <p className="mt-2 text-zinc-300">{state.mission.description}</p>}
              <p className="mt-3 text-sm font-black text-purple-200">+{state.mission.config.influence_reward} influence · {state.territories.find((item) => item.key === state.mission?.config.territory_key)?.display_name}</p>
              <p className="mt-2 text-sm font-black text-zinc-300">{formatCountdown(state.mission.ends_at, now)}</p>
              {isSquadMission && !isFormSquadMission && <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-950/20 p-4"><p className="text-xs font-black tracking-[0.18em] text-emerald-300">SQUAD MISSION · AGGREGATE</p>{squadMissionState?.eligible ? <><p className="mt-2 text-3xl font-black">{Math.min(squadMissionState.progress, squadMissionState.required_progress)} / {squadMissionState.required_progress}</p><p className="mt-1 text-sm text-zinc-300">Your contribution: {squadMissionState.personal_progress} verified {squadMissionState.personal_progress === 1 ? "action" : "actions"}</p></> : <p className="mt-2 text-sm font-bold text-amber-300">Form an active 3–5 player squad in the eligible faction to contribute.</p>}</div>}
              {isFormSquadMission ? (
                <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-950/20 p-4">
                  {state.mission.eligible ? squad ? <>
                    <p className="text-xs font-black tracking-[0.18em] text-emerald-300">FORM A SQUAD</p>
                    <h3 className="mt-2 text-xl font-black">{state.assignment.emoji} {squad.label}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">{squad.members.map((member) => <span key={member.identity_id} className="rounded-full bg-white/[0.07] px-3 py-1.5 text-sm font-bold">{member.display_name}{member.is_you ? " (you)" : ""}</span>)}</div>
                    <p className="mt-3 text-3xl font-black text-emerald-300">{Math.min(squad.formation_progress, 2)} / 2</p>
                    {missionCompleted ? <p className="mt-3 font-black text-emerald-300">SQUAD FORMED ✓ Influence awarded.</p> : squad.status === "active" ? <p className="mt-3 text-sm font-black text-amber-300">Your squad was already formed before this Mission began.</p> : <>
                      <p className="mt-2 text-sm font-bold text-zinc-300">Find {squad.members_needed} more same-faction {squad.members_needed === 1 ? "player" : "players"}.</p>
                      {squad.can_add_members && <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setSquadMode("qr")} className="rounded-lg bg-emerald-700 px-5 py-3 font-black">Show My Code</button><button type="button" onClick={() => setSquadMode("code")} className="rounded-lg bg-fuchsia-600 px-5 py-3 font-black">Scan Player</button></div>}
                    </>}
                  </> : <>
                    <p className="font-black">Find 2 other members of your faction.</p>
                    <p className="mt-2 text-3xl font-black text-emerald-300">0 / 2</p>
                    <button type="button" onClick={() => void startSquad()} disabled={busy} className="mt-4 rounded-lg bg-emerald-700 px-5 py-3 font-black disabled:opacity-50">{busy ? "Starting…" : "Form a Squad"}</button>
                  </> : <p className="text-sm font-black text-amber-300">This objective belongs to another faction.</p>}
                  {squadMode === "qr" && squad?.can_add_members && <div className="mt-5 w-fit rounded-xl bg-white p-5 text-center text-black">{squadToken ? <><QRCodeSVG value={squadToken.qr_payload} size={220} level="M" /><p className="mt-4 text-2xl font-black tracking-[0.25em]">{squadToken.short_code}</p><p className="mt-2 text-xs font-bold text-zinc-500">Same-faction players scan this temporary code</p></> : <p className="font-bold">Creating secure code…</p>}</div>}
                  {squadMode === "code" && squad?.can_add_members && <div className="mt-5 max-w-sm"><input value={squadCode} onChange={(event) => setSquadCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void redeemSquad(); }} maxLength={64} placeholder="F7K2A1B9" className="w-full rounded bg-black px-4 py-3 text-center text-xl font-black uppercase tracking-[0.2em] text-white" /><button type="button" onClick={() => void redeemSquad()} disabled={busy || !squadCode.trim()} className="mt-3 w-full rounded bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Checking…" : "Verify Squad Member"}</button></div>}
                  {squadFeedback && <p className={`mt-4 text-sm font-black ${squadFeedback.includes("✓") ? "text-emerald-300" : "text-amber-300"}`}>{squadFeedback}</p>}
                </div>
              ) : state.mission.config.verification_type === "match_faction" ? (
                <div className="mt-4">
                  <p className="font-black text-white">Match with unique players from opposing factions.</p>
                  {!isSquadMission && (matchState?.eligible ? <p className="mt-2 text-3xl font-black text-fuchsia-300">{Math.min(matchState.progress, matchState.required_matches)} / {matchState.required_matches}</p> : <p className="mt-3 text-sm font-black text-amber-300">This objective belongs to another faction.</p>)}
                  {(isSquadMission ? squadMissionState?.completed : matchState?.completed) ? <p className="mt-4 font-black text-emerald-300">MISSION COMPLETE ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</p> : (isSquadMission ? squadMissionState?.eligible : matchState?.eligible) && <button type="button" onClick={() => void startEventMatch()} disabled={busy || !(isSquadMission ? squadMissionState?.mission_active : matchState?.mission_active)} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Opening Match…" : "Match with people here"}</button>}
                </div>
              ) : state.mission.config.verification_type === "memory_upload" ? (
                <div className="mt-4">
                  <p className="font-black text-white">Requirement: {state.mission.config.required_media_type === "image" ? "Upload a new photo." : state.mission.config.required_media_type === "video" ? "Upload a new video." : "Upload a new photo or video."}</p>
                  {!missionEligible ? <p className="mt-3 text-sm font-black text-amber-300">{isSquadMission ? "An active eligible squad is required." : "This objective belongs to another faction."}</p> : missionCompleted ? <p className="mt-4 font-black text-emerald-300">MEMORY VERIFIED ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</p> : <div className="mt-4 flex flex-wrap gap-3">
                    <label className={`inline-flex cursor-pointer items-center rounded-lg bg-fuchsia-600 px-5 py-3 font-black ${memoryUploading || busy ? "pointer-events-none opacity-50" : ""}`}>
                      {memoryUploading ? "Uploading…" : state.mission.config.required_media_type === "image" ? "Upload Photo" : state.mission.config.required_media_type === "video" ? "Upload Video" : "Upload Memory"}
                      <input
                        type="file"
                        className="sr-only"
                        accept={state.mission.config.required_media_type === "image" ? "image/*" : state.mission.config.required_media_type === "video" ? "video/mp4,video/quicktime,video/webm" : "image/*,video/mp4,video/quicktime,video/webm"}
                        disabled={memoryUploading || busy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          event.currentTarget.value = "";
                          void uploadMissionMemory(file);
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => void complete()} disabled={busy || memoryUploading} className="rounded-lg bg-purple-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Checking…" : "Complete Mission"}</button>
                  </div>}
                </div>
              ) : state.mission.config.verification_type === "encounter" ? (
                <div className="mt-4">
                  <p className="font-black text-white">Requirement: {encounterRequirement}</p>
                  {!isSquadMission && (encounterState?.eligible ? <p className="mt-2 text-3xl font-black text-fuchsia-300">{Math.min(encounterState.progress, encounterState.required_encounters)} / {encounterState.required_encounters}</p> : <p className="mt-2 text-sm font-black text-amber-300">You can help an eligible player by showing your QR.</p>)}
                  {(isSquadMission ? squadMissionState?.completed : encounterState?.completed) ? <p className="mt-4 font-black text-emerald-300">VERIFIED ✓ {isSquadMission ? "One squad reward awarded." : "Influence awarded."}</p> : <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setEncounterMode("qr")} className="rounded-lg bg-purple-600 px-5 py-3 font-black">Show My QR</button>{(isSquadMission ? squadMissionState?.eligible : encounterState?.eligible) && <button type="button" onClick={() => setEncounterMode("code")} className="rounded-lg bg-fuchsia-600 px-5 py-3 font-black">Enter Player Code</button>}</div>}
                  {encounterMode === "qr" && <div className="mt-5 w-fit rounded-xl bg-white p-5 text-center text-black">{encounterToken ? <><QRCodeSVG value={encounterToken.qr_payload} size={220} level="M" /><p className="mt-4 text-2xl font-black tracking-[0.25em]">{encounterToken.short_code}</p><p className="mt-2 text-xs font-bold text-zinc-500">Refreshes every 60 seconds</p></> : <p className="font-bold">Creating secure code…</p>}</div>}
                  {encounterMode === "code" && (isSquadMission ? squadMissionState?.eligible : encounterState?.eligible) && <div className="mt-5 max-w-sm"><input value={encounterCode} onChange={(event) => setEncounterCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void redeemEncounter(); }} maxLength={64} placeholder="F7K2A1B9" className="w-full rounded bg-black px-4 py-3 text-center text-xl font-black uppercase tracking-[0.2em] text-white" /><button type="button" onClick={() => void redeemEncounter()} disabled={busy || !encounterCode.trim()} className="mt-3 w-full rounded bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Checking…" : "Verify Encounter"}</button></div>}
                  {encounterFeedback && <p className={`mt-4 text-sm font-black ${encounterFeedback.includes("✓") ? "text-emerald-300" : "text-amber-300"}`}>{encounterFeedback}</p>}
                </div>
              ) : state.mission.config.verification_type === "live_node" ? <div className="mt-4"><p className="font-black">Find and claim the active Live Node. Any squad member can complete this objective.</p>{missionCompleted && <p className="mt-4 font-black text-emerald-300">NODE CLAIMED ✓ One squad reward awarded.</p>}</div> : !state.mission.eligible ? <p className="mt-4 text-sm font-black text-amber-300">This objective belongs to another faction.</p> : state.mission.viewer_completed ? <p className="mt-4 font-black text-emerald-300">✓ Mission complete. Influence added.</p> : <button type="button" onClick={() => void complete()} disabled={busy} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-50">{busy ? "Completing…" : "Complete Mission"}</button>}
            </> : <p className="mt-3 text-zinc-400">No active Mission right now.</p>}
          </section>
        )}

        {state.assignment && <section className="mt-8 rounded-2xl border border-white/10 bg-black/35 p-5"><p className="text-xs font-black tracking-[0.2em] text-purple-300">YOUR IMPACT</p><div className="mt-4 flex gap-8"><div><p className="text-3xl font-black">{state.impact.missions_completed}</p><p className="text-sm text-zinc-400">Missions completed</p></div><div><p className="text-3xl font-black">+{state.impact.influence_added}</p><p className="text-sm text-zinc-400">Influence added</p></div></div></section>}
        {error && <p className="mt-5 rounded-lg bg-rose-950/40 p-3 text-sm font-bold text-rose-300">{error}</p>}
      </div>
    </main>
  );
}
