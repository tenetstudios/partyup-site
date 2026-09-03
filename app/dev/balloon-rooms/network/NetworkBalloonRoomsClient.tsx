"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BALLOON_TYPES,
  GLUE_COST,
  INCOME_TICK_INTERVAL_MS,
  MAX_FRAME_DELTA_SECONDS,
  MAX_LAUNCH_QUEUE_SIZE,
  NAIL_STRIP_COST,
  ROOM_MAX_HEALTH,
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
import { drawBalloonRoom, type WallPreview } from "@/lib/balloonRooms/rendering";
import {
  FLOAT_CORE_VERSION,
  FLOAT_POOL_HEARTBEAT_MS,
  FLOAT_RECONNECT_AFTER_MS,
  FLOAT_SYNC_INTERVAL_MS,
  cancelFloatPool,
  createFloatNetworkMatch,
  getFloatPoolStatus,
  joinFloatPool,
  joinFloatNetworkMatch,
  playerIdForUser,
  readyFloatNetworkMatch,
  submitFloatNetworkAction,
  syncFloatNetworkMatch,
  type FloatActionIntent,
  type FloatMatchRow,
  type FloatPlayerId,
  type FloatPoolMode,
} from "@/lib/floatMultiplayer";
import { createSupabaseClient } from "@/lib/supabase";
import { readActiveRoomContext } from "@/lib/activeRoomContext";
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
  const [snapshot, setSnapshot] = useState<FloatMatchState | null>(null);
  const [code, setCode] = useState(initialCode.replace(/[^A-Z2-9]/g, "").slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [poolMode, setPoolMode] = useState<FloatPoolMode | null>(null);
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [message, setMessage] = useState("Create a match or enter a six-character code.");
  const [lane, setLane] = useState<SpawnLane>(1);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const previewRef = useRef<WallPreview>(null);
  const holdRef = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const matchRowRef = useRef<FloatMatchRow | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!roomId) setRoomId(readActiveRoomContext()?.roomId ?? null);
  }, [roomId]);

  const acceptMatch = useCallback((row: FloatMatchRow) => {
    const current = matchRowRef.current;
    if (current?.id === row.id && (
      row.state_revision < current.state_revision
      || (row.state_revision === current.state_revision && Date.parse(row.updated_at) < Date.parse(current.updated_at))
    )) return;
    matchRowRef.current = row;
    setMatchRow(row);
    const state = cloneState(row.state);
    matchRef.current = state;
    setSnapshot(cloneState(state));
    window.localStorage.setItem("partyup_float_match_id", row.id);
  }, []);

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
  }, [recover, supabase]);

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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "float_match_actions", filter: `match_id=eq.${matchId}` }, () => {
        void recover(matchId).catch((error) => setMessage(error instanceof Error ? error.message : "Could not recover Float state."));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [acceptMatch, matchId, recover, supabase, userId]);

  useEffect(() => {
    if (!matchId || !userId || matchStatus === "complete" || matchStatus === "abandoned") return;
    let stopped = false;
    const sync = async () => {
      try {
        const result = await syncFloatNetworkMatch(matchId);
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
          updateFloatMatch(state, SIMULATION_STEP_SECONDS);
          accumulator -= SIMULATION_STEP_SECONDS;
        }
        if (timestamp - lastHud >= 250) { lastHud = timestamp; setSnapshot(cloneState(state)); }
        const ids: Record<ViewKey, FloatPlayerId> = { yours: playerId, opponent: opponentId };
        for (const key of viewKeys) {
          const canvas = canvasesRef.current[key];
          if (canvas) drawBalloonRoom(canvas, state.players[ids[key]]!.room, ids[key], [], timestamp, {
            debugPaths: false,
            preview: key === "yours" ? previewRef.current : null,
            selectedWallId: key === "yours" ? selectedWallId : null,
          });
        }
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [matchRow?.status, opponentId, playerId, selectedWallId]);

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
    window.localStorage.removeItem("partyup_float_match_id");
    matchRowRef.current = null;
    matchRef.current = null;
    setMatchRow(null);
    setSnapshot(null);
    setSelectedWallId(null);
    setMessage("Create a match or enter a six-character code.");
  };

  const sendIntent = async (intent: FloatActionIntent) => {
    const currentMatch = matchRowRef.current;
    if (!currentMatch || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("Sending…");
    try {
      const result = await submitFloatNetworkAction(currentMatch.id, intent);
      acceptMatch(result.match);
      setMessage(result.accepted ? "Accepted" : result.error ?? "Action rejected");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const cancelHold = (pointerId?: number) => {
    const hold = holdRef.current;
    if (!hold || (pointerId !== undefined && hold.pointerId !== pointerId)) return;
    window.clearTimeout(hold.timer);
    holdRef.current = null;
  };

  useEffect(() => () => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
  }, []);

  const buildAt = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    if (!playerId || !matchRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const edge = findClosestGridEdge((clientX - bounds.left) / bounds.width, (clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
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
    void sendIntent(intent);
  };

  const handlePointerDown = (key: ViewKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || event.button !== 0 || !playerId || !matchRef.current || busy) return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const balloon = findBalloonAtPoint(matchRef.current.players[playerId]!.room, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, 22 / Math.min(bounds.width, bounds.height));
    if (balloon) { void sendIntent({ actionType: "POP_BALLOON", payload: { balloonId: balloon.id } }); return; }
    cancelHold();
    canvas.setPointerCapture(event.pointerId);
    const hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
    hold.timer = window.setTimeout(() => {
      if (holdRef.current?.pointerId !== hold.pointerId) return;
      holdRef.current = null;
      buildAt(canvas, hold.x, hold.y);
    }, 1_000);
    holdRef.current = hold;
    setMessage("Hold steady for 1 second to build.");
  };

  const handlePointerMove = (key: ViewKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || !playerId || !matchRef.current) return;
    const hold = holdRef.current;
    if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 12) cancelHold(event.pointerId);
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
      <section className="w-full max-w-md rounded-2xl border border-purple-200/20 bg-black/35 p-6 text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-purple-300">Float 8.1 Network Match</p>
        <h1 className="mt-2 text-3xl font-black">Sign in as a PartyUp player</h1>
        <p className="mt-3 text-sm text-zinc-400">Each browser session must use a different authenticated account.</p>
        <button type="button" onClick={() => void supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } })} className="mt-5 min-h-12 w-full rounded-xl bg-purple-600 font-black">SIGN IN WITH GOOGLE</button>
        <Link href="/dev/balloon-rooms" className="mt-4 inline-block text-xs font-bold text-purple-300">Back to local A/B mode</Link>
      </section>
    </main>
  );

  if (!matchRow) return (
    <main className={`${styles.gameShell} grid place-items-center p-5 text-white`}>
      <section className="w-full max-w-md rounded-2xl border border-purple-200/20 bg-black/35 p-5">
        <div className="flex items-center justify-between"><h1 className="text-2xl font-black">FLOAT NETWORK</h1><Link href="/dev/balloon-rooms" className="text-[10px] font-black text-purple-300">LOCAL MODE</Link></div>
        <p className="mt-2 text-xs text-zinc-400">Core {FLOAT_CORE_VERSION} · two authenticated sessions</p>
        {poolMode ? <>
          <div className="mt-5 rounded-xl border border-purple-300/30 bg-purple-500/10 p-5 text-center"><p className="font-black">{poolMode === "room" ? "SEARCHING THIS ROOM..." : "SEARCHING PARTYUP..."}</p><p className="mt-1 text-xs text-zinc-400">Keep this page open while we find a compatible Float player.</p></div>
          <button type="button" disabled={busy} onClick={() => void cancelPool()} className="mt-3 min-h-12 w-full rounded-xl border border-white/20 font-black disabled:opacity-50">CANCEL</button>
        </> : <>
          <button type="button" disabled={busy || !roomId} onClick={() => void startPool("room")} className="mt-5 min-h-12 w-full rounded-xl bg-purple-600 font-black disabled:opacity-40">FIND SOMEONE HERE<span className="block text-[10px] opacity-70">ROOM POOL</span></button>
          {!roomId ? <p className="mt-2 text-center text-[10px] font-black text-amber-300">JOIN A ROOM TO PLAY PEOPLE HERE</p> : null}
          <button type="button" disabled={busy} onClick={() => void startPool("global")} className="mt-3 min-h-12 w-full rounded-xl border border-purple-300/40 font-black disabled:opacity-50">PLAY ANYONE<span className="block text-[10px] text-purple-300">GLOBAL POOL</span></button>
        </>}
        <div className="my-4 flex items-center gap-2"><div className="h-px flex-1 bg-white/10" /><span className="text-[10px] font-black text-zinc-500">PRIVATE TESTING</span><div className="h-px flex-1 bg-white/10" /></div>
        <button type="button" disabled={busy || Boolean(poolMode)} onClick={() => void runLobbyAction(createFloatNetworkMatch)} className="min-h-11 w-full rounded-xl border border-white/15 text-xs font-black disabled:opacity-50">CREATE BY CODE</button>
        <div className="my-4 flex items-center gap-2"><div className="h-px flex-1 bg-white/10" /><span className="text-[10px] font-black text-zinc-500">OR JOIN</span><div className="h-px flex-1 bg-white/10" /></div>
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} maxLength={6} placeholder="MATCH CODE" className="min-h-12 w-full rounded-xl border border-white/15 bg-black/40 px-4 text-center text-xl font-black tracking-[0.35em] outline-none focus:border-purple-300" />
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void runLobbyAction(() => joinFloatNetworkMatch(code))} className="mt-2 min-h-12 w-full rounded-xl border border-purple-300/40 font-black disabled:opacity-40">JOIN MATCH</button>
        <p className="mt-4 text-center text-xs font-bold text-zinc-400">{message}</p>
      </section>
    </main>
  );

  const isReady = playerId === "playerA" ? matchRow.player_a_ready : matchRow.player_b_ready;
  if (matchRow.status === "waiting" || !snapshot || !playerId || !opponentId) {
    const joinUrl = typeof window === "undefined" ? "" : `${window.location.origin}/dev/balloon-rooms/network?code=${matchRow.match_code}`;
    return (
      <main className={`${styles.gameShell} grid place-items-center p-5 text-white`}>
        <section className="w-full max-w-lg rounded-2xl border border-purple-200/20 bg-black/35 p-6 text-center">
          <p className="text-xs font-black text-purple-300">YOU ARE PLAYER {playerId === "playerA" ? "A" : "B"}</p>
          <h1 className="mt-2 text-4xl font-black tracking-[0.25em]">{matchRow.match_code}</h1>
          <p className="mt-2 text-sm text-zinc-400">{matchRow.player_b_id ? "Both players joined." : "Waiting for Player B to join."}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs font-black"><div className="rounded-lg border border-white/10 p-3">A · {matchRow.player_a_ready ? "READY" : "WAITING"}</div><div className="rounded-lg border border-white/10 p-3">B · {matchRow.player_b_ready ? "READY" : matchRow.player_b_id ? "WAITING" : "OPEN"}</div></div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(joinUrl).then(() => setMessage("Join link copied."))} className="mt-3 min-h-11 w-full rounded-lg border border-purple-300/30 font-black">COPY JOIN LINK</button>
          <button type="button" disabled={busy || isReady || !matchRow.player_b_id} onClick={() => void runLobbyAction(() => readyFloatNetworkMatch(matchRow.id))} className="mt-2 min-h-12 w-full rounded-xl bg-purple-600 font-black disabled:opacity-45">{isReady ? "READY — WAITING FOR OPPONENT" : "READY"}</button>
          <button type="button" onClick={closeMatch} className="mt-3 text-[10px] font-black text-zinc-500">CLOSE THIS MATCH</button>
          <p className="mt-3 text-xs font-bold text-zinc-400">{message}</p>
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
        <header className="flex min-w-0 items-center justify-between gap-2 px-1"><div className="min-w-0"><h1 className="text-lg font-black">FLOAT · {matchRow.match_code}</h1><p className="truncate text-[8px] font-black text-purple-300">PLAYER {playerId === "playerA" ? "A" : "B"} · SEQ {matchRow.last_sequence} {opponentReconnecting ? "· OPPONENT RECONNECTING" : "· CONNECTED"}</p></div><div className="flex gap-1"><button type="button" onClick={closeMatch} className="min-h-9 rounded-lg border border-white/15 px-2 text-[8px] font-black">NEW</button><Link href="/dev/balloon-rooms" className="grid min-h-9 place-items-center rounded-lg border border-white/15 px-2 text-[8px] font-black">LOCAL</Link><button type="button" disabled={busy} onClick={() => void syncFloatNetworkMatch(matchRow.id).then((result) => acceptMatch(result.match)).catch((error) => setMessage(error.message))} className="min-h-9 rounded-lg border border-white/15 px-2 text-[8px] font-black disabled:opacity-40">SYNC</button></div></header>
        <div className={styles.roundBar}><p className="shrink-0 text-[10px] font-black">{matchLabel}</p><p className={`truncate text-[8px] font-black ${message === "Accepted" ? "text-emerald-300" : "text-purple-200"}`}>{busy ? "CANONICAL ACTION PENDING…" : message}</p></div>
        <div className={styles.roomsGrid}>
          {viewKeys.map((key) => {
            const summary = summaries[key];
            const label = key === "yours" ? "YOUR ROOM" : "OPPONENT";
            return <section key={key} className={styles.room} aria-label={label}>
              <h2 className="text-center text-[10px] font-black tracking-[0.12em] text-purple-100">{label} · {ids[key] === "playerA" ? "A" : "B"}</h2>
              <div className={styles.economyPanel}><p className="text-sm font-black tabular-nums text-amber-200">● {summary.coins}</p><p className="text-[8px] font-black tabular-nums text-emerald-300">+{summary.income}/{INCOME_TICK_INTERVAL_MS / 1000}s · {Math.ceil(summary.nextIncomeInMs / 1000)}s</p></div>
              <div className={styles.playfield}><canvas ref={(canvas) => { canvasesRef.current[key] = canvas; }} className={styles.canvas} onPointerDown={(event) => handlePointerDown(key, event)} onPointerMove={(event) => handlePointerMove(key, event)} onPointerUp={(event) => handlePointerUp(key, event)} onPointerCancel={(event) => cancelHold(event.pointerId)} onLostPointerCapture={(event) => cancelHold(event.pointerId)} onPointerLeave={(event) => { cancelHold(event.pointerId); previewRef.current = null; }} onContextMenu={(event) => event.preventDefault()} />{key === "opponent" ? <div className={styles.lanePicker}>{([1, 2, 3, 4] as SpawnLane[]).map((item) => <button key={item} type="button" aria-pressed={lane === item} onClick={() => setLane(item)} className={lane === item ? styles.laneSelected : undefined}>L{item}</button>)}</div> : null}</div>
              <div className={styles.statusPanel}><div className="flex items-center justify-between"><p className="text-sm font-black">HP {summary.health}/{ROOM_MAX_HEALTH}</p><p className="text-right text-[7px] font-bold text-purple-300">{summary.balloons} ACTIVE<br />W {summary.walls.length} · N {summary.nails} · G {summary.glue}</p></div></div>
              {key === "yours" ? <div className={styles.controls}>
                <div className="grid grid-cols-4 gap-1">{(["wall", "nails", "glue", "remove"] as BuildMode[]).map((mode) => { const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : mode === "glue" ? GLUE_COST : null; return <button key={mode} type="button" disabled={busy || matchRow.status !== "active" || (cost !== null && summary.coins < cost)} aria-pressed={buildMode === mode} onClick={() => setBuildMode(mode)} className={`min-h-9 rounded-md border px-0.5 text-[7px] font-black disabled:opacity-40 ${buildMode === mode ? "border-purple-300 bg-purple-500/35" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}<span className="block">{cost ?? "FREE"}</span></button>; })}</div>
                {selectedWall ? <div className="mt-1 flex min-h-8 items-center justify-between rounded-md border border-amber-200/25 px-1"><p className="text-[8px] font-black">WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</p><button type="button" disabled={busy || selectedWall.integrity <= 0 || selectedWall.integrity > WALL_REPAIR_THRESHOLD || summary.coins < WALL_REPAIR_COST} onClick={() => void sendIntent({ actionType: "REPAIR_WALL", payload: { wallSegmentId: selectedWall.id } })} className="min-h-7 rounded border border-amber-200/60 px-1 text-[7px] font-black disabled:opacity-40">REPAIR +{WALL_REPAIR_AMOUNT} · {WALL_REPAIR_COST}</button></div> : null}
                <p className="mt-1 truncate text-center text-[7px] font-bold text-zinc-500">Hold 1s on your grid · tap balloons to pop</p>
              </div> : <div className={styles.controls}>
                <p className="mb-1 text-center text-[8px] font-black uppercase text-pink-200">Tap to send · Lane {lane}</p>
                <div className="grid grid-cols-3 gap-1">{(["basic", "speed", "heavy"] as BalloonType[]).map((type) => { const config = BALLOON_TYPES[type]; const disabled = busy || matchRow.status !== "active" || !summaries.yours.unlocked[type] || summaries.yours.coins < config.cost || summaries.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE; return <button key={type} type="button" disabled={disabled} onClick={() => void sendIntent({ actionType: "SEND_BALLOON", payload: { balloonType: type, lane } })} className="min-h-11 rounded-md border border-pink-300/35 bg-pink-500/20 text-[7px] font-black disabled:opacity-40">{type.toUpperCase()}<span className="block text-[9px] text-amber-200">{summaries.yours.unlocked[type] ? config.cost : "LOCK"}</span></button>; })}</div>
                <div className={styles.queuePanel}><p className="truncate text-[7px] font-black text-zinc-400">Q {summaries.yours.queue.length}/{MAX_LAUNCH_QUEUE_SIZE} · {summaries.yours.queue.map((item) => `${item.balloonType[0].toUpperCase()}${item.lane}`).join(" · ") || "EMPTY"}</p></div>
              </div>}
            </section>;
          })}
        </div>
      </div>
    </main>
  );
}
