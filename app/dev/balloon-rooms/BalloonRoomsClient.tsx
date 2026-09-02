"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BALLOON_TYPES,
  INCOME_TICK_INTERVAL_MS,
  GLUE_COST,
  NAIL_STRIP_COST,
  MAX_FRAME_DELTA_SECONDS,
  MAX_LAUNCH_QUEUE_SIZE,
  MAX_NAIL_STRIPS,
  MAX_WALL_SEGMENTS,
  ROOM_MAX_HEALTH,
  SIMULATION_STEP_SECONDS,
  VERTICAL_WALL_COST,
  WALL_REPAIR_AMOUNT,
  WALL_REPAIR_COST,
  WALL_REPAIR_THRESHOLD,
  applyGameAction,
  createBalloonRoom,
  createSendBalloonAction,
  createWaveState,
  createWallSegment,
  findBalloonAtPoint,
  findClosestGridEdge,
  getUnsupportedHorizontalWalls,
  getCurrentWaveRound,
  getWaveRound,
  hasRequiredRoutes,
  updateRoomSimulation,
  updateWaveState,
  validateWallPlacement,
  validateNailPlacement,
  validateGluePlacement,
  type BalloonRoom,
  type BalloonType,
  type SpawnLane,
  type WaveState,
  type WallSegment,
} from "@partyup/balloon-core";
import { drawBalloonRoom, getWallCenter, type RoomVisualEffect, type WallPreview } from "@/lib/balloonRooms/rendering";
import styles from "./BalloonRooms.module.css";

type RoomKey = "yours" | "opponent";
type BuildMode = "wall" | "nails" | "glue" | "remove";
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
  glueCount: number;
  coins: number;
  income: number;
  nextIncomeInMs: number;
  queue: { balloonType: BalloonType; lane: SpawnLane }[];
  unlockedBalloonTypes: Record<BalloonType, boolean>;
  walls: WallSegment[];
}>;

type WaveSummary = {
  status: WaveState["status"];
  roundId: number | null;
  nextRoundId: number | null;
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
  applyGameAction(opponent, { type: "PLACE_GLUE", wallSegmentId: opponent.walls[1].id });
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
      glueCount: room.glueTraps.length,
      coins: room.economy.coins,
      income: room.economy.income,
      nextIncomeInMs: Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs),
      queue: room.attack.queue.map((queued) => ({ balloonType: queued.balloonType, lane: queued.lane })),
      unlockedBalloonTypes: { ...room.unlockedBalloonTypes },
      walls: room.walls.map((wall) => ({ ...wall })),
    }];
  })) as RoomSummary;
}

function summarizeWave(state: WaveState, simulationTimeMs: number): WaveSummary {
  const round = getCurrentWaveRound(state);
  const nextRoundIndex = state.status !== "transition"
    ? state.roundIndex
    : state.transitionFromRoundId === null
      ? state.roundIndex
      : state.roundIndex + 1;
  return {
    status: state.status,
    roundId: round?.id ?? null,
    nextRoundId: getWaveRound(nextRoundIndex + 1)?.id ?? null,
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
  const buildHoldRef = useRef<{ pointerId: number; clientX: number; clientY: number; timeoutId: number } | null>(null);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [debugPaths, setDebugPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
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
    if (buildHoldRef.current !== null) window.clearTimeout(buildHoldRef.current.timeoutId);
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
          if (key === "opponent") room.health = ROOM_MAX_HEALTH;
          if (events.length > 0) summaryChanged = true;
          for (const event of events) {
            if (event.type === "balloon_escaped") {
              effectsRef.current.push({ roomKey: key, x: event.balloon.x, y: 0.02, kind: "escape", startedAt: now });
            } else if (event.type === "nail_contact") {
              const balloon = room.balloons.find((candidate) => candidate.id === event.balloonId);
              if (balloon) effectsRef.current.push({ roomKey: key, x: balloon.x, y: balloon.y, kind: event.popped ? "pop" : "nail", startedAt: now });
            } else if (event.type === "wall_damage" && !event.destroyed) {
              const wall = room.walls.find((candidate) => candidate.id === event.wallSegmentId);
              if (wall) {
                const center = getWallCenter(wall);
                effectsRef.current.push({ roomKey: key, ...center, kind: "wall", label: `-${event.damage}`, startedAt: now });
              }
            } else if (event.type === "wall_destroyed") {
              for (const wall of [event.wall, ...event.collapsedWalls]) {
                const center = getWallCenter(wall);
                effectsRef.current.push({ roomKey: key, ...center, kind: "collapse", label: wall.id === event.wall.id ? "BREAK" : "COLLAPSE", startedAt: now });
              }
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
          selectedWallId: key === "yours" ? selectedWallId : null,
        });
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [debugPaths, refreshSummary, selectedWallId]);

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

  const cancelBuildHold = useCallback((pointerId?: number) => {
    const hold = buildHoldRef.current;
    if (!hold || (pointerId !== undefined && hold.pointerId !== pointerId)) return;
    window.clearTimeout(hold.timeoutId);
    buildHoldRef.current = null;
  }, []);

  const performBuildAction = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const bounds = canvas.getBoundingClientRect();
    const edge = findClosestGridEdge(
      (clientX - bounds.left) / bounds.width,
      (clientY - bounds.top) / bounds.height,
      bounds.width,
      bounds.height,
    );
    if (!edge) {
      showFeedback("Hold directly on a grid edge", false);
      return;
    }
    const room = roomsRef.current.yours;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const result = buildMode === "wall"
      ? applyGameAction(room, { type: "PLACE_WALL", wall })
      : buildMode === "nails"
        ? applyGameAction(room, { type: "PLACE_NAILS", wallSegmentId: wall.id })
        : buildMode === "glue"
          ? applyGameAction(room, { type: "PLACE_GLUE", wallSegmentId: wall.id })
          : applyGameAction(room, { type: "REMOVE_WALL", wallSegmentId: wall.id });
    showFeedback(result.message, result.applied);
    if (result.applied) refreshSummary();
    previewRef.current = null;
  }, [buildMode, refreshSummary, showFeedback]);

  const handlePointerDown = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
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
    cancelBuildHold();
    canvas.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const timeoutId = window.setTimeout(() => {
      if (buildHoldRef.current?.pointerId !== pointerId) return;
      buildHoldRef.current = null;
      performBuildAction(canvas, clientX, clientY);
    }, 1000);
    buildHoldRef.current = { pointerId, clientX, clientY, timeoutId };
    showFeedback("Hold steady for 1 second to build", true);
  }, [cancelBuildHold, performBuildAction, popBalloon, showFeedback]);

  const handlePointerMove = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours") return;
    const hold = buildHoldRef.current;
    if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.clientX, event.clientY - hold.clientY) > 12) {
      cancelBuildHold(event.pointerId);
      showFeedback("Hold cancelled — keep the pointer steady", false);
    }
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
        : buildMode === "glue"
          ? validateGluePlacement(room, wall.id).valid && room.economy.coins >= GLUE_COST
          : existingWall;
    previewRef.current = { wall, valid };
  }, [buildMode, cancelBuildHold, showFeedback]);

  const handlePointerUp = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const hold = buildHoldRef.current;
    if (key !== "yours" || !hold || hold.pointerId !== event.pointerId) {
      cancelBuildHold(event.pointerId);
      return;
    }
    cancelBuildHold(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      bounds.width,
      bounds.height,
      28,
    );
    const candidateId = edge
      ? createWallSegment(roomsRef.current.yours.id, edge.orientation, edge.gridX, edge.gridY).id
      : null;
    setSelectedWallId(candidateId && roomsRef.current.yours.walls.some((wall) => wall.id === candidateId) ? candidateId : null);
    setFeedback(null);
  }, [cancelBuildHold]);

  const selectMode = useCallback((mode: BuildMode) => {
    previewRef.current = null;
    setBuildMode(mode);
    setFeedback(null);
  }, []);

  const sendBalloon = useCallback((balloonType: BalloonType) => {
    const opponent = roomsRef.current.opponent;
    sendSequenceRef.current += 1;
    const action = createSendBalloonAction({
      matchId: "local-phase-4",
      senderId: "web-local-player",
      targetRoomId: opponent.id,
      lane: selectedAttackLane,
      senderSequence: sendSequenceRef.current,
      sentAt: Date.now(),
      balloonType,
    });
    const result = applyGameAction(roomsRef.current.yours, action, opponent);
    if (!result.applied) {
      sendSequenceRef.current -= 1;
      setLastSend(`Rejected Lane ${selectedAttackLane}: ${result.message}`);
      return;
    }
    setLastSend(`${balloonType.toUpperCase()} sent to Lane ${selectedAttackLane}`);
    refreshSummary();
  }, [refreshSummary, selectedAttackLane]);

  const repairSelectedWall = useCallback(() => {
    if (!selectedWallId) return;
    const result = applyGameAction(roomsRef.current.yours, { type: "REPAIR_WALL", wallSegmentId: selectedWallId });
    showFeedback(result.message, result.applied);
    if (result.applied) refreshSummary();
  }, [refreshSummary, selectedWallId, showFeedback]);

  const restart = useCallback(() => {
    cancelBuildHold();
    roomsRef.current = createRooms();
    simulationTimeMsRef.current = 0;
    waveStateRef.current = createWaveState(601);
    sendSequenceRef.current = 0;
    effectsRef.current = [];
    previewRef.current = null;
    setSelectedWallId(null);
    setFeedback(null);
    setLastSend("No balloons sent yet");
    setWaveNotice(null);
    refreshSummary();
  }, [cancelBuildHold, refreshSummary]);

  const selectedWall = summary.yours.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedWallRepairable = selectedWall !== null
    && selectedWall.integrity > 0
    && selectedWall.integrity <= WALL_REPAIR_THRESHOLD;
  const currentRound = waveSummary.roundId ? getWaveRound(waveSummary.roundId) : null;

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className={styles.gameFrame}>
        <header className="flex items-center justify-between gap-2 px-1">
          <h1 className="text-lg font-black tracking-tight sm:text-xl">BALLOON ROOMS</h1>
          <div className="flex gap-1">
            <button type="button" aria-pressed={debugPaths} onClick={() => setDebugPaths((value) => !value)} className="min-h-9 rounded-lg border border-white/15 px-2 text-[9px] font-black">PATHS</button>
            <button type="button" onClick={restart} className="min-h-9 rounded-lg border border-white/15 px-2 text-[9px] font-black">RESTART</button>
          </div>
        </header>

        <div className={styles.roundBar}>
          <p className="shrink-0 text-[10px] font-black">{waveSummary.status === "complete" ? "WAVES COMPLETE" : waveSummary.status === "transition" ? `ROUND ${waveSummary.nextRoundId} IN ${waveSummary.nextRoundInSeconds}s` : `ROUND ${waveSummary.roundId} · ${waveSummary.spawnedCount}/${waveSummary.totalCount}`}</p>
          <p className="truncate text-[8px] font-bold text-purple-200">{waveSummary.status === "transition" ? "BUILD WINDOW · HOLD 1s ON A GRID EDGE" : currentRound ? currentRound.composition.map((entry) => `${entry.count} ${entry.balloonType}`).join(" · ") : "PvP ACTIVE"}</p>
          {waveNotice ? <p className="truncate text-[8px] font-black text-emerald-300">{waveNotice}</p> : null}
        </div>

        <div className={styles.roomsGrid}>
          {roomKeys.map((key) => {
            const roomSummary = summary[key];
            const label = key === "yours" ? "YOUR ROOM" : "OPPONENT";
            return (
              <section key={key} className={styles.room} aria-label={label}>
                <h2 className="truncate text-center text-[10px] font-black tracking-[0.12em] text-purple-100 sm:text-xs">{label}</h2>
                <div className={styles.economyPanel} aria-label={`${label} economy`}>
                  <p className="text-sm font-black tabular-nums text-amber-200">● {roomSummary.coins}</p>
                  <p className="text-[8px] font-black tabular-nums text-emerald-300">+{roomSummary.income}/{INCOME_TICK_INTERVAL_MS / 1000}s <span className="text-zinc-500">· {Math.ceil(roomSummary.nextIncomeInMs / 1000)}s</span></p>
                </div>

                <div className={styles.playfield}>
                  <canvas
                    ref={(canvas) => setCanvas(key, canvas)}
                    className={styles.canvas}
                    onPointerDown={(event) => handlePointerDown(key, event)}
                    onPointerMove={(event) => handlePointerMove(key, event)}
                    onPointerUp={(event) => handlePointerUp(key, event)}
                    onPointerCancel={(event) => cancelBuildHold(event.pointerId)}
                    onLostPointerCapture={(event) => cancelBuildHold(event.pointerId)}
                    onPointerLeave={(event) => { if (key === "yours") { cancelBuildHold(event.pointerId); previewRef.current = null; } }}
                    onContextMenu={(event) => event.preventDefault()}
                    aria-label={`${label} balloon playfield. Tap balloons to damage them.${key === "yours" ? " Hold a grid edge to build." : " Choose a lane at the bottom to target it."}`}
                  />
                  {key === "opponent" ? (
                    <div className={styles.lanePicker} aria-label="Choose attack lane">
                      {([1, 2, 3, 4] as SpawnLane[]).map((lane) => (
                        <button key={lane} type="button" aria-label={`Target attack Lane ${lane}`} aria-pressed={selectedAttackLane === lane} onClick={() => setSelectedAttackLane(lane)} className={selectedAttackLane === lane ? styles.laneSelected : undefined}>L{lane}</button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className={styles.statusPanel}>
                  {roomSummary.running ? (
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-black tabular-nums">HP {key === "opponent" ? "∞" : `${roomSummary.health}/${ROOM_MAX_HEALTH}`}</p>
                      <p className="text-right text-[7px] font-bold text-purple-300">{roomSummary.count} ACTIVE<br />W {roomSummary.wallCount}/{MAX_WALL_SEGMENTS} · N {roomSummary.nailCount}/{MAX_NAIL_STRIPS} · G {roomSummary.glueCount}</p>
                    </div>
                  ) : <p className="text-center text-sm font-black text-red-300">ROOM BROKEN</p>}
                </div>

                {key === "yours" ? (
                  <div className={styles.controls}>
                    <div className="grid grid-cols-4 gap-1">
                      {(["wall", "nails", "glue", "remove"] as BuildMode[]).map((mode) => {
                        const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : mode === "glue" ? GLUE_COST : null;
                        return <button key={mode} type="button" aria-pressed={buildMode === mode} disabled={cost !== null && roomSummary.coins < cost} onClick={() => selectMode(mode)} className={`min-h-9 rounded-md border px-0.5 text-[7px] font-black disabled:opacity-40 ${buildMode === mode ? "border-purple-300 bg-purple-500/35 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}<span className="block">{cost ?? "FREE"}</span></button>;
                      })}
                    </div>
                    {selectedWall ? (
                      <div className="mt-1 flex min-h-8 items-center justify-between gap-1 rounded-md border border-amber-200/25 bg-amber-300/10 px-1">
                        <p className="truncate text-[8px] font-black text-amber-100">WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</p>
                        <button type="button" onClick={repairSelectedWall} disabled={!selectedWallRepairable || roomSummary.coins < WALL_REPAIR_COST} className="min-h-7 shrink-0 rounded border border-amber-200/60 px-1 text-[7px] font-black disabled:opacity-40">REPAIR +{WALL_REPAIR_AMOUNT} · {WALL_REPAIR_COST}</button>
                      </div>
                    ) : null}
                    <p className={`mt-1 truncate text-center text-[7px] font-black ${feedback ? (feedback.valid ? "text-emerald-300" : "text-red-300") : "text-zinc-500"}`}>{feedback?.message ?? `Hold 1s to ${buildMode} · repair at ${WALL_REPAIR_THRESHOLD} HP`}</p>
                  </div>
                ) : (
                  <div className={styles.controls}>
                    <p className="mb-1 truncate text-center text-[8px] font-black uppercase text-pink-200">Tap to send · Lane {selectedAttackLane}</p>
                    <div className="grid grid-cols-3 gap-1">
                      {(["basic", "speed", "heavy"] as BalloonType[]).map((balloonType) => {
                        const unlocked = summary.yours.unlockedBalloonTypes[balloonType];
                        const config = BALLOON_TYPES[balloonType];
                        const unavailable = !roomSummary.running || !unlocked || summary.yours.coins < config.cost || summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE;
                        return <button key={balloonType} type="button" disabled={unavailable} onClick={() => sendBalloon(balloonType)} className="min-h-11 rounded-md border border-pink-300/35 bg-gradient-to-b from-purple-600/45 to-pink-600/35 px-0.5 text-[7px] font-black text-white disabled:border-white/10 disabled:bg-none disabled:text-zinc-500 disabled:opacity-55"><span className="block">{balloonType.toUpperCase()}</span><span className="text-[9px] text-amber-200">{unlocked ? config.cost : "LOCK"}</span></button>;
                      })}
                    </div>
                    <div className={styles.queuePanel} aria-label={`Launch queue ${summary.yours.queue.length} of ${MAX_LAUNCH_QUEUE_SIZE}`}>
                      <div className="flex min-h-5 items-center gap-1 overflow-hidden">
                        <span className="shrink-0 text-[7px] font-black text-zinc-500">Q {summary.yours.queue.length}/{MAX_LAUNCH_QUEUE_SIZE}</span>
                        {summary.yours.queue.length > 0 ? summary.yours.queue.map((queued, index) => <span key={`${index}-${queued.balloonType}-${queued.lane}`} className="grid min-w-6 place-items-center rounded-full border border-pink-300/30 bg-pink-500/15 px-1 py-1 text-[7px] font-black text-pink-100">{queued.balloonType[0].toUpperCase()}{queued.lane}</span>) : <span className="text-[7px] font-bold text-zinc-600">EMPTY</span>}
                      </div>
                    </div>
                    <p className={`mt-1 truncate text-center text-[7px] font-bold ${summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE ? "text-red-300" : "text-emerald-300"}`}>{summary.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE ? "QUEUE FULL" : lastSend}</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
