"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BALLOON_TYPES,
  INCOME_TICK_INTERVAL_MS,
  NAIL_STRIP_COST,
  MAX_FRAME_DELTA_SECONDS,
  MAX_LAUNCH_QUEUE_SIZE,
  MAX_NAIL_STRIPS,
  MAX_WALL_SEGMENTS,
  ROOM_MAX_HEALTH,
  WAVE_ROUNDS,
  SIMULATION_STEP_SECONDS,
  VERTICAL_WALL_COST,
  applyGameAction,
  createBalloonRoom,
  createSendBalloonAction,
  createWaveState,
  createWallSegment,
  findBalloonAtPoint,
  findClosestGridEdge,
  getUnsupportedHorizontalWalls,
  getCurrentWaveRound,
  hasRequiredRoutes,
  updateRoomSimulation,
  updateWaveState,
  validateWallPlacement,
  validateNailPlacement,
  type BalloonRoom,
  type BalloonType,
  type SpawnLane,
  type WaveState,
} from "@partyup/balloon-core";
import { drawBalloonRoom, type RoomVisualEffect, type WallPreview } from "@/lib/balloonRooms/rendering";
import styles from "./BalloonRooms.module.css";

type RoomKey = "yours" | "opponent";
type BuildMode = "wall" | "nails" | "remove";
type RoomCollection = Record<RoomKey, BalloonRoom>;
type CanvasCollection = Record<RoomKey, HTMLCanvasElement | null>;
type RoomSummary = Record<RoomKey, {
  health: number;
  count: number;
  running: boolean;
  wallCount: number;
  verticalCount: number;
  horizontalCount: number;
  supportedHorizontalCount: number;
  routesValid: boolean;
  nailCount: number;
  brokenNailCount: number;
  coins: number;
  income: number;
  nextIncomeInMs: number;
  queue: { balloonType: BalloonType; lane: SpawnLane }[];
  unlockedBalloonTypes: Record<BalloonType, boolean>;
}>;

type WaveSummary = {
  status: WaveState["status"];
  roundId: number | null;
  spawnedCount: number;
  totalCount: number;
  nextRoundInSeconds: number;
};

const roomKeys: RoomKey[] = ["yours", "opponent"];

function createRooms(): RoomCollection {
  const yours = createBalloonRoom("your-room");
  const opponent = createBalloonRoom("opponent-room");
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "vertical", 3, 5) });
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "horizontal", 2, 5) });
  applyGameAction(opponent, { type: "PLACE_WALL", wall: createWallSegment(opponent.id, "horizontal", 3, 5) });
  applyGameAction(opponent, { type: "PLACE_NAILS", wallSegmentId: opponent.walls[1].id });
  return { yours, opponent };
}

function summarize(rooms: RoomCollection, simulationTimeMs: number): RoomSummary {
  return Object.fromEntries(roomKeys.map((key) => {
    const room = rooms[key];
    const unsupportedCount = getUnsupportedHorizontalWalls(room.walls).length;
    const horizontalCount = room.walls.filter((wall) => wall.orientation === "horizontal").length;
    return [key, {
      health: room.health,
      count: room.balloons.length,
      running: room.health > 0,
      wallCount: room.walls.length,
      verticalCount: room.walls.filter((wall) => wall.orientation === "vertical").length,
      horizontalCount,
      supportedHorizontalCount: horizontalCount - unsupportedCount,
      routesValid: hasRequiredRoutes(room, room.walls) && unsupportedCount === 0,
      nailCount: room.nailStrips.length,
      brokenNailCount: room.nailStrips.filter((nail) => nail.status === "broken").length,
      coins: room.economy.coins,
      income: room.economy.income,
      nextIncomeInMs: Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs),
      queue: room.attack.queue.map((queued) => ({ balloonType: queued.balloonType, lane: queued.lane })),
      unlockedBalloonTypes: { ...room.unlockedBalloonTypes },
    }];
  })) as RoomSummary;
}

function summarizeWave(state: WaveState, simulationTimeMs: number): WaveSummary {
  const round = getCurrentWaveRound(state);
  return {
    status: state.status,
    roundId: round?.id ?? null,
    spawnedCount: state.spawnedCount,
    totalCount: round?.composition.reduce((sum, entry) => sum + entry.count, 0) ?? 0,
    nextRoundInSeconds: state.transitionEndsAt === null ? 0 : Math.max(0, Math.ceil((state.transitionEndsAt - simulationTimeMs) / 1000)),
  };
}

export default function BalloonRoomsClient() {
  const roomsRef = useRef<RoomCollection>(createRooms());
  const simulationTimeMsRef = useRef(0);
  const waveStateRef = useRef<WaveState>(createWaveState(601));
  const sendSequenceRef = useRef(0);
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const effectsRef = useRef<RoomVisualEffect[]>([]);
  const previewRef = useRef<WallPreview>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [selectedBalloonType, setSelectedBalloonType] = useState<BalloonType>("basic");
  const [debugPaths, setDebugPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [lastNailContact, setLastNailContact] = useState("No nail contacts yet");
  const [lastSend, setLastSend] = useState("No balloons sent yet");
  const [summary, setSummary] = useState<RoomSummary>(() => summarize(createRooms(), 0));
  const [waveSummary, setWaveSummary] = useState<WaveSummary>(() => summarizeWave(createWaveState(601), 0));
  const [waveNotice, setWaveNotice] = useState<string | null>(null);

  const refreshSummary = useCallback(() => {
    setSummary(summarize(roomsRef.current, simulationTimeMsRef.current));
    setWaveSummary(summarizeWave(waveStateRef.current, simulationTimeMsRef.current));
  }, []);
  const showFeedback = useCallback((message: string, valid: boolean) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ message, valid });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1600);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let previousHudTime = previousTime;

    const frame = (now: number) => {
      accumulator += Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      let summaryChanged = false;
      while (accumulator >= SIMULATION_STEP_SECONDS) {
        simulationTimeMsRef.current += SIMULATION_STEP_SECONDS * 1000;
        for (const key of roomKeys) {
          const room = roomsRef.current[key];
          const incomeResult = applyGameAction(room, { type: "APPLY_INCOME_TICK", simulationTimeMs: simulationTimeMsRef.current });
          if (incomeResult.applied && incomeResult.incomeTicksApplied) summaryChanged = true;
          const targetRoom = roomsRef.current[key === "yours" ? "opponent" : "yours"];
          const launchResult = applyGameAction(room, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: simulationTimeMsRef.current }, targetRoom);
          if (launchResult.applied && launchResult.launchedBalloon) summaryChanged = true;
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (events.length > 0) summaryChanged = true;
          for (const event of events) {
            if (event.type === "balloon_escaped") {
              effectsRef.current.push({ roomKey: key, x: event.balloon.x, y: 0.02, kind: "escape", startedAt: now });
            } else if (event.type === "nail_contact") {
              const balloon = room.balloons.find((candidate) => candidate.id === event.balloonId);
              if (balloon) effectsRef.current.push({ roomKey: key, x: balloon.x, y: balloon.y, kind: event.popped ? "pop" : "nail", startedAt: now });
              setLastNailContact(`${event.balloonId} → ${event.nailStripId} · HP ${event.balloonHealthBefore}→${event.balloonHealthAfter} · nails ${event.durabilityBefore}→${event.durabilityAfter}`);
            }
          }
        }
        const waveResult = updateWaveState(
          waveStateRef.current,
          roomKeys.map((key) => roomsRef.current[key]),
          simulationTimeMsRef.current,
        );
        if (waveResult.spawnedBalloons.length > 0 || waveResult.completedRoundId !== null || waveResult.startedRoundId !== null) summaryChanged = true;
        if (waveResult.unlockedBalloonType) setWaveNotice(`${waveResult.unlockedBalloonType.toUpperCase()} BALLOON UNLOCKED`);
        else if (waveResult.completedRoundId !== null) setWaveNotice(waveResult.allWavesComplete ? "ALL WAVES COMPLETE" : `ROUND ${waveResult.completedRoundId} COMPLETE`);
        else if (waveResult.startedRoundId !== null) setWaveNotice(null);
        accumulator -= SIMULATION_STEP_SECONDS;
      }

      if (summaryChanged || now - previousHudTime >= 250) {
        previousHudTime = now;
        refreshSummary();
      }
      effectsRef.current = effectsRef.current.filter((effect) => now - effect.startedAt < 500);
      for (const key of roomKeys) {
        const canvas = canvasesRef.current[key];
        if (canvas) drawBalloonRoom(canvas, roomsRef.current[key], key, effectsRef.current, now, {
          debugPaths,
          preview: key === "yours" ? previewRef.current : null,
        });
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [debugPaths, refreshSummary]);

  const setCanvas = useCallback((key: RoomKey, canvas: HTMLCanvasElement | null) => {
    canvasesRef.current[key] = canvas;
  }, []);

  const popBalloon = useCallback((key: RoomKey, canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
    const balloon = findBalloonAtPoint(roomsRef.current[key], x, y, 22 / Math.min(bounds.width, bounds.height));
    if (!balloon) return;
    const result = applyGameAction(roomsRef.current[key], { type: "POP_BALLOON", balloonId: balloon.id });
    if (!result.applied || !result.damage) return;
    effectsRef.current.push({ roomKey: key, x: balloon.x, y: balloon.y, kind: result.damage.popped ? "pop" : "tap", startedAt: performance.now() });
    refreshSummary();
  }, [refreshSummary]);

  const handlePointerDown = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (findBalloonAtPoint(roomsRef.current[key], x, y, 22 / Math.min(bounds.width, bounds.height))) {
      popBalloon(key, canvas, event.clientX, event.clientY);
      return;
    }
    if (key === "opponent") return;

    const edge = findClosestGridEdge(
      x,
      y,
      bounds.width,
      bounds.height,
    );
    if (!edge) {
      showFeedback("Tap a grid edge", false);
      return;
    }
    const room = roomsRef.current.yours;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    let result: { applied: boolean; message: string };
    if (buildMode === "wall") {
      result = applyGameAction(room, { type: "PLACE_WALL", wall });
    } else if (buildMode === "nails") {
      result = applyGameAction(room, { type: "PLACE_NAILS", wallSegmentId: wall.id });
    } else {
      result = applyGameAction(room, { type: "REMOVE_WALL", wallSegmentId: wall.id });
    }
    showFeedback(result.message, result.applied);
    if (result.applied) refreshSummary();
    previewRef.current = null;
  }, [buildMode, popBalloon, refreshSummary, showFeedback]);

  const handlePointerMove = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
    if (!edge) {
      previewRef.current = null;
      return;
    }
    const room = roomsRef.current.yours;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const existingWall = room.walls.some((candidate) => candidate.id === wall.id);
    const valid = buildMode === "wall"
      ? validateWallPlacement(room, wall).valid && room.economy.coins >= VERTICAL_WALL_COST
      : buildMode === "nails"
        ? validateNailPlacement(room, wall.id).valid && room.economy.coins >= NAIL_STRIP_COST
        : existingWall;
    previewRef.current = { wall, valid };
  }, [buildMode]);

  const selectMode = useCallback((mode: BuildMode) => {
    previewRef.current = null;
    setBuildMode(mode);
    setFeedback(null);
  }, []);

  const sendBalloon = useCallback(() => {
    const opponent = roomsRef.current.opponent;
    sendSequenceRef.current += 1;
    const action = createSendBalloonAction({
      matchId: "local-phase-4",
      senderId: "web-local-player",
      targetRoomId: opponent.id,
      lane: selectedAttackLane,
      senderSequence: sendSequenceRef.current,
      sentAt: Date.now(),
      balloonType: selectedBalloonType,
    });
    const result = applyGameAction(roomsRef.current.yours, action, opponent);
    if (!result.applied) {
      sendSequenceRef.current -= 1;
      setLastSend(`Rejected Lane ${selectedAttackLane}: ${result.message}`);
      return;
    }
    setLastSend(`${selectedBalloonType.toUpperCase()} ${action.balloonId} → Lane ${selectedAttackLane}`);
    refreshSummary();
  }, [refreshSummary, selectedAttackLane, selectedBalloonType]);

  const restart = useCallback(() => {
    roomsRef.current = createRooms();
    simulationTimeMsRef.current = 0;
    waveStateRef.current = createWaveState(601);
    sendSequenceRef.current = 0;
    effectsRef.current = [];
    previewRef.current = null;
    setFeedback(null);
    setLastNailContact("No nail contacts yet");
    setLastSend("No balloons sent yet");
    setSelectedBalloonType("basic");
    setWaveNotice(null);
    refreshSummary();
  }, [refreshSummary]);

  const selectedBalloonConfig = BALLOON_TYPES[selectedBalloonType];
  const currentRound = waveSummary.roundId ? WAVE_ROUNDS[waveSummary.roundId - 1] : null;

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className="mx-auto max-w-3xl px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <header className="mb-3 flex items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-pink-300">Phase 6 · Waves</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">BALLOON ROOMS</h1>
          </div>
          <div className="flex gap-1">
            <button type="button" aria-pressed={debugPaths} onClick={() => setDebugPaths((current) => !current)} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">PATHS</button>
            <button type="button" onClick={restart} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">RESTART</button>
          </div>
        </header>

        <div className="mb-3 rounded-lg border border-purple-300/20 bg-purple-950/35 px-3 py-2 text-center">
          <p className="text-sm font-black text-white">{waveSummary.status === "complete" ? "ALL WAVES COMPLETE" : waveSummary.status === "transition" ? `ROUND ${waveSummary.roundId} COMPLETE` : `ROUND ${waveSummary.roundId}`}</p>
          <p className="mt-1 text-[10px] font-bold text-purple-200">
            {waveSummary.status === "transition"
              ? `NEXT ROUND IN ${waveSummary.nextRoundInSeconds}s`
              : currentRound
                ? currentRound.composition.map((entry) => `${entry.count} ${entry.balloonType}`).join(" · ")
                : "PvP remains active"}
            {waveSummary.status === "active" ? ` · ${waveSummary.spawnedCount}/${waveSummary.totalCount} deployed` : ""}
          </p>
          {waveNotice ? <p className="mt-1 text-[10px] font-black tracking-[0.12em] text-emerald-300">{waveNotice}</p> : null}
        </div>
        <p className="mb-3 px-1 text-xs font-bold text-zinc-400">Defend against waves while building and sending player attacks. Tap any balloon to deal 1 damage.</p>
        <div className={styles.roomsGrid}>
          {roomKeys.map((key) => {
            const roomSummary = summary[key];
            const label = key === "yours" ? "YOUR ROOM" : "OPPONENT ROOM";
            return (
              <section key={key} className={styles.room} aria-label={label}>
                <h2 className="mb-2 truncate text-center text-[11px] font-black tracking-[0.12em] text-purple-100 sm:text-sm">{label}</h2>
                <div className={styles.economyPanel} aria-label={`${label} economy`}>
                  <div><p className="text-[8px] font-black tracking-[0.14em] text-zinc-500">COINS</p><p className="text-lg font-black tabular-nums text-amber-200">{roomSummary.coins}</p></div>
                  <div className="text-right"><p className="text-[8px] font-black tracking-[0.14em] text-zinc-500">INCOME</p><p className="text-[10px] font-black tabular-nums text-emerald-300">+{roomSummary.income} / {INCOME_TICK_INTERVAL_MS / 1000}s</p><p className="text-[8px] font-bold tabular-nums text-zinc-500">NEXT 00:{String(Math.ceil(roomSummary.nextIncomeInMs / 1000)).padStart(2, "0")}</p></div>
                </div>
                <div className={styles.playfield}>
                  <canvas
                    ref={(canvas) => setCanvas(key, canvas)}
                    className={styles.canvas}
                    onPointerDown={(event) => handlePointerDown(key, event)}
                    onPointerMove={(event) => handlePointerMove(key, event)}
                    onPointerLeave={() => { if (key === "yours") previewRef.current = null; }}
                    onContextMenu={(event) => event.preventDefault()}
                    aria-label={`${label} balloon playfield.`}
                  />
                </div>
                <div className={`${styles.statusPanel} p-3`}>
                  {roomSummary.running ? <>
                    <div className="flex items-center justify-between gap-1"><p className="text-[10px] font-black tracking-[0.14em] text-zinc-400">ROOM HP</p><div className="text-right text-[9px] font-bold"><p className="text-purple-300">WALLS {roomSummary.wallCount}/{MAX_WALL_SEGMENTS}</p><p className="text-emerald-300">NAILS {roomSummary.nailCount}/{MAX_NAIL_STRIPS}{roomSummary.brokenNailCount > 0 ? ` · ${roomSummary.brokenNailCount} BROKEN` : ""}</p></div></div>
                    <div className="mt-1 flex items-baseline justify-between gap-2"><p className="text-3xl font-black tabular-nums">{roomSummary.health}<span className="text-sm text-zinc-500"> / {ROOM_MAX_HEALTH}</span></p><p className="text-[9px] font-bold text-zinc-500">{roomSummary.count} ACTIVE</p></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/50"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width]" style={{ width: `${(roomSummary.health / ROOM_MAX_HEALTH) * 100}%` }} /></div>
                  </> : <div className="grid min-h-14 place-items-center text-center"><p className="text-lg font-black text-red-300">ROOM BROKEN</p></div>}
                </div>

                {key === "yours" ? (
                  <div className={`${styles.controls} mt-2 p-2`}>
                    <div className="grid grid-cols-3 gap-1">
                      {(["wall", "nails", "remove"] as BuildMode[]).map((mode) => {
                        const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : null;
                        const unavailable = cost !== null && roomSummary.coins < cost;
                        return <button key={mode} type="button" aria-pressed={buildMode === mode} disabled={unavailable} onClick={() => selectMode(mode)} className={`min-h-11 rounded-md border px-1 text-[10px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${buildMode === mode ? "border-purple-300 bg-purple-500/35 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}{cost !== null ? ` ${cost}` : ""}</button>;
                      })}
                    </div>
                    <p className={`mt-2 min-h-4 text-center text-[10px] font-black ${feedback ? (feedback.valid ? "text-emerald-300" : "text-red-300") : "text-zinc-500"}`}>{feedback?.message ?? `${MAX_WALL_SEGMENTS - roomSummary.wallCount} walls · ${MAX_NAIL_STRIPS - roomSummary.nailCount} nails available`}</p>
                  </div>
                ) : (
                  <div className={`${styles.controls} mt-2 p-2`}>
                    <p className="mb-2 text-center text-[9px] font-black uppercase tracking-[0.14em] text-pink-200">Choose balloon</p>
                    <div className="grid grid-cols-3 gap-1">
                      {(["basic", "speed", "heavy"] as BalloonType[]).map((balloonType) => {
                        const unlocked = summary.yours.unlockedBalloonTypes[balloonType];
                        return <button key={balloonType} type="button" disabled={!unlocked} aria-pressed={selectedBalloonType === balloonType} onClick={() => setSelectedBalloonType(balloonType)} className={`min-h-10 rounded-md border px-1 text-[9px] font-black disabled:cursor-not-allowed disabled:opacity-45 ${selectedBalloonType === balloonType ? "border-amber-200 bg-amber-300/20 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{balloonType.toUpperCase()}{unlocked ? ` ${BALLOON_TYPES[balloonType].cost}` : " 🔒"}</button>;
                      })}
                    </div>
                    <p className="my-2 text-center text-[9px] font-black uppercase tracking-[0.14em] text-pink-200">Choose attack lane</p>
                    <div className="grid grid-cols-4 gap-1">
                      {([1, 2, 3, 4] as SpawnLane[]).map((lane) => (
                        <button key={lane} type="button" aria-label={`Select attack Lane ${lane}`} aria-pressed={selectedAttackLane === lane} onClick={() => setSelectedAttackLane(lane)} className={`min-h-11 rounded-md border text-xs font-black ${selectedAttackLane === lane ? "border-pink-300 bg-pink-500/40 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>L{lane}</button>
                      ))}
                    </div>
                    <button type="button" onClick={sendBalloon} disabled={!roomSummary.running || summary.yours.coins < selectedBalloonConfig.cost || summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE || !summary.yours.unlockedBalloonTypes[selectedBalloonType]} className="mt-2 min-h-12 w-full rounded-md border border-pink-300/70 bg-gradient-to-r from-purple-600 to-pink-600 text-xs font-black tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-40">SEND {selectedBalloonType.toUpperCase()} · {selectedBalloonConfig.cost}</button>
                    <p className={`mt-2 min-h-4 truncate text-center text-[9px] font-bold ${summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE || summary.yours.coins < selectedBalloonConfig.cost ? "text-red-300" : "text-emerald-300"}`}>{summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE ? "QUEUE FULL" : summary.yours.coins < selectedBalloonConfig.cost ? `NEED ${selectedBalloonConfig.cost}` : `Lane ${selectedAttackLane} · +${selectedBalloonConfig.incomeGain} Income`}</p>
                    <div className={styles.queuePanel} aria-label={`Launch queue ${summary.yours.queue.length} of ${MAX_LAUNCH_QUEUE_SIZE}`}>
                      <p className="text-[8px] font-black tracking-[0.12em] text-zinc-500">QUEUE {summary.yours.queue.length}/{MAX_LAUNCH_QUEUE_SIZE}</p>
                      <div className="mt-1 flex min-h-6 items-center gap-1 overflow-hidden">
                        {summary.yours.queue.length > 0 ? summary.yours.queue.map((queued, index) => <span key={`${index}-${queued.balloonType}-${queued.lane}`} className="flex items-center gap-1"><span className="grid min-w-7 place-items-center rounded-full border border-pink-300/30 bg-pink-500/15 px-1 py-1 text-[8px] font-black text-pink-100">{queued.balloonType[0].toUpperCase()}{queued.lane}</span>{index < summary.yours.queue.length - 1 ? <span className="text-[8px] text-zinc-600">→</span> : null}</span>) : <span className="text-[8px] font-bold text-zinc-600">EMPTY</span>}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-[10px] text-zinc-500" aria-label="Development simulation status">
          DEV · grid 6×10 · yours V{summary.yours.verticalCount}/H{summary.yours.horizontalCount} ({summary.yours.supportedHorizontalCount} supported), routes {summary.yours.routesValid ? "valid" : "invalid"} · opponent V{summary.opponent.verticalCount}/H{summary.opponent.horizontalCount} ({summary.opponent.supportedHorizontalCount} supported), routes {summary.opponent.routesValid ? "valid" : "invalid"}<br />LAST SEND · {lastSend}<br />LAST CONTACT · {lastNailContact}
        </aside>
      </div>
    </main>
  );
}
