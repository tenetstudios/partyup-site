"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BALLOON_TYPES,
  GLUE_COST,
  INCOME_TICK_INTERVAL_MS,
  MAX_FRAME_DELTA_SECONDS,
  MAX_LAUNCH_QUEUE_SIZE,
  MAX_NAIL_STRIPS,
  MAX_WALL_SEGMENTS,
  NAIL_STRIP_COST,
  ROOM_MAX_HEALTH,
  SIMULATION_STEP_SECONDS,
  VERTICAL_WALL_COST,
  WALL_REPAIR_AMOUNT,
  WALL_REPAIR_COST,
  WALL_REPAIR_THRESHOLD,
  applyFloatMatchAction,
  createFloatMatch,
  createWallSegment,
  findBalloonAtPoint,
  findClosestGridEdge,
  getCurrentWaveRound,
  getOpponentPlayerId,
  getWaveRound,
  updateFloatMatch,
  validateGluePlacement,
  validateNailPlacement,
  validateWallPlacement,
  type BalloonRoom,
  type BalloonType,
  type FloatMatchAction,
  type FloatMatchState,
  type GameAction,
  type SpawnLane,
  type WallSegment,
  type WaveState,
} from "@partyup/balloon-core";
import { drawBalloonRoom, getWallCenter, type RoomVisualEffect, type WallPreview } from "@/lib/balloonRooms/rendering";
import styles from "./BalloonRooms.module.css";

type PlayerId = "playerA" | "playerB";
type ViewRoomKey = "yours" | "opponent";
type BuildMode = "wall" | "nails" | "glue" | "remove";
type CanvasCollection = Record<ViewRoomKey, HTMLCanvasElement | null>;

type RoomSummary = {
  health: number;
  count: number;
  running: boolean;
  wallCount: number;
  nailCount: number;
  glueCount: number;
  coins: number;
  income: number;
  nextIncomeInMs: number;
  queue: { balloonType: BalloonType; lane: SpawnLane }[];
  unlockedBalloonTypes: Record<BalloonType, boolean>;
  walls: WallSegment[];
};

type WaveSummary = {
  status: WaveState["status"];
  roundId: number | null;
  nextRoundId: number | null;
  spawnedCount: number;
  totalCount: number;
  nextRoundInSeconds: number;
};

const playerIds: [PlayerId, PlayerId] = ["playerA", "playerB"];
const viewRoomKeys: ViewRoomKey[] = ["yours", "opponent"];

function createDevMatch(): FloatMatchState {
  return createFloatMatch({ matchId: "local-phase-8", playerIds, seed: 601 });
}

function summarizeRoom(room: BalloonRoom, simulationTimeMs: number): RoomSummary {
  return {
    health: room.health,
    count: room.balloons.length,
    running: room.health > 0,
    wallCount: room.walls.length,
    nailCount: room.nailStrips.length,
    glueCount: room.glueTraps.length,
    coins: room.economy.coins,
    income: room.economy.income,
    nextIncomeInMs: Math.max(0, room.economy.nextIncomeTickAt - simulationTimeMs),
    queue: room.attack.queue.map((queued) => ({ balloonType: queued.balloonType, lane: queued.lane })),
    unlockedBalloonTypes: { ...room.unlockedBalloonTypes },
    walls: room.walls.map((wall) => ({ ...wall })),
  };
}

function summarizeWave(match: FloatMatchState): WaveSummary {
  const state = match.waveState;
  const round = getCurrentWaveRound(state);
  const nextRoundIndex = state.status !== "transition" ? state.roundIndex : state.transitionFromRoundId === null ? state.roundIndex : state.roundIndex + 1;
  return {
    status: state.status,
    roundId: round?.id ?? null,
    nextRoundId: getWaveRound(nextRoundIndex + 1)?.id ?? null,
    spawnedCount: state.spawnedCount,
    totalCount: round?.composition.reduce((sum, entry) => sum + entry.count, 0) ?? 0,
    nextRoundInSeconds: state.transitionEndsAt === null ? 0 : Math.max(0, Math.ceil((state.transitionEndsAt - match.simulationTimeMs) / 1000)),
  };
}

export default function BalloonRoomsClient() {
  const [initialMatch] = useState(createDevMatch);
  const matchRef = useRef<FloatMatchState>(initialMatch);
  const [matchSnapshot, setMatchSnapshot] = useState<FloatMatchState>(() => structuredClone(initialMatch));
  const sendSequenceRef = useRef<Record<PlayerId, number>>({ playerA: 0, playerB: 0 });
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const effectsRef = useRef<RoomVisualEffect[]>([]);
  const previewRef = useRef<WallPreview>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const buildHoldRef = useRef<{ pointerId: number; clientX: number; clientY: number; timeoutId: number } | null>(null);
  const [viewAs, setViewAs] = useState<PlayerId>("playerA");
  const [buildModes, setBuildModes] = useState<Record<PlayerId, BuildMode>>({ playerA: "wall", playerB: "wall" });
  const [selectedWallIds, setSelectedWallIds] = useState<Record<PlayerId, string | null>>({ playerA: null, playerB: null });
  const [attackLanes, setAttackLanes] = useState<Record<PlayerId, SpawnLane>>({ playerA: 1, playerB: 1 });
  const [lastSends, setLastSends] = useState<Record<PlayerId, string>>({ playerA: "No balloons sent yet", playerB: "No balloons sent yet" });
  const [debugPaths, setDebugPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [waveNotice, setWaveNotice] = useState<string | null>(null);

  const refresh = useCallback(() => setMatchSnapshot(structuredClone(matchRef.current)), []);
  const showFeedback = useCallback((message: string, valid: boolean) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ message, valid });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1600);
  }, []);
  const getPerspectiveIds = useCallback((): { yours: PlayerId; opponent: PlayerId } => ({ yours: viewAs, opponent: viewAs === "playerA" ? "playerB" : "playerA" }), [viewAs]);

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
      let changed = false;
      while (accumulator >= SIMULATION_STEP_SECONDS) {
        const update = updateFloatMatch(matchRef.current, SIMULATION_STEP_SECONDS);
        if (update.launchedBalloons.length > 0 || update.waveResult.spawnedBalloons.length > 0) changed = true;
        for (const playerId of playerIds) {
          const room = matchRef.current.players[playerId]!.room;
          for (const event of update.roomEvents[playerId] ?? []) {
            changed = true;
            if (event.type === "balloon_escaped") effectsRef.current.push({ roomKey: playerId, x: event.balloon.x, y: 0.02, kind: "escape", startedAt: now });
            else if (event.type === "nail_contact") {
              const balloon = room.balloons.find((candidate) => candidate.id === event.balloonId);
              if (balloon) effectsRef.current.push({ roomKey: playerId, x: balloon.x, y: balloon.y, kind: event.popped ? "pop" : "nail", startedAt: now });
            } else if (event.type === "wall_damage" && !event.destroyed) {
              const wall = room.walls.find((candidate) => candidate.id === event.wallSegmentId);
              if (wall) effectsRef.current.push({ roomKey: playerId, ...getWallCenter(wall), kind: "wall", label: `-${event.damage}`, startedAt: now });
            } else if (event.type === "wall_destroyed") {
              for (const wall of [event.wall, ...event.collapsedWalls]) effectsRef.current.push({ roomKey: playerId, ...getWallCenter(wall), kind: "collapse", label: wall.id === event.wall.id ? "BREAK" : "COLLAPSE", startedAt: now });
            }
          }
        }
        if (update.waveResult.unlockedBalloonType) setWaveNotice(`${update.waveResult.unlockedBalloonType.toUpperCase()} BALLOON UNLOCKED FOR BOTH PLAYERS`);
        else if (update.waveResult.completedRoundId !== null) setWaveNotice(`ROUND ${update.waveResult.completedRoundId} COMPLETE`);
        else if (update.waveResult.startedRoundId !== null) setWaveNotice(null);
        if (update.completedResult) setWaveNotice(update.completedResult.type === "draw" ? "DRAW" : `${update.completedResult.winnerPlayerId === "playerA" ? "PLAYER A" : "PLAYER B"} WINS`);
        accumulator -= SIMULATION_STEP_SECONDS;
      }

      if (changed || now - previousHudTime >= 250) {
        previousHudTime = now;
        refresh();
      }
      effectsRef.current = effectsRef.current.filter((effect) => now - effect.startedAt < 500);
      const perspective = getPerspectiveIds();
      for (const key of viewRoomKeys) {
        const canvas = canvasesRef.current[key];
        const playerId = perspective[key];
        if (canvas) drawBalloonRoom(canvas, matchRef.current.players[playerId]!.room, playerId, effectsRef.current, now, {
          debugPaths,
          preview: key === "yours" ? previewRef.current : null,
          selectedWallId: key === "yours" ? selectedWallIds[playerId] : null,
        });
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [debugPaths, getPerspectiveIds, refresh, selectedWallIds]);

  const cancelBuildHold = useCallback((pointerId?: number) => {
    const hold = buildHoldRef.current;
    if (!hold || (pointerId !== undefined && hold.pointerId !== pointerId)) return;
    window.clearTimeout(hold.timeoutId);
    buildHoldRef.current = null;
  }, []);

  const switchPerspective = useCallback((playerId: PlayerId) => {
    cancelBuildHold();
    previewRef.current = null;
    setFeedback(null);
    setViewAs(playerId);
  }, [cancelBuildHold]);

  const popBalloon = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const room = matchRef.current.players[viewAs]!.room;
    const bounds = canvas.getBoundingClientRect();
    const balloon = findBalloonAtPoint(room, (clientX - bounds.left) / bounds.width, (clientY - bounds.top) / bounds.height, 22 / Math.min(bounds.width, bounds.height));
    if (!balloon) return false;
    const result = applyFloatMatchAction(matchRef.current, { type: "POP_BALLOON", actorPlayerId: viewAs, balloonId: balloon.id });
    if (result.applied && result.damage) effectsRef.current.push({ roomKey: viewAs, x: balloon.x, y: balloon.y, kind: result.damage.popped ? "pop" : "tap", startedAt: performance.now() });
    showFeedback(result.message, result.applied);
    if (result.applied) refresh();
    return true;
  }, [refresh, showFeedback, viewAs]);

  const performBuildAction = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const bounds = canvas.getBoundingClientRect();
    const edge = findClosestGridEdge((clientX - bounds.left) / bounds.width, (clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
    if (!edge) { showFeedback("Hold directly on a grid edge", false); return; }
    const room = matchRef.current.players[viewAs]!.room;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const mode = buildModes[viewAs];
    const roomAction: GameAction = mode === "wall" ? { type: "PLACE_WALL", wall } : mode === "nails" ? { type: "PLACE_NAILS", wallSegmentId: wall.id } : mode === "glue" ? { type: "PLACE_GLUE", wallSegmentId: wall.id } : { type: "REMOVE_WALL", wallSegmentId: wall.id };
    const result = applyFloatMatchAction(matchRef.current, { ...roomAction, actorPlayerId: viewAs } as FloatMatchAction);
    showFeedback(result.message, result.applied);
    if (result.applied) refresh();
    previewRef.current = null;
  }, [buildModes, refresh, showFeedback, viewAs]);

  const handlePointerDown = useCallback((key: ViewRoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || key !== "yours") return;
    const canvas = event.currentTarget;
    if (popBalloon(canvas, event.clientX, event.clientY)) return;
    cancelBuildHold();
    canvas.setPointerCapture(event.pointerId);
    const hold = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, timeoutId: 0 };
    hold.timeoutId = window.setTimeout(() => {
      if (buildHoldRef.current?.pointerId !== hold.pointerId) return;
      buildHoldRef.current = null;
      performBuildAction(canvas, hold.clientX, hold.clientY);
    }, 1000);
    buildHoldRef.current = hold;
    showFeedback("Hold steady for 1 second to build", true);
  }, [cancelBuildHold, performBuildAction, popBalloon, showFeedback]);

  const handlePointerMove = useCallback((key: ViewRoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours") return;
    const hold = buildHoldRef.current;
    if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.clientX, event.clientY - hold.clientY) > 12) cancelBuildHold(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
    if (!edge) { previewRef.current = null; return; }
    const room = matchRef.current.players[viewAs]!.room;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const mode = buildModes[viewAs];
    const valid = mode === "wall" ? validateWallPlacement(room, wall).valid && room.economy.coins >= VERTICAL_WALL_COST : mode === "nails" ? validateNailPlacement(room, wall.id).valid && room.economy.coins >= NAIL_STRIP_COST : mode === "glue" ? validateGluePlacement(room, wall.id).valid && room.economy.coins >= GLUE_COST : room.walls.some((candidate) => candidate.id === wall.id);
    previewRef.current = { wall, valid };
  }, [buildModes, cancelBuildHold, viewAs]);

  const handlePointerUp = useCallback((key: ViewRoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const hold = buildHoldRef.current;
    if (key !== "yours" || !hold || hold.pointerId !== event.pointerId) { cancelBuildHold(event.pointerId); return; }
    cancelBuildHold(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height, 28);
    const room = matchRef.current.players[viewAs]!.room;
    const candidateId = edge ? createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY).id : null;
    setSelectedWallIds((current) => ({ ...current, [viewAs]: candidateId && room.walls.some((wall) => wall.id === candidateId) ? candidateId : null }));
    setFeedback(null);
  }, [cancelBuildHold, viewAs]);

  const sendBalloon = useCallback((balloonType: BalloonType) => {
    const targetPlayerId = getOpponentPlayerId(matchRef.current, viewAs) as PlayerId;
    sendSequenceRef.current[viewAs] += 1;
    const result = applyFloatMatchAction(matchRef.current, { type: "SEND_BALLOON", actorPlayerId: viewAs, targetPlayerId, lane: attackLanes[viewAs], senderSequence: sendSequenceRef.current[viewAs], sentAt: matchRef.current.simulationTimeMs, balloonType });
    if (!result.applied) sendSequenceRef.current[viewAs] -= 1;
    setLastSends((current) => ({ ...current, [viewAs]: result.applied ? `${balloonType.toUpperCase()} sent to Lane ${attackLanes[viewAs]}` : result.message }));
    if (result.applied) refresh();
  }, [attackLanes, refresh, viewAs]);

  const repairSelectedWall = useCallback(() => {
    const wallSegmentId = selectedWallIds[viewAs];
    if (!wallSegmentId) return;
    const result = applyFloatMatchAction(matchRef.current, { type: "REPAIR_WALL", actorPlayerId: viewAs, wallSegmentId });
    showFeedback(result.message, result.applied);
    if (result.applied) refresh();
  }, [refresh, selectedWallIds, showFeedback, viewAs]);

  const restart = useCallback(() => {
    cancelBuildHold();
    matchRef.current = createDevMatch();
    sendSequenceRef.current = { playerA: 0, playerB: 0 };
    effectsRef.current = [];
    previewRef.current = null;
    setSelectedWallIds({ playerA: null, playerB: null });
    setAttackLanes({ playerA: 1, playerB: 1 });
    setLastSends({ playerA: "No balloons sent yet", playerB: "No balloons sent yet" });
    setFeedback(null);
    setWaveNotice(null);
    refresh();
  }, [cancelBuildHold, refresh]);

  const match = matchSnapshot;
  const perspective = getPerspectiveIds();
  const summaries = { yours: summarizeRoom(match.players[perspective.yours]!.room, match.simulationTimeMs), opponent: summarizeRoom(match.players[perspective.opponent]!.room, match.simulationTimeMs) };
  const waveSummary = summarizeWave(match);
  const currentRound = waveSummary.roundId ? getWaveRound(waveSummary.roundId) : null;
  const selectedWall = summaries.yours.walls.find((wall) => wall.id === selectedWallIds[viewAs]) ?? null;
  const selectedWallRepairable = selectedWall !== null && selectedWall.integrity > 0 && selectedWall.integrity <= WALL_REPAIR_THRESHOLD;
  const buildMode = buildModes[viewAs];
  const selectedAttackLane = attackLanes[viewAs];

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className={styles.gameFrame}>
        <header className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2"><h1 className="text-lg font-black tracking-tight sm:text-xl">FLOAT</h1><div className={styles.perspectivePicker} aria-label="Development player perspective">{playerIds.map((playerId) => <button key={playerId} type="button" aria-pressed={viewAs === playerId} onClick={() => switchPerspective(playerId)} className={viewAs === playerId ? styles.perspectiveSelected : undefined}>VIEW AS {playerId === "playerA" ? "A" : "B"}</button>)}</div></div>
          <div className="flex gap-1"><button type="button" aria-pressed={debugPaths} onClick={() => setDebugPaths((value) => !value)} className="min-h-9 rounded-lg border border-white/15 px-2 text-[9px] font-black">PATHS</button><button type="button" onClick={restart} className="min-h-9 rounded-lg border border-white/15 px-2 text-[9px] font-black">RESTART</button></div>
        </header>

        <div className={styles.roundBar}>
          <p className="shrink-0 text-[10px] font-black">{match.status === "complete" ? (match.result?.type === "draw" ? "DRAW" : `${match.result?.winnerPlayerId === "playerA" ? "PLAYER A" : "PLAYER B"} WINS`) : waveSummary.status === "transition" ? `ROUND ${waveSummary.nextRoundId} IN ${waveSummary.nextRoundInSeconds}s` : `ROUND ${waveSummary.roundId} · ${waveSummary.spawnedCount}/${waveSummary.totalCount}`}</p>
          <p className="truncate text-[8px] font-bold text-purple-200">{waveSummary.status === "transition" ? "BUILD WINDOW · HOLD 1s ON A GRID EDGE" : currentRound ? currentRound.composition.map((entry) => `${entry.count} ${entry.balloonType}`).join(" · ") : "PVP ACTIVE"}</p>
          {waveNotice ? <p className="truncate text-[8px] font-black text-emerald-300">{waveNotice}</p> : null}
        </div>

        <div className={styles.roomsGrid}>
          {viewRoomKeys.map((key) => {
            const roomSummary = summaries[key];
            const playerId = perspective[key];
            const label = key === "yours" ? `YOUR ROOM · ${playerId === "playerA" ? "A" : "B"}` : `OPPONENT · ${playerId === "playerA" ? "A" : "B"}`;
            return <section key={key} className={styles.room} aria-label={label}>
              <h2 className="truncate text-center text-[10px] font-black tracking-[0.12em] text-purple-100 sm:text-xs">{label}</h2>
              <div className={styles.economyPanel}><p className="text-sm font-black tabular-nums text-amber-200">● {roomSummary.coins}</p><p className="text-[8px] font-black tabular-nums text-emerald-300">+{roomSummary.income}/{INCOME_TICK_INTERVAL_MS / 1000}s <span className="text-zinc-500">· {Math.ceil(roomSummary.nextIncomeInMs / 1000)}s</span></p></div>
              <div className={styles.playfield}>
                <canvas ref={(canvas) => { canvasesRef.current[key] = canvas; }} className={styles.canvas} onPointerDown={(event) => handlePointerDown(key, event)} onPointerMove={(event) => handlePointerMove(key, event)} onPointerUp={(event) => handlePointerUp(key, event)} onPointerCancel={(event) => cancelBuildHold(event.pointerId)} onLostPointerCapture={(event) => cancelBuildHold(event.pointerId)} onPointerLeave={(event) => { if (key === "yours") { cancelBuildHold(event.pointerId); previewRef.current = null; } }} onContextMenu={(event) => event.preventDefault()} aria-label={`${label} playfield`} />
                {key === "opponent" ? <div className={styles.lanePicker} aria-label="Choose attack lane">{([1, 2, 3, 4] as SpawnLane[]).map((lane) => <button key={lane} type="button" aria-label={`Target Lane ${lane}`} aria-pressed={selectedAttackLane === lane} onClick={() => setAttackLanes((current) => ({ ...current, [viewAs]: lane }))} className={selectedAttackLane === lane ? styles.laneSelected : undefined}>L{lane}</button>)}</div> : null}
              </div>
              <div className={styles.statusPanel}>{roomSummary.running ? <div className="flex items-center justify-between gap-1"><p className="text-sm font-black tabular-nums">HP {roomSummary.health}/{ROOM_MAX_HEALTH}</p><p className="text-right text-[7px] font-bold text-purple-300">{roomSummary.count} ACTIVE<br />W {roomSummary.wallCount}/{MAX_WALL_SEGMENTS} · N {roomSummary.nailCount}/{MAX_NAIL_STRIPS} · G {roomSummary.glueCount}</p></div> : <p className="text-center text-sm font-black text-red-300">ROOM BROKEN</p>}</div>
              {key === "yours" ? <div className={styles.controls}>
                <div className="grid grid-cols-4 gap-1">{(["wall", "nails", "glue", "remove"] as BuildMode[]).map((mode) => { const cost = mode === "wall" ? VERTICAL_WALL_COST : mode === "nails" ? NAIL_STRIP_COST : mode === "glue" ? GLUE_COST : null; return <button key={mode} type="button" aria-pressed={buildMode === mode} disabled={match.status === "complete" || (cost !== null && roomSummary.coins < cost)} onClick={() => { setBuildModes((current) => ({ ...current, [viewAs]: mode })); setFeedback(null); }} className={`min-h-9 rounded-md border px-0.5 text-[7px] font-black disabled:opacity-40 ${buildMode === mode ? "border-purple-300 bg-purple-500/35 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}<span className="block">{cost ?? "FREE"}</span></button>; })}</div>
                {selectedWall ? <div className="mt-1 flex min-h-8 items-center justify-between gap-1 rounded-md border border-amber-200/25 bg-amber-300/10 px-1"><p className="truncate text-[8px] font-black text-amber-100">WALL {selectedWall.integrity}/{selectedWall.maxIntegrity}</p><button type="button" onClick={repairSelectedWall} disabled={match.status === "complete" || !selectedWallRepairable || roomSummary.coins < WALL_REPAIR_COST} className="min-h-7 shrink-0 rounded border border-amber-200/60 px-1 text-[7px] font-black disabled:opacity-40">REPAIR +{WALL_REPAIR_AMOUNT} · {WALL_REPAIR_COST}</button></div> : null}
                <p className={`mt-1 truncate text-center text-[7px] font-black ${feedback ? (feedback.valid ? "text-emerald-300" : "text-red-300") : "text-zinc-500"}`}>{feedback?.message ?? `Hold 1s to ${buildMode} · repair at ${WALL_REPAIR_THRESHOLD} HP`}</p>
              </div> : <div className={styles.controls}>
                <p className="mb-1 truncate text-center text-[8px] font-black uppercase text-pink-200">Tap to send · Lane {selectedAttackLane}</p>
                <div className="grid grid-cols-3 gap-1">{(["basic", "speed", "heavy"] as BalloonType[]).map((balloonType) => { const unlocked = summaries.yours.unlockedBalloonTypes[balloonType]; const config = BALLOON_TYPES[balloonType]; const unavailable = match.status === "complete" || !summaries.opponent.running || !unlocked || summaries.yours.coins < config.cost || summaries.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE; return <button key={balloonType} type="button" disabled={unavailable} onClick={() => sendBalloon(balloonType)} className="min-h-11 rounded-md border border-pink-300/35 bg-gradient-to-b from-purple-600/45 to-pink-600/35 px-0.5 text-[7px] font-black text-white disabled:border-white/10 disabled:bg-none disabled:text-zinc-500 disabled:opacity-55"><span className="block">{balloonType.toUpperCase()}</span><span className="text-[9px] text-amber-200">{unlocked ? config.cost : "LOCK"}</span></button>; })}</div>
                <div className={styles.queuePanel}><div className="flex min-h-5 items-center gap-1 overflow-hidden"><span className="shrink-0 text-[7px] font-black text-zinc-500">Q {summaries.yours.queue.length}/{MAX_LAUNCH_QUEUE_SIZE}</span>{summaries.yours.queue.length > 0 ? summaries.yours.queue.map((queued, index) => <span key={`${index}-${queued.balloonType}-${queued.lane}`} className="grid min-w-6 place-items-center rounded-full border border-pink-300/30 bg-pink-500/15 px-1 py-1 text-[7px] font-black text-pink-100">{queued.balloonType[0].toUpperCase()}{queued.lane}</span>) : <span className="text-[7px] font-bold text-zinc-600">EMPTY</span>}</div></div>
                <p className={`mt-1 truncate text-center text-[7px] font-bold ${summaries.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE ? "text-red-300" : "text-emerald-300"}`}>{summaries.yours.queue.length >= MAX_LAUNCH_QUEUE_SIZE ? "QUEUE FULL" : lastSends[viewAs]}</p>
              </div>}
            </section>;
          })}
        </div>
      </div>
    </main>
  );
}
