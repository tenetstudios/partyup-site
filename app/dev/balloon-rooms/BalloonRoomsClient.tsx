"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FRAME_DELTA_SECONDS,
  MAX_NAIL_STRIPS,
  MAX_WALL_SEGMENTS,
  ROOM_MAX_HEALTH,
  SIMULATION_STEP_SECONDS,
  applyGameAction,
  createBalloonRoom,
  createSendBalloonAction,
  createWallSegment,
  findBalloonAtPoint,
  findClosestGridEdge,
  getUnsupportedHorizontalWalls,
  hasRequiredRoutes,
  placeNailStrip,
  placeWall,
  updateRoomSimulation,
  validateWallPlacement,
  validateNailPlacement,
  type BalloonRoom,
  type SpawnLane,
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
}>;

const roomKeys: RoomKey[] = ["yours", "opponent"];

function createRooms(): RoomCollection {
  const yours = createBalloonRoom("your-room");
  const opponent = createBalloonRoom("opponent-room");
  placeWall(opponent, createWallSegment(opponent.id, "vertical", 3, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 2, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 3, 5));
  placeNailStrip(opponent, opponent.walls[1].id);
  return { yours, opponent };
}

function summarize(rooms: RoomCollection): RoomSummary {
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
    }];
  })) as RoomSummary;
}

export default function BalloonRoomsClient() {
  const roomsRef = useRef<RoomCollection>(createRooms());
  const sendSequenceRef = useRef(0);
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const effectsRef = useRef<RoomVisualEffect[]>([]);
  const previewRef = useRef<WallPreview>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [buildMode, setBuildMode] = useState<BuildMode>("wall");
  const [selectedAttackLane, setSelectedAttackLane] = useState<SpawnLane>(1);
  const [debugPaths, setDebugPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [lastNailContact, setLastNailContact] = useState("No nail contacts yet");
  const [lastSend, setLastSend] = useState("No balloons sent yet");
  const [summary, setSummary] = useState<RoomSummary>({
    yours: { health: ROOM_MAX_HEALTH, count: 0, running: true, wallCount: 0, verticalCount: 0, horizontalCount: 0, supportedHorizontalCount: 0, routesValid: true, nailCount: 0, brokenNailCount: 0 },
    opponent: { health: ROOM_MAX_HEALTH, count: 0, running: true, wallCount: 3, verticalCount: 1, horizontalCount: 2, supportedHorizontalCount: 2, routesValid: true, nailCount: 1, brokenNailCount: 0 },
  });

  const refreshSummary = useCallback(() => setSummary(summarize(roomsRef.current)), []);
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

    const frame = (now: number) => {
      accumulator += Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      let summaryChanged = false;
      while (accumulator >= SIMULATION_STEP_SECONDS) {
        for (const key of roomKeys) {
          const room = roomsRef.current[key];
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
        accumulator -= SIMULATION_STEP_SECONDS;
      }

      if (summaryChanged) refreshSummary();
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
      ? validateWallPlacement(room, wall).valid
      : buildMode === "nails"
        ? validateNailPlacement(room, wall.id).valid
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
    });
    const result = applyGameAction(opponent, action);
    if (!result.applied) {
      sendSequenceRef.current -= 1;
      setLastSend(`Rejected Lane ${selectedAttackLane}: ${result.message}`);
      return;
    }
    setLastSend(`${action.balloonId} → Lane ${selectedAttackLane}`);
    refreshSummary();
  }, [refreshSummary, selectedAttackLane]);

  const restart = useCallback(() => {
    roomsRef.current = createRooms();
    sendSequenceRef.current = 0;
    effectsRef.current = [];
    previewRef.current = null;
    setFeedback(null);
    setLastNailContact("No nail contacts yet");
    setLastSend("No balloons sent yet");
    refreshSummary();
  }, [refreshSummary]);

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className="mx-auto max-w-3xl px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <header className="mb-3 flex items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-pink-300">Phase 4 · Local test</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">BALLOON ROOMS</h1>
          </div>
          <div className="flex gap-1">
            <button type="button" aria-pressed={debugPaths} onClick={() => setDebugPaths((current) => !current)} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">PATHS</button>
            <button type="button" onClick={restart} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">RESTART</button>
          </div>
        </header>

        <p className="mb-3 px-1 text-xs font-bold text-zinc-400">Defend your room, choose an opponent lane, and send Basic Balloons. Tap balloons anytime to deal 1 damage.</p>
        <div className={styles.roomsGrid}>
          {roomKeys.map((key) => {
            const roomSummary = summary[key];
            const label = key === "yours" ? "YOUR ROOM" : "OPPONENT ROOM";
            return (
              <section key={key} className={styles.room} aria-label={label}>
                <h2 className="mb-2 truncate text-center text-[11px] font-black tracking-[0.12em] text-purple-100 sm:text-sm">{label}</h2>
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
                      {(["wall", "nails", "remove"] as BuildMode[]).map((mode) => <button key={mode} type="button" aria-pressed={buildMode === mode} onClick={() => selectMode(mode)} className={`min-h-11 rounded-md border px-1 text-[10px] font-black ${buildMode === mode ? "border-purple-300 bg-purple-500/35 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}</button>)}
                    </div>
                    <p className={`mt-2 min-h-4 text-center text-[10px] font-black ${feedback ? (feedback.valid ? "text-emerald-300" : "text-red-300") : "text-zinc-500"}`}>{feedback?.message ?? `${MAX_WALL_SEGMENTS - roomSummary.wallCount} walls · ${MAX_NAIL_STRIPS - roomSummary.nailCount} nails available`}</p>
                  </div>
                ) : (
                  <div className={`${styles.controls} mt-2 p-2`}>
                    <p className="mb-2 text-center text-[9px] font-black uppercase tracking-[0.14em] text-pink-200">Choose attack lane</p>
                    <div className="grid grid-cols-4 gap-1">
                      {([1, 2, 3, 4] as SpawnLane[]).map((lane) => (
                        <button key={lane} type="button" aria-label={`Select attack Lane ${lane}`} aria-pressed={selectedAttackLane === lane} onClick={() => setSelectedAttackLane(lane)} className={`min-h-11 rounded-md border text-xs font-black ${selectedAttackLane === lane ? "border-pink-300 bg-pink-500/40 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>L{lane}</button>
                      ))}
                    </div>
                    <button type="button" onClick={sendBalloon} disabled={!roomSummary.running} className="mt-2 min-h-12 w-full rounded-md border border-pink-300/70 bg-gradient-to-r from-purple-600 to-pink-600 text-xs font-black tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-40">SEND BASIC BALLOON</button>
                    <p className="mt-2 min-h-4 truncate text-center text-[9px] font-bold text-zinc-500">Selected Lane {selectedAttackLane} · no cost or cooldown</p>
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
