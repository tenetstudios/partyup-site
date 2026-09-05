"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BALLOON_TYPES,
  GLUE_COST,
  MAX_FRAME_DELTA_SECONDS,
  MAX_LAUNCH_QUEUE_SIZE,
  NAIL_STRIP_COST,
  SIMULATION_STEP_SECONDS,
  VERTICAL_WALL_COST,
  WALL_REPAIR_AMOUNT,
  WALL_REPAIR_COST,
  WALL_REPAIR_THRESHOLD,
  createWallSegment,
  findBalloonAtPoint,
  findClosestGridEdge,
  getCurrentWaveRound,
  getWaveRound,
  updateFloatMatch,
  validateGluePlacement,
  validateNailPlacement,
  validateWallPlacement,
  type BalloonRoom,
  type BalloonType,
  type FloatMatchState,
  type SpawnLane,
  type WallSegment,
} from "@partyup/balloon-core";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  FLOAT_REALTIME_PROTOCOL_VERSION,
  FLOAT_MAX_ACTIONS_PER_SECOND,
  FLOAT_MAX_RESEND_ACTIONS,
  FloatRealtimeTimeline,
  FloatSequenceInbox,
  floatActorTopic,
  floatHashCoordinateKey,
  hashFloatState,
  simulationTimeMsToTick,
  validateFloatRealtimeAction,
  type FloatActionAck,
  type FloatActionRequest,
  type FloatHashCoordinates,
  type FloatHashReport,
  type FloatRealtimeAction,
} from "@partyup/float-realtime-protocol";
import { drawBalloonRoom, type WallPreview } from "@/lib/balloonRooms/rendering";
import {
  FLOAT_CORE_VERSION,
  FLOAT_POOL_HEARTBEAT_MS,
  FLOAT_RECONNECT_AFTER_MS,
  FLOAT_SYNC_INTERVAL_MS,
  cancelFloatPool,
  checkpointFloatRealtimeMatch,
  createFloatNetworkMatch,
  getFloatPoolStatus,
  heartbeatFloatNetworkMatch,
  joinFloatPool,
  joinFloatNetworkMatch,
  playerIdForUser,
  persistFloatRealtimeActions,
  readyFloatNetworkMatch,
  recoverFloatRealtimeMatch,
  type FloatActionIntent,
  type FloatMatchRow,
  type FloatPlayerId,
  type FloatPoolMode,
} from "@/lib/floatMultiplayer";
import { isNewerGameplaySnapshot } from "@/lib/floatMultiplayerState";
import { createSupabaseClient } from "@/lib/supabase";
import { readActiveRoomContext } from "@/lib/activeRoomContext";
import { Coin, FloatHeader, FloatIcon, LanePicker, RoomHeader } from "../FloatVisuals";
import styles from "../BalloonRooms.module.css";

type ViewKey = "yours" | "opponent";
type BuildMode = "wall" | "nails" | "glue" | "remove";
type CanvasCollection = Record<ViewKey, HTMLCanvasElement | null>;
const viewKeys: ViewKey[] = ["yours", "opponent"];

function cloneState(state: FloatMatchState) {
  return structuredClone(state);
}

function roomSummary(room: BalloonRoom, simulationTimeMs: number) {
  return {
    health: room.health,
    balloons: room.balloons.length,
    coins: room.economy.coins,
    income: room.economy.income,
    nextIncomeInMs: Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs),
    walls: room.walls.map((wall) => ({ ...wall })),
    nails: room.nailStrips.length,
    glue: room.glueTraps.length,
    queue: room.attack.queue.map((item) => ({ balloonType: item.balloonType, lane: item.lane })),
    unlocked: { ...room.unlockedBalloonTypes },
  };
}

export default function NetworkBalloonRoomsClient({ initialCode, initialRoomId }: { initialCode: string; initialRoomId: string | null }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [matchRow, setMatchRow] = useState<FloatMatchRow | null>(null);
  const matchRef = useRef<FloatMatchState | null>(null);
  const timelineRef = useRef<FloatRealtimeTimeline | null>(null);
  const [snapshot, setSnapshot] = useState<FloatMatchState | null>(null);
  const [code, setCode] = useState(initialCode.replace(/[^A-Z2-9]/g, "").slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [poolMode, setPoolMode] = useState<FloatPoolMode | null>(null);
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [message, setMessage] = useState("Create a match or enter a six-character code.");
  const [lane, setLane] = useState<SpawnLane>(1);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [realtimeRecoveredMatchId, setRealtimeRecoveredMatchId] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const previewRef = useRef<WallPreview>(null);
  const holdRef = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const matchRowRef = useRef<FloatMatchRow | null>(null);
  const canonicalMatchRef = useRef<FloatMatchRow | null>(null);
  const busyRef = useRef(false);
  const realtimeChannelsRef = useRef<Partial<Record<FloatPlayerId, RealtimeChannel>>>({});
  const realtimeReadyRef = useRef(false);
  const realtimeSequenceRef = useRef(0);
  const realtimeInboxRef = useRef<Partial<Record<FloatPlayerId, FloatSequenceInbox>>>({});
  const realtimeJournalRef = useRef(new Map<number, FloatRealtimeAction>());
  const persistenceQueueRef = useRef<FloatRealtimeAction[]>([]);
  const persistenceTimerRef = useRef<number | null>(null);
  const checkpointRevisionRef = useRef(0);
  const stateHashesRef = useRef(new Map<string, string>());
  const remoteStateHashesRef = useRef(new Map<string, string>());
  const lastHashTickRef = useRef(-1);
  const mismatchRecoveryTickRef = useRef(-1);
  const recentActionTimesRef = useRef<number[]>([]);
  const recoveredMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate browser-only room context after mount
    if (!roomId) setRoomId(readActiveRoomContext()?.roomId ?? null);
  }, [roomId]);

  const reconcileFromCanonical = useCallback((targetTimeMs?: number) => {
    const canonical = canonicalMatchRef.current;
    if (!canonical) return;
    const state = cloneState(canonical.state);
    const target = Math.max(state.simulationTimeMs, targetTimeMs ?? matchRef.current?.simulationTimeMs ?? 0);
    while (state.status === "active" && state.simulationTimeMs + SIMULATION_STEP_SECONDS * 1_000 <= target) updateFloatMatch(state, SIMULATION_STEP_SECONDS);
    timelineRef.current = new FloatRealtimeTimeline(state);
    matchRef.current = state;
    setSnapshot(cloneState(state));
  }, []);

  const acceptMatch = useCallback((row: FloatMatchRow) => {
    const current = matchRowRef.current;
    if (current?.id === row.id && (
      row.state_revision < current.state_revision
      || (row.state_revision === current.state_revision && Date.parse(row.updated_at) < Date.parse(current.updated_at))
    )) return;
    const newMatch = current?.id !== row.id;
    if (newMatch) {
      setPendingCount(0);
      canonicalMatchRef.current = null;
      timelineRef.current = null;
      realtimeSequenceRef.current = 0;
      realtimeInboxRef.current = {};
      realtimeJournalRef.current.clear();
      persistenceQueueRef.current = [];
      checkpointRevisionRef.current = Number(row.checkpoint_revision ?? 0);
      stateHashesRef.current.clear();
      remoteStateHashesRef.current.clear();
      lastHashTickRef.current = -1;
      mismatchRecoveryTickRef.current = -1;
      recoveredMatchIdRef.current = null;
      setRealtimeRecoveredMatchId(null);
    }
    matchRowRef.current = row;
    setMatchRow(row);
    const canonicalRevision = canonicalMatchRef.current?.id === row.id ? canonicalMatchRef.current.state_revision : null;
    if (isNewerGameplaySnapshot(canonicalRevision, row.state_revision)) {
      const targetTimeMs = newMatch ? undefined : matchRef.current?.simulationTimeMs;
      canonicalMatchRef.current = row;
      reconcileFromCanonical(targetTimeMs);
    }
    window.localStorage.setItem("partyup_float_match_id", row.id);
  }, [reconcileFromCanonical]);

  const recover = useCallback(async (matchId: string) => {
    const { data, error } = await supabase.from("float_matches").select("*").eq("id", matchId).maybeSingle();
    if (error) throw error;
    if (data) acceptMatch(data as FloatMatchRow);
  }, [acceptMatch, supabase]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!live) return;
      const id = data.user?.id ?? null;
      setUserId(id);
      setAuthReady(true);
      if (!id) return;
      try {
        const pool = await getFloatPoolStatus();
        if (pool.status === "matched" && pool.match) acceptMatch(pool.match);
        else if (pool.status === "searching" && pool.entry) {
          setPoolMode(pool.entry.pool_mode);
          if (pool.entry.room_id) setRoomId(pool.entry.room_id);
          setMessage(pool.entry.pool_mode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP...");
        }
      } catch { /* A missing Phase 9 migration must not block private-code recovery. */ }
      const savedId = window.localStorage.getItem("partyup_float_match_id");
      if (savedId) {
        try { await recover(savedId); } catch { window.localStorage.removeItem("partyup_float_match_id"); }
      }
    };
    void load();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setAuthReady(true);
    });
    return () => { live = false; listener.subscription.unsubscribe(); };
  }, [acceptMatch, recover, supabase]);

  const matchId = matchRow?.id ?? null;
  const matchStatus = matchRow?.status ?? null;

  const acceptPoolResult = useCallback((result: Awaited<ReturnType<typeof getFloatPoolStatus>>) => {
    if (result.status === "matched" && result.match) {
      setPoolMode(null);
      setMessage("MATCH FOUND");
      acceptMatch(result.match);
    } else if (result.status === "expired") {
      setPoolMode(null);
      setMessage("Search expired. Try again.");
    }
  }, [acceptMatch]);

  useEffect(() => {
    if (!poolMode || !userId || matchId) return;
    const refresh = () => void getFloatPoolStatus().then(acceptPoolResult).catch((error) => setMessage(error.message));
    const channel = supabase.channel(`float-pool:${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "float_pool_entries", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    const interval = window.setInterval(refresh, FLOAT_POOL_HEARTBEAT_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); void supabase.removeChannel(channel); };
  }, [acceptPoolResult, matchId, poolMode, supabase, userId]);

  useEffect(() => {
    if (!matchId || !userId) return;
    const channel = supabase
      .channel(`float-match:${matchId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "float_matches", filter: `id=eq.${matchId}` }, (payload) => {
        acceptMatch(payload.new as FloatMatchRow);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [acceptMatch, matchId, supabase, userId]);

  useEffect(() => {
    if (!matchId || !userId || matchStatus === "complete" || matchStatus === "abandoned") return;
    let stopped = false;
    const sync = async () => {
      try {
        const result = await heartbeatFloatNetworkMatch(matchId);
        if (!stopped) acceptMatch(result.match);
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : "Float sync failed.");
      }
    };
    const interval = window.setInterval(() => void sync(), FLOAT_SYNC_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void sync(); };
    document.addEventListener("visibilitychange", onVisibility);
    void sync();
    return () => { stopped = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [acceptMatch, matchId, matchStatus, userId]);

  const playerId = matchRow && userId ? playerIdForUser(matchRow, userId) : null;
  const opponentId: FloatPlayerId | null = playerId === "playerA" ? "playerB" : playerId === "playerB" ? "playerA" : null;

  const recoverRealtime = useCallback(async (id: string, localPlayerId: FloatPlayerId) => {
    const previousTick = timelineRef.current?.currentTick ?? 0;
    const recovery = await recoverFloatRealtimeMatch(id);
    const baseState = recovery.match.checkpoint_state ?? recovery.match.state;
    const baseTick = recovery.match.checkpoint_state
      ? Number(recovery.match.checkpoint_tick)
      : simulationTimeMsToTick(baseState.simulationTimeMs);
    if (recovery.match.protocol_version !== FLOAT_REALTIME_PROTOCOL_VERSION || recovery.match.core_version !== FLOAT_CORE_VERSION) throw new Error("FLOAT UPDATE REQUIRED");
    if (recovery.match.checkpoint_state && recovery.match.checkpoint_hash) {
      const checkpointCoordinates: FloatHashCoordinates = {
        protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
        coreVersion: FLOAT_CORE_VERSION,
        simulationTick: baseTick,
        playerASequence: Number(recovery.match.player_a_checkpoint_sequence),
        playerBSequence: Number(recovery.match.player_b_checkpoint_sequence),
      };
      if (await hashFloatState(checkpointCoordinates, baseState) !== recovery.match.checkpoint_hash) throw new Error("Float checkpoint hash validation failed");
    }
    const timeline = new FloatRealtimeTimeline(baseState, baseTick);
    const cursors: Record<FloatPlayerId, number> = {
      playerA: Number(recovery.match.player_a_checkpoint_sequence ?? 0),
      playerB: Number(recovery.match.player_b_checkpoint_sequence ?? 0),
    };
    const inboxes: Record<FloatPlayerId, FloatSequenceInbox> = {
      playerA: new FloatSequenceInbox(cursors.playerA),
      playerB: new FloatSequenceInbox(cursors.playerB),
    };
    const ownJournal = new Map<number, FloatRealtimeAction>();
    let ownSequence = cursors[localPlayerId];
    for (const raw of recovery.actions) {
      const actor = raw.actorPlayerId;
      if (actor !== "playerA" && actor !== "playerB") continue;
      const action = validateFloatRealtimeAction(raw, { matchId: id, actorPlayerId: actor });
      const received = inboxes[actor].receive(action);
      for (const ready of received.ready) {
        if (ready.simulationTick > timeline.currentTick) timeline.advanceTo(ready.simulationTick);
        timeline.insert(ready);
      }
      if (actor === localPlayerId) {
        ownSequence = Math.max(ownSequence, action.clientSequence);
        ownJournal.set(action.clientSequence, action);
      }
    }
    const serverTick = recovery.match.started_at
      ? simulationTimeMsToTick(Math.max(0, Date.now() - Date.parse(recovery.match.started_at)))
      : timeline.currentTick;
    timeline.advanceTo(Math.max(previousTick, serverTick, timeline.currentTick));
    timelineRef.current = timeline;
    matchRef.current = timeline.state;
    realtimeInboxRef.current = inboxes;
    realtimeSequenceRef.current = ownSequence;
    realtimeJournalRef.current = ownJournal;
    checkpointRevisionRef.current = Number(recovery.match.checkpoint_revision ?? 0);
    matchRowRef.current = recovery.match;
    setMatchRow(recovery.match);
    setSnapshot(cloneState(timeline.state));
    setPendingCount(ownJournal.size);
    setMessage("Realtime state recovered.");
    setRealtimeRecoveredMatchId(id);
  }, []);

  useEffect(() => {
    if (!matchId || !playerId || matchStatus !== "active" || recoveredMatchIdRef.current === matchId) return;
    recoveredMatchIdRef.current = matchId;
    void recoverRealtime(matchId, playerId).catch((error) => {
      recoveredMatchIdRef.current = null;
      setMessage(error instanceof Error ? error.message : "Realtime recovery failed.");
    });
  }, [matchId, matchStatus, playerId, recoverRealtime]);

  useEffect(() => {
    if (!matchId || realtimeRecoveredMatchId !== matchId || !playerId || !opponentId || matchStatus !== "active") return;
    let closed = false;
    const joinedActors = new Set<FloatPlayerId>();
    let replayInterval: number | null = null;
    realtimeReadyRef.current = false;
    if (!realtimeInboxRef.current.playerA) realtimeInboxRef.current.playerA = new FloatSequenceInbox();
    if (!realtimeInboxRef.current.playerB) realtimeInboxRef.current.playerB = new FloatSequenceInbox();

    const send = (actor: FloatPlayerId, event: string, payload: object) => {
      const channel = realtimeChannelsRef.current[actor];
      if (!channel) return;
      void channel.send({ type: "broadcast", event, payload }).then((status) => {
        if (!closed && status !== "ok") setMessage(`Realtime ${event.toLowerCase()} failed (${status}).`);
      });
    };

    const receiveAction = (topicActor: FloatPlayerId, raw: unknown) => {
      try {
        const action = validateFloatRealtimeAction(raw, { matchId, actorPlayerId: topicActor });
        const inbox = realtimeInboxRef.current[topicActor];
        if (!inbox) return;
        const received = inbox.receive(action);
        for (const ready of received.ready) {
          const result = timelineRef.current?.insert(ready);
          if (result?.status === "too_old" || result?.status === "too_far_ahead") {
            void recoverRealtime(matchId, playerId).catch((error) => setMessage(error instanceof Error ? error.message : "Realtime recovery failed."));
            return;
          }
          else if (result?.status === "rejected") setMessage(result.result.message);
        }
        if (received.missing) {
          const request: FloatActionRequest = {
            protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
            type: "REQUEST_ACTIONS",
            actorPlayerId: topicActor,
            ...received.missing,
          };
          send(playerId, "protocol_control", request);
        }
        const ack: FloatActionAck = {
          protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
          type: "ACTION_ACK",
          actorPlayerId: topicActor,
          throughSequence: inbox.getThroughSequence(),
        };
        send(playerId, "protocol_control", ack);
      } catch (error) {
        if (error instanceof Error && /sequence gap/i.test(error.message)) void recoverRealtime(matchId, playerId).catch(() => undefined);
        if (!closed) setMessage(error instanceof Error ? error.message : "Invalid realtime action.");
      }
    };

    const connect = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw error ?? new Error("Float Realtime authentication is unavailable.");
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      for (const topicActor of ["playerA", "playerB"] as const) {
      const channel = supabase
        .channel(floatActorTopic(matchId, topicActor), { config: { private: true, broadcast: { ack: true, self: false } } })
        .on("broadcast", { event: "gameplay_action" }, ({ payload }) => receiveAction(topicActor, payload))
        .on("broadcast", { event: "action_replay" }, ({ payload }) => receiveAction(topicActor, payload))
        .on("broadcast", { event: "protocol_control" }, ({ payload }) => {
          if (!payload || typeof payload !== "object" || topicActor === playerId) return;
          const control = payload as Record<string, unknown>;
          if (control.type === "HASH_REPORT" && control.protocolVersion === FLOAT_REALTIME_PROTOCOL_VERSION && control.coreVersion === FLOAT_CORE_VERSION && control.actorPlayerId === topicActor && Number.isSafeInteger(control.simulationTick) && Number.isSafeInteger(control.playerASequence) && Number.isSafeInteger(control.playerBSequence) && typeof control.stateHash === "string") {
            const coordinates = control as FloatHashReport;
            const key = floatHashCoordinateKey(coordinates);
            const tick = coordinates.simulationTick;
            remoteStateHashesRef.current.set(key, coordinates.stateHash);
            const localHash = stateHashesRef.current.get(key);
            if (localHash && localHash !== coordinates.stateHash && mismatchRecoveryTickRef.current !== tick) {
              mismatchRecoveryTickRef.current = tick;
              void recoverRealtime(matchId, playerId).catch((error) => setMessage(error instanceof Error ? error.message : "Hash mismatch recovery failed."));
            }
            return;
          }
          if (control.protocolVersion !== FLOAT_REALTIME_PROTOCOL_VERSION || control.actorPlayerId !== playerId) return;
          if (control.type === "ACTION_ACK" && Number.isSafeInteger(control.throughSequence)) {
            for (const sequence of realtimeJournalRef.current.keys()) {
              if (sequence <= Number(control.throughSequence)) realtimeJournalRef.current.delete(sequence);
            }
            setPendingCount(realtimeJournalRef.current.size);
          } else if (control.type === "REQUEST_ACTIONS" && Number.isSafeInteger(control.fromSequence) && Number.isSafeInteger(control.toSequence)) {
            for (let sequence = Number(control.fromSequence); sequence <= Number(control.toSequence); sequence += 1) {
              const action = realtimeJournalRef.current.get(sequence);
              if (action) send(playerId, "action_replay", action);
            }
          }
        })
        .subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            joinedActors.add(topicActor);
            if (joinedActors.size === 2) {
              realtimeReadyRef.current = true;
              if (!closed) setMessage("Realtime connected.");
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            joinedActors.delete(topicActor);
            realtimeReadyRef.current = false;
            if (process.env.NODE_ENV === "development") console.error("[FLOAT REALTIME SUBSCRIBE FAILED]", { topicActor, status, error });
            if (!closed) setMessage(`Private Float realtime failed on ${topicActor}${error?.message ? `: ${error.message}` : "."}`);
          }
        });
      realtimeChannelsRef.current[topicActor] = channel;
      }
      replayInterval = window.setInterval(() => {
        if (!realtimeReadyRef.current) return;
        for (const action of realtimeJournalRef.current.values()) send(playerId, "action_replay", action);
      }, 500);
    };
    void connect().catch((error) => {
      if (!closed) setMessage(error instanceof Error ? error.message : "Float Realtime authentication failed.");
    });

    return () => {
      closed = true;
      if (replayInterval !== null) window.clearInterval(replayInterval);
      realtimeReadyRef.current = false;
      const channels = Object.values(realtimeChannelsRef.current);
      realtimeChannelsRef.current = {};
      for (const channel of channels) if (channel) void supabase.removeChannel(channel);
    };
  }, [matchId, matchStatus, opponentId, playerId, realtimeRecoveredMatchId, recoverRealtime, supabase]);

  useEffect(() => {
    if (!matchId || playerId !== "playerA" || matchStatus !== "active") return;
    let stopped = false;
    let running = false;
    const writeCheckpoint = async () => {
      if (running || stopped) return;
      const timeline = timelineRef.current;
      if (!timeline) return;
      running = true;
      const checkpoint = timeline.exportCheckpoint();
      try {
        const playerASequence = realtimeSequenceRef.current;
        const playerBSequence = realtimeInboxRef.current.playerB?.getThroughSequence() ?? 0;
        const coordinates: FloatHashCoordinates = { protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION, coreVersion: FLOAT_CORE_VERSION, simulationTick: checkpoint.simulationTick, playerASequence, playerBSequence };
        const stateHash = await hashFloatState(coordinates, checkpoint.state);
        const result = await checkpointFloatRealtimeMatch(matchId, {
          expectedRevision: checkpointRevisionRef.current,
          simulationTick: checkpoint.simulationTick,
          state: checkpoint.state,
          stateHash,
          playerASequence,
          playerBSequence,
        });
        if (!stopped) checkpointRevisionRef.current = Number(result.match.checkpoint_revision ?? checkpointRevisionRef.current);
      } catch (error) {
        if (!stopped && process.env.NODE_ENV === "development") console.error("[FLOAT CHECKPOINT DELAYED]", error);
      } finally {
        running = false;
      }
    };
    const interval = window.setInterval(() => void writeCheckpoint(), 2_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [matchId, matchStatus, playerId]);

  useEffect(() => {
    if (!playerId || !opponentId) return;
    let frameId = 0;
    let previous = performance.now();
    let accumulator = 0;
    let lastHud = previous;
    const frame = (timestamp: number) => {
      const state = matchRef.current;
      accumulator += Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (timestamp - previous) / 1000));
      previous = timestamp;
      if (state && matchRow?.status === "active") {
        while (accumulator >= SIMULATION_STEP_SECONDS) {
          const timeline = timelineRef.current;
          if (timeline && timeline.state === state) {
            timeline.advanceTo(timeline.currentTick + 1);
            if (timeline.currentTick > 0 && timeline.currentTick % 60 === 0 && lastHashTickRef.current !== timeline.currentTick) {
              const hashTick = timeline.currentTick;
              const hashState = cloneState(timeline.state);
              lastHashTickRef.current = hashTick;
              const coordinates: FloatHashCoordinates = {
                protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
                coreVersion: FLOAT_CORE_VERSION,
                simulationTick: hashTick,
                playerASequence: playerId === "playerA" ? realtimeSequenceRef.current : realtimeInboxRef.current.playerA?.getThroughSequence() ?? 0,
                playerBSequence: playerId === "playerB" ? realtimeSequenceRef.current : realtimeInboxRef.current.playerB?.getThroughSequence() ?? 0,
              };
              void hashFloatState(coordinates, hashState).then((stateHash) => {
                const key = floatHashCoordinateKey(coordinates);
                stateHashesRef.current.set(key, stateHash);
                const remoteHash = remoteStateHashesRef.current.get(key);
                if (remoteHash && remoteHash !== stateHash && mismatchRecoveryTickRef.current !== hashTick && matchId) {
                  mismatchRecoveryTickRef.current = hashTick;
                  void recoverRealtime(matchId, playerId).catch((error) => setMessage(error instanceof Error ? error.message : "Hash mismatch recovery failed."));
                }
                const channel = realtimeChannelsRef.current[playerId];
                if (channel) void channel.send({ type: "broadcast", event: "protocol_control", payload: { ...coordinates, type: "HASH_REPORT", actorPlayerId: playerId, stateHash } satisfies FloatHashReport });
              });
            }
          }
          else updateFloatMatch(state, SIMULATION_STEP_SECONDS);
          accumulator -= SIMULATION_STEP_SECONDS;
        }
        if (timestamp - lastHud >= 250) { lastHud = timestamp; setSnapshot(cloneState(state)); }
        const ids: Record<ViewKey, FloatPlayerId> = { yours: playerId, opponent: opponentId };
        for (const key of viewKeys) {
          const canvas = canvasesRef.current[key];
          if (canvas) drawBalloonRoom(canvas, state.players[ids[key]]!.room, ids[key], [], timestamp, {
            debugPaths: false,
            showGrid: canvas.dataset.placement === "true",
            preview: key === "yours" ? previewRef.current : null,
            selectedWallId: key === "yours" ? selectedWallId : null,
          });
        }
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [matchId, matchRow?.status, opponentId, playerId, recoverRealtime, selectedWallId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const runLobbyAction = async (action: () => Promise<{ match: FloatMatchRow }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await action();
      acceptMatch(result.match);
      setMessage("Match updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Float request failed.");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const startPool = async (mode: FloatPoolMode) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await joinFloatPool(mode, mode === "room" ? roomId : null);
      if (result.status === "matched" && result.match) acceptPoolResult(result);
      else { setPoolMode(mode); setMessage(mode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP..."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Float search failed."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const cancelPool = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await cancelFloatPool();
      if (result.status === "matched" && result.match) acceptPoolResult(result);
      else { setPoolMode(null); setMessage("Search cancelled."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not cancel search."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const closeMatch = () => {
    cancelHold();
    if (persistenceTimerRef.current !== null) window.clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = null;
    const actionsToPersist = persistenceQueueRef.current.splice(0);
    if (matchRowRef.current && actionsToPersist.length > 0) void persistFloatRealtimeActions(matchRowRef.current.id, actionsToPersist);
    window.localStorage.removeItem("partyup_float_match_id");
    matchRowRef.current = null;
    canonicalMatchRef.current = null;
    matchRef.current = null;
    timelineRef.current = null;
    setPendingCount(0);
    setRealtimeRecoveredMatchId(null);
    setMatchRow(null);
    setSnapshot(null);
    setSelectedWallId(null);
    setMessage("Create a match or enter a six-character code.");
  };

  const schedulePersistence = (delayMs = 250) => {
    if (persistenceTimerRef.current !== null) return;
    persistenceTimerRef.current = window.setTimeout(() => {
      persistenceTimerRef.current = null;
      const currentMatch = matchRowRef.current;
      const batch = persistenceQueueRef.current.splice(0, 100);
      if (!currentMatch || batch.length === 0) return;
      void persistFloatRealtimeActions(currentMatch.id, batch).then(() => {
        if (persistenceQueueRef.current.length > 0) schedulePersistence();
      }).catch((error) => {
        persistenceQueueRef.current.unshift(...batch);
        setMessage(error instanceof Error ? `Gameplay live; persistence delayed: ${error.message}` : "Gameplay live; persistence delayed.");
        schedulePersistence(1_000);
      });
    }, delayMs);
  };

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      const currentMatch = matchRowRef.current;
      const batch = persistenceQueueRef.current.splice(0, 100);
      if (currentMatch && batch.length > 0) void persistFloatRealtimeActions(currentMatch.id, batch).catch(() => persistenceQueueRef.current.unshift(...batch));
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const handleSendIntent = (intent: FloatActionIntent) => {
    const currentMatch = matchRowRef.current;
    const timeline = timelineRef.current;
    if (!currentMatch || !timeline || !playerId || currentMatch.status !== "active") return;
    // eslint-disable-next-line react-hooks/purity -- sampled only when an input handler invokes this function
    const actionNow = performance.now();
    recentActionTimesRef.current = recentActionTimesRef.current.filter((time) => actionNow - time < 1_000);
    if (recentActionTimesRef.current.length >= FLOAT_MAX_ACTIONS_PER_SECOND || realtimeJournalRef.current.size >= FLOAT_MAX_RESEND_ACTIONS) {
      setMessage("Realtime action rate exceeded; wait for peer acknowledgement.");
      return;
    }
    const channel = realtimeChannelsRef.current[playerId];
    if (!realtimeReadyRef.current || !channel) {
      setMessage(`Realtime is reconnecting; ${intent.actionType} was not applied.`);
      return;
    }
    const sequence = realtimeSequenceRef.current + 1;
    const action: FloatRealtimeAction = {
      protocolVersion: FLOAT_REALTIME_PROTOCOL_VERSION,
      matchId: currentMatch.id,
      actionId: crypto.randomUUID(),
      actorPlayerId: playerId,
      clientSequence: sequence,
      simulationTick: timeline.currentTick,
      actionType: intent.actionType,
      payload: intent.payload,
    };
    const result = timeline.insert(action);
    if (result.status !== "applied") {
      setMessage(result.status === "rejected" ? result.result.message : `${intent.actionType} rejected (${result.status}).`);
      return;
    }
    realtimeSequenceRef.current = sequence;
    recentActionTimesRef.current.push(actionNow);
    realtimeJournalRef.current.set(sequence, action);
    persistenceQueueRef.current.push(action);
    schedulePersistence();
    setPendingCount(realtimeJournalRef.current.size);
    matchRef.current = timeline.state;
    setSnapshot(cloneState(timeline.state));
    setMessage(`${intent.actionType.replaceAll("_", " ")} applied locally`);
    void channel.send({ type: "broadcast", event: "gameplay_action", payload: action }).then((status) => {
      if (status !== "ok") setMessage(`Realtime ${intent.actionType} failed (${status}).`);
    });
  };

  const cancelHold = (pointerId?: number) => {
    const hold = holdRef.current;
    if (!hold || (pointerId !== undefined && hold.pointerId !== pointerId)) return;
    window.clearTimeout(hold.timer);
    holdRef.current = null;
  };

  useEffect(() => () => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    if (persistenceTimerRef.current !== null) window.clearTimeout(persistenceTimerRef.current);
  }, []);

  const buildAt = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    if (!playerId || !matchRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const edge = findClosestGridEdge((clientX - bounds.left) / bounds.width, (clientY - bounds.top) / bounds.height, bounds.width, bounds.height, 28);
    if (!edge) { setMessage("Hold directly on a grid edge."); return; }
    const wall = createWallSegment(matchRef.current.players[playerId]!.room.id, edge.orientation, edge.gridX, edge.gridY);
    const intent: FloatActionIntent = buildMode === "wall"
      ? { actionType: "PLACE_WALL", payload: { orientation: edge.orientation, gridX: edge.gridX, gridY: edge.gridY } }
      : buildMode === "nails"
        ? { actionType: "PLACE_NAILS", payload: { wallSegmentId: wall.id } }
        : buildMode === "glue"
          ? { actionType: "PLACE_GLUE", payload: { wallSegmentId: wall.id } }
          : { actionType: "REMOVE_WALL", payload: { wallSegmentId: wall.id } };
    previewRef.current = null;
    void handleSendIntent(intent);
  };

  const handlePointerDown = (key: ViewKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || event.button !== 0 || !playerId || !matchRef.current) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const balloon = findBalloonAtPoint(matchRef.current.players[playerId]!.room, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, 22 / Math.min(bounds.width, bounds.height));
    if (balloon) { handleSendIntent({ actionType: "POP_BALLOON", payload: { balloonId: balloon.id } }); return; }
    cancelHold();
    canvas.setPointerCapture(event.pointerId);
    const hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
    hold.timer = window.setTimeout(() => {
      if (holdRef.current?.pointerId !== hold.pointerId) return;
      holdRef.current = null;
      buildAt(canvas, hold.x, hold.y);
    }, 500);
    holdRef.current = hold;
    setMessage("Hold steady for 0.5 seconds to build.");
  };

  const handlePointerMove = (key: ViewKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || !playerId || !matchRef.current) return;
    const hold = holdRef.current;
    if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > (event.pointerType === "touch" ? 24 : 12)) {
      cancelHold(event.pointerId);
      setMessage("Placement cancelled because the pointer moved.");
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
    if (!edge) { previewRef.current = null; return; }
    const room = matchRef.current.players[playerId]!.room;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const valid = buildMode === "wall" ? validateWallPlacement(room, wall).valid && room.economy.coins >= VERTICAL_WALL_COST
      : buildMode === "nails" ? validateNailPlacement(room, wall.id).valid && room.economy.coins >= NAIL_STRIP_COST
        : buildMode === "glue" ? validateGluePlacement(room, wall.id).valid && room.economy.coins >= GLUE_COST
          : room.walls.some((item) => item.id === wall.id);
    previewRef.current = { wall, valid };
  };

  const handlePointerUp = (key: ViewKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const hold = holdRef.current;
    if (key !== "yours" || !hold || hold.pointerId !== event.pointerId || !playerId || !matchRef.current) { cancelHold(event.pointerId); return; }
    cancelHold(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height, 28);
    const room = matchRef.current.players[playerId]!.room;
    const id = edge ? createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY).id : null;
    setSelectedWallId(id && room.walls.some((wall) => wall.id === id) ? id : null);
    setMessage("Ready.");
  };

  if (!authReady) return <main className={`${styles.gameShell} grid place-items-center text-white`}>Loading Float…</main>;
  if (!userId) return (
    <main className={`${styles.gameShell} grid place-items-center p-6 text-white`}>
      <section className={styles.lobbyPanel}>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-100">BUILD · DEFEND · OUTLAST</p>
        <h1 className="mt-2 text-3xl font-black">Sign in as a PartyUp player</h1>
        <p className="mt-3 text-sm text-sky-100">Sign in to build, defend, and outlast your opponent.</p>
        <button type="button" onClick={() => void supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } })} className="mt-5 min-h-12 w-full rounded-xl bg-sky-600 font-black">SIGN IN WITH GOOGLE</button>
        <Link href="/dev/balloon-rooms" className="mt-4 inline-block text-xs font-bold text-sky-100">Back to local A/B mode</Link>
      </section>
    </main>
  );

  if (!matchRow) return (
    <main className={`${styles.gameShell} grid place-items-center p-5 text-white`}>
      <section className={styles.lobbyPanel}>
        <div className="flex items-center justify-between"><h1 className="text-2xl font-black">FLOAT</h1><Link href="/dev/balloon-rooms" className="text-[10px] font-black text-sky-100">LOCAL MODE</Link></div>
        <p className="mt-2 text-xs text-sky-100">Find your next opponent.</p>
        {poolMode ? <>
          <div className="mt-5 rounded-xl border border-sky-300/30 bg-sky-300/10 p-5 text-center"><p className="font-black">{poolMode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP..."}</p><p className="mt-1 text-xs text-sky-100">Keep this page open while we find a compatible Float player.</p></div>
          <button type="button" disabled={busy} onClick={() => void cancelPool()} className="mt-3 min-h-12 w-full rounded-xl border border-white/20 font-black disabled:opacity-50">CANCEL</button>
        </> : <>
          <button type="button" disabled={busy || !roomId} onClick={() => void startPool("room")} className="mt-5 min-h-12 w-full rounded-xl bg-sky-600 font-black disabled:opacity-40">FIND SOMEONE HERE<span className="block text-[10px] opacity-70">ROOM POOL</span></button>
          {!roomId ? <p className="mt-2 text-center text-[10px] font-black text-amber-300">JOIN A ROOM TO PLAY PEOPLE HERE</p> : null}
          <button type="button" disabled={busy} onClick={() => void startPool("global")} className="mt-3 min-h-12 w-full rounded-xl border border-sky-300/40 font-black disabled:opacity-50">PLAY ANYONE<span className="block text-[10px] text-sky-100">GLOBAL POOL</span></button>
        </>}
        <div className="my-4 flex items-center gap-2"><div className="h-px flex-1 bg-white/10" /><span className="text-[10px] font-black text-sky-200">PRIVATE TESTING</span><div className="h-px flex-1 bg-white/10" /></div>
        <button type="button" disabled={busy || Boolean(poolMode)} onClick={() => void runLobbyAction(createFloatNetworkMatch)} className="min-h-11 w-full rounded-xl border border-white/15 text-xs font-black disabled:opacity-50">CREATE BY CODE</button>
        <div className="my-4 flex items-center gap-2"><div className="h-px flex-1 bg-white/10" /><span className="text-[10px] font-black text-sky-200">OR JOIN</span><div className="h-px flex-1 bg-white/10" /></div>
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} maxLength={6} placeholder="MATCH CODE" className="min-h-12 w-full rounded-xl border border-white/15 bg-sky-950/25 px-4 text-center text-xl font-black tracking-[0.35em] outline-none focus:border-sky-300" />
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void runLobbyAction(() => joinFloatNetworkMatch(code))} className="mt-2 min-h-12 w-full rounded-xl border border-sky-300/40 font-black disabled:opacity-40">JOIN MATCH</button>
        <p className="mt-4 text-center text-xs font-bold text-sky-100">{message}</p>
      </section>
    </main>
  );

  const isReady = playerId === "playerA" ? matchRow.player_a_ready : matchRow.player_b_ready;
  if (matchRow.status === "waiting" || !snapshot || !playerId || !opponentId) {
    const joinUrl = typeof window === "undefined" ? "" : `${window.location.origin}/dev/balloon-rooms/network?code=${matchRow.match_code}`;
    return (
      <main className={`${styles.gameShell} grid place-items-center p-5 text-white`}>
        <section className={styles.lobbyPanel}>
          <p className="text-xs font-black text-sky-100">YOU ARE PLAYER {playerId === "playerA" ? "A" : "B"}</p>
          <h1 className="mt-2 text-4xl font-black tracking-[0.25em]">{matchRow.match_code}</h1>
          <p className="mt-2 text-sm text-sky-100">{matchRow.player_b_id ? "Both players joined." : "Waiting for Player B to join."}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs font-black"><div className="rounded-lg border border-white/10 p-3">A · {matchRow.player_a_ready ? "READY" : "WAITING"}</div><div className="rounded-lg border border-white/10 p-3">B · {matchRow.player_b_ready ? "READY" : matchRow.player_b_id ? "WAITING" : "OPEN"}</div></div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(joinUrl).then(() => setMessage("Join link copied."))} className="mt-3 min-h-11 w-full rounded-lg border border-sky-300/30 font-black">COPY JOIN LINK</button>
          <button type="button" disabled={busy || isReady || !matchRow.player_b_id} onClick={() => void runLobbyAction(() => readyFloatNetworkMatch(matchRow.id))} className="mt-2 min-h-12 w-full rounded-xl bg-sky-600 font-black disabled:opacity-45">{isReady ? "READY — WAITING FOR OPPONENT" : "READY"}</button>
          <button type="button" onClick={closeMatch} className="mt-3 text-[10px] font-black text-sky-200">CLOSE THIS MATCH</button>
          <p className="mt-3 text-xs font-bold text-sky-100">{message}</p>
        </section>
      </main>
    );
  }

  const ids: Record<ViewKey, FloatPlayerId> = { yours: playerId, opponent: opponentId };
  const summaries = { yours: roomSummary(snapshot.players[playerId]!.room, snapshot.simulationTimeMs), opponent: roomSummary(snapshot.players[opponentId]!.room, snapshot.simulationTimeMs) };
  const waveRound = getCurrentWaveRound(snapshot.waveState);
  const nextRoundIndex = snapshot.waveState.status !== "transition" ? snapshot.waveState.roundIndex : snapshot.waveState.transitionFromRoundId === null ? snapshot.waveState.roundIndex : snapshot.waveState.roundIndex + 1;
  const nextRound = getWaveRound(nextRoundIndex + 1);
  const selectedWall: WallSegment | null = summaries.yours.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const opponentSeenAt = playerId === "playerA" ? matchRow.player_b_last_seen_at : matchRow.player_a_last_seen_at;
  const opponentReconnecting = Boolean(opponentSeenAt && now - Date.parse(opponentSeenAt) > FLOAT_RECONNECT_AFTER_MS);
  const matchLabel = matchRow.status === "complete" ? matchRow.result === "draw" ? "DRAW" : matchRow.winner_user_id === userId ? "YOU WIN" : "OPPONENT WINS"
    : snapshot.waveState.status === "transition" ? `ROUND ${nextRound?.id ?? "—"} IN ${Math.max(0, Math.ceil(((snapshot.waveState.transitionEndsAt ?? snapshot.simulationTimeMs) - snapshot.simulationTimeMs) / 1000))}s`
      : `ROUND ${waveRound?.id ?? "—"} · ${snapshot.waveState.spawnedCount}/${waveRound?.composition.reduce((sum, item) => sum + item.count, 0) ?? 0}`;

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className={styles.gameFrame}>
        <FloatHeader round={`ROUND ${snapshot.waveState.status === "transition" ? nextRound?.id ?? 20 : waveRound?.id ?? 1} / 20`} subtitle={snapshot.waveState.status === "transition" ? matchLabel : "Keep them from reaching the top."} connection={opponentReconnecting ? "RECONNECTING" : pendingCount > 0 ? "SYNCING" : "ONLINE"}>
          <p>Match {matchRow.match_code} · Player {playerId === "playerA" ? "A" : "B"}</p><p>{message}{pendingCount > 0 ? ` · ${pendingCount} pending` : ""}</p><button type="button" onClick={closeMatch}>NEW MATCH</button><Link href="/dev/balloon-rooms">LOCAL PLAY</Link><button type="button" disabled={busy || !playerId} onClick={() => playerId && void recoverRealtime(matchRow.id, playerId).catch(error => setMessage(error.message))}>RECOVER CONNECTION</button>
        </FloatHeader>
        <div className={styles.roomsGrid}>
          {viewKeys.map((key) => {
            const summary = summaries[key]; const id = ids[key];
            const label = `${key === "yours" ? "YOUR ROOM" : "OPPONENT"} · ${id === "playerA" ? "A" : "B"}`;
            return <section key={key} className={styles.room} aria-label={label}>
              <RoomHeader label={label} coins={summary.coins} income={summary.income} health={summary.health} />
              <div className={styles.playfield}>
                <canvas ref={(canvas) => { canvasesRef.current[key] = canvas; }} className={styles.canvas} data-placement={key === "yours" && buildMode === "wall"} onPointerDown={(event) => handlePointerDown(key, event)} onPointerMove={(event) => handlePointerMove(key, event)} onPointerUp={(event) => handlePointerUp(key, event)} onPointerCancel={(event) => cancelHold(event.pointerId)} onLostPointerCapture={(event) => cancelHold(event.pointerId)} onPointerLeave={(event) => { if (key === "yours") { cancelHold(event.pointerId); previewRef.current = null; } }} onContextMenu={(event) => event.preventDefault()} aria-label={`${label} playfield`} />
                {key === "opponent" ? <LanePicker lane={lane} onSelect={setLane} /> : null}
              </div>
              {key === "yours" ? <div className={styles.controls}>
                <div className={styles.toolRow}>{(["wall", "nails", "glue", "remove"] as BuildMode[]).map((mode, index) => {
                  const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : mode === "glue" ? GLUE_COST : null;
                  return <button key={mode} type="button" aria-pressed={buildMode === mode} disabled={busy || matchRow.status !== "active" || (cost !== null && summary.coins < cost)} onClick={() => { setBuildMode(mode); previewRef.current = null; }} className={styles.toolButton}><small aria-hidden="true">{index + 1}</small><FloatIcon kind={mode} /><span>{mode.toUpperCase()}</span>{cost !== null ? <span className={styles.cost}><Coin />{cost}</span> : <span className={styles.cost}>FREE</span>}</button>;
                })}</div>
                {selectedWall ? <div className={styles.repairPanel}><p>WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</p><button type="button" disabled={busy || selectedWall.integrity <= 0 || selectedWall.integrity > WALL_REPAIR_THRESHOLD || summary.coins < WALL_REPAIR_COST} onClick={() => void handleSendIntent({ actionType: "REPAIR_WALL", payload: { wallSegmentId: selectedWall.id } })}>REPAIR +{WALL_REPAIR_AMOUNT} · <Coin /> {WALL_REPAIR_COST}</button></div> : null}
                <p className={styles.feedback} role="status">{message === "Synced" || message.endsWith("applied locally") ? `Hold 0.5s to ${buildMode} · Tap balloons to pop` : message}</p>
              </div> : <div className={`${styles.controls} ${styles.attackControls}`}>
                <p className={styles.toolbarHint}>TAP TO SEND TO LANE {lane}</p>
                <div className={styles.toolRow}>{(["basic", "speed", "heavy"] as BalloonType[]).map(type => { const config = BALLOON_TYPES[type]; const unlocked = summaries.yours.unlocked[type]; const unavailable = busy || matchRow.status !== "active" || !unlocked || summaries.yours.coins < config.cost || summaries.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE; return <button key={type} type="button" disabled={unavailable} onClick={() => void handleSendIntent({ actionType: "SEND_BALLOON", payload: { balloonType: type, lane } })} className={styles.toolButton}><FloatIcon kind={type} /><span>{type.toUpperCase()}</span><span className={styles.cost}>{unlocked ? <><Coin />{config.cost}</> : "LOCKED"}</span></button>; })}</div>
                {summaries.yours.queue.length > 0 ? <p className={styles.queuePanel}>{summaries.yours.queue.length}/{MAX_LAUNCH_QUEUE_SIZE} queued</p> : null}
              </div>}
            </section>;
          })}
        </div>
        {matchRow.status === "complete" || opponentReconnecting ? <div className={styles.matchOverlay} role="status">{matchRow.status === "complete" ? matchRow.result === "draw" ? "DRAW" : matchRow.winner_user_id === userId ? "VICTORY" : "DEFEAT" : "OPPONENT RECONNECTING"}</div> : null}
      </div>
    </main>
  );
}
