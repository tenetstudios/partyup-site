"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_FRAME_DELTA_SECONDS, MAX_WALL_SEGMENTS, ROOM_MAX_HEALTH, SIMULATION_STEP_SECONDS, WALL_REMOVE_HOLD_MS } from "@/lib/balloonRooms/constants";
import { createWallSegment, findClosestGridEdge } from "@/lib/balloonRooms/grid";
import { drawBalloonRoom, type RoomVisualEffect, type WallPreview } from "@/lib/balloonRooms/rendering";
import {
  createBalloonRoom,
  createDevBalloonSpawner,
  damageBalloon,
  findBalloonAtPoint,
  updateDevBalloonSpawner,
  updateRoomSimulation,
  type DevBalloonSpawner,
} from "@/lib/balloonRooms/simulation";
import type { BalloonRoom, WallSegment } from "@/lib/balloonRooms/types";
import {
  getUnsupportedHorizontalWalls,
  hasRequiredRoutes,
  placeWall,
  removeWall,
  validateWallPlacement,
} from "@/lib/balloonRooms/walls";
import styles from "./BalloonRooms.module.css";

type RoomKey = "yours" | "opponent";
type BuildMode = "pop" | "wall";
type RoomCollection = Record<RoomKey, BalloonRoom>;
type SpawnerCollection = Record<RoomKey, DevBalloonSpawner>;
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
}>;

const roomKeys: RoomKey[] = ["yours", "opponent"];

function createRooms(): RoomCollection {
  const yours = createBalloonRoom("your-room");
  const opponent = createBalloonRoom("opponent-room");
  placeWall(opponent, createWallSegment(opponent.id, "vertical", 3, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 2, 5));
  placeWall(opponent, createWallSegment(opponent.id, "horizontal", 3, 5));
  return { yours, opponent };
}

function createSpawners(): SpawnerCollection {
  return { yours: createDevBalloonSpawner(410), opponent: createDevBalloonSpawner(920) };
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
    }];
  })) as RoomSummary;
}

export default function BalloonRoomsClient() {
  const roomsRef = useRef<RoomCollection>(createRooms());
  const spawnersRef = useRef<SpawnerCollection>(createSpawners());
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const effectsRef = useRef<RoomVisualEffect[]>([]);
  const previewRef = useRef<WallPreview>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const wallHoldTimerRef = useRef<number | null>(null);
  const wallPressRef = useRef<{ pointerId: number; wall: WallSegment; triggered: boolean } | null>(null);
  const [buildMode, setBuildMode] = useState<BuildMode>("pop");
  const [debugPaths, setDebugPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; valid: boolean } | null>(null);
  const [summary, setSummary] = useState<RoomSummary>({
    yours: { health: ROOM_MAX_HEALTH, count: 0, running: true, wallCount: 0, verticalCount: 0, horizontalCount: 0, supportedHorizontalCount: 0, routesValid: true },
    opponent: { health: ROOM_MAX_HEALTH, count: 0, running: true, wallCount: 3, verticalCount: 1, horizontalCount: 2, supportedHorizontalCount: 2, routesValid: true },
  });

  const refreshSummary = useCallback(() => setSummary(summarize(roomsRef.current)), []);
  const showFeedback = useCallback((message: string, valid: boolean) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ message, valid });
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1600);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
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
          const spawned = updateDevBalloonSpawner(room, spawnersRef.current[key], SIMULATION_STEP_SECONDS);
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (spawned.length > 0 || events.length > 0) summaryChanged = true;
          for (const event of events) {
            if (event.type === "balloon_escaped") {
              effectsRef.current.push({ roomKey: key, x: event.balloon.x, y: 0.02, kind: "escape", startedAt: now });
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
    const result = damageBalloon(roomsRef.current[key], balloon.id);
    if (!result) return;
    effectsRef.current.push({ roomKey: key, x: balloon.x, y: balloon.y, kind: result.popped ? "pop" : "tap", startedAt: performance.now() });
    refreshSummary();
  }, [refreshSummary]);

  const handlePointerDown = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    if (key === "opponent" || buildMode === "pop") {
      popBalloon(key, canvas, event.clientX, event.clientY);
      return;
    }

    const edge = findClosestGridEdge(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      bounds.width,
      bounds.height,
    );
    if (!edge) {
      showFeedback("Tap a grid edge", false);
      return;
    }
    const room = roomsRef.current.yours;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
    canvas.setPointerCapture(event.pointerId);
    wallPressRef.current = { pointerId: event.pointerId, wall, triggered: false };
    const existingWall = room.walls.some((candidate) => candidate.id === wall.id);
    previewRef.current = { wall, valid: existingWall || validateWallPlacement(room, wall).valid };
    wallHoldTimerRef.current = window.setTimeout(() => {
      const press = wallPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      press.triggered = true;
      const result = removeWall(roomsRef.current.yours, press.wall.id);
      previewRef.current = null;
      showFeedback(result.valid ? "Wall removed" : result.code === "not_found" ? "Hold an existing wall" : result.message, result.valid);
      if (result.valid) refreshSummary();
    }, WALL_REMOVE_HOLD_MS);
  }, [buildMode, popBalloon, refreshSummary, showFeedback]);

  const finishWallPress = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const press = wallPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
    wallHoldTimerRef.current = null;
    if (!press.triggered) {
      const room = roomsRef.current.yours;
      const result = placeWall(room, press.wall);
      showFeedback(result.message, result.valid);
      if (result.valid) refreshSummary();
    }
    previewRef.current = null;
    wallPressRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [refreshSummary, showFeedback]);

  const cancelWallPress = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const press = wallPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
    wallHoldTimerRef.current = null;
    wallPressRef.current = null;
    previewRef.current = null;
  }, []);

  const handlePointerMove = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (key !== "yours" || buildMode === "pop" || event.pointerType === "touch" || wallPressRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = findClosestGridEdge((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height, bounds.width, bounds.height);
    if (!edge) {
      previewRef.current = null;
      return;
    }
    const room = roomsRef.current.yours;
    const wall = createWallSegment(room.id, edge.orientation, edge.gridX, edge.gridY);
    const validation = validateWallPlacement(room, wall);
    previewRef.current = { wall, valid: validation.valid };
  }, [buildMode]);

  const selectMode = useCallback((mode: BuildMode) => {
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
    wallHoldTimerRef.current = null;
    wallPressRef.current = null;
    previewRef.current = null;
    setBuildMode(mode);
    setFeedback(null);
  }, []);

  const restart = useCallback(() => {
    if (wallHoldTimerRef.current !== null) window.clearTimeout(wallHoldTimerRef.current);
    wallHoldTimerRef.current = null;
    wallPressRef.current = null;
    roomsRef.current = createRooms();
    spawnersRef.current = createSpawners();
    effectsRef.current = [];
    previewRef.current = null;
    setFeedback(null);
    refreshSummary();
  }, [refreshSummary]);

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className="mx-auto max-w-3xl px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <header className="mb-3 flex items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-pink-300">Phase 2 · Local test</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">BALLOON ROOMS</h1>
          </div>
          <div className="flex gap-1">
            <button type="button" aria-pressed={debugPaths} onClick={() => setDebugPaths((current) => !current)} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">PATHS</button>
            <button type="button" onClick={restart} className="min-h-11 rounded-lg border border-white/15 px-2 text-[10px] font-black text-zinc-200 active:bg-white/10">RESTART</button>
          </div>
        </header>

        <p className="mb-3 px-1 text-xs font-bold text-zinc-400">Choose POP for balloons. In WALL mode, tap to build or hold a wall for one second to remove it.</p>
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
                    onPointerUp={(event) => { if (key === "yours" && buildMode === "wall") finishWallPress(event); }}
                    onPointerCancel={(event) => { if (key === "yours") cancelWallPress(event); }}
                    onPointerMove={(event) => handlePointerMove(key, event)}
                    onPointerLeave={() => { if (key === "yours" && !wallPressRef.current) previewRef.current = null; }}
                    onContextMenu={(event) => event.preventDefault()}
                    aria-label={`${label} balloon playfield.`}
                  />
                </div>
                <div className={`${styles.statusPanel} p-3`}>
                  {roomSummary.running ? <>
                    <div className="flex items-center justify-between gap-1"><p className="text-[10px] font-black tracking-[0.14em] text-zinc-400">ROOM HP</p><p className="text-[9px] font-bold text-purple-300">WALLS {roomSummary.wallCount}/{MAX_WALL_SEGMENTS}</p></div>
                    <div className="mt-1 flex items-baseline justify-between gap-2"><p className="text-3xl font-black tabular-nums">{roomSummary.health}<span className="text-sm text-zinc-500"> / {ROOM_MAX_HEALTH}</span></p><p className="text-[9px] font-bold text-zinc-500">{roomSummary.count} ACTIVE</p></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/50"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width]" style={{ width: `${(roomSummary.health / ROOM_MAX_HEALTH) * 100}%` }} /></div>
                  </> : <div className="grid min-h-14 place-items-center text-center"><p className="text-lg font-black text-red-300">ROOM BROKEN</p></div>}
                </div>

                {key === "yours" ? (
                  <div className={`${styles.controls} mt-2 p-2`}>
                    <div className="grid grid-cols-2 gap-1">
                      {(["pop", "wall"] as BuildMode[]).map((mode) => <button key={mode} type="button" aria-pressed={buildMode === mode} onClick={() => selectMode(mode)} className={`min-h-11 rounded-md border px-1 text-[10px] font-black ${buildMode === mode ? "border-purple-300 bg-purple-500/35 text-white" : "border-white/10 bg-black/20 text-zinc-400"}`}>{mode.toUpperCase()}</button>)}
                    </div>
                    <p className={`mt-2 min-h-4 text-center text-[10px] font-black ${feedback?.valid ? "text-emerald-300" : "text-red-300"}`}>{feedback?.message ?? `${MAX_WALL_SEGMENTS - roomSummary.wallCount} pieces available`}</p>
                  </div>
                ) : (
                  <div className={`${styles.controls} mt-2 grid place-items-center px-2 text-center`}><span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600">Local test structure</span></div>
                )}
              </section>
            );
          })}
        </div>

        <aside className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-[10px] text-zinc-500" aria-label="Development simulation status">
          DEV · grid 6×10 · yours V{summary.yours.verticalCount}/H{summary.yours.horizontalCount} ({summary.yours.supportedHorizontalCount} supported), routes {summary.yours.routesValid ? "valid" : "invalid"} · opponent V{summary.opponent.verticalCount}/H{summary.opponent.horizontalCount} ({summary.opponent.supportedHorizontalCount} supported), routes {summary.opponent.routesValid ? "valid" : "invalid"}
        </aside>
      </div>
    </main>
  );
}
