"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FRAME_DELTA_SECONDS,
  ROOM_MAX_HEALTH,
  SIMULATION_STEP_SECONDS,
} from "@/lib/balloonRooms/constants";
import {
  createBalloonRoom,
  createDevBalloonSpawner,
  damageBalloon,
  findBalloonAtPoint,
  updateDevBalloonSpawner,
  updateRoomSimulation,
  type DevBalloonSpawner,
} from "@/lib/balloonRooms/simulation";
import type { Balloon, BalloonRoom } from "@/lib/balloonRooms/types";
import styles from "./BalloonRooms.module.css";

type RoomKey = "yours" | "opponent";
type RoomCollection = Record<RoomKey, BalloonRoom>;
type SpawnerCollection = Record<RoomKey, DevBalloonSpawner>;
type CanvasCollection = Record<RoomKey, HTMLCanvasElement | null>;
type RoomSummary = Record<RoomKey, { health: number; count: number; running: boolean }>;
type VisualEffect = {
  room: RoomKey;
  x: number;
  y: number;
  kind: "tap" | "pop" | "escape";
  startedAt: number;
};

const roomKeys: RoomKey[] = ["yours", "opponent"];

function createRooms(): RoomCollection {
  return { yours: createBalloonRoom("your-room"), opponent: createBalloonRoom("opponent-room") };
}

function createSpawners(): SpawnerCollection {
  return { yours: createDevBalloonSpawner(410), opponent: createDevBalloonSpawner(920) };
}

function summarize(rooms: RoomCollection): RoomSummary {
  return {
    yours: { health: rooms.yours.health, count: rooms.yours.balloons.length, running: rooms.yours.health > 0 },
    opponent: { health: rooms.opponent.health, count: rooms.opponent.balloons.length, running: rooms.opponent.health > 0 },
  };
}

export default function BalloonRoomsClient() {
  const roomsRef = useRef<RoomCollection>(createRooms());
  const spawnersRef = useRef<SpawnerCollection>(createSpawners());
  const canvasesRef = useRef<CanvasCollection>({ yours: null, opponent: null });
  const effectsRef = useRef<VisualEffect[]>([]);
  const [summary, setSummary] = useState<RoomSummary>({
    yours: { health: ROOM_MAX_HEALTH, count: 0, running: true },
    opponent: { health: ROOM_MAX_HEALTH, count: 0, running: true },
  });

  const refreshSummary = useCallback(() => setSummary(summarize(roomsRef.current)), []);

  useEffect(() => {
    let animationFrame = 0;
    let previousTime = performance.now();
    let accumulator = 0;

    const frame = (now: number) => {
      const elapsed = Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      accumulator += elapsed;
      let summaryChanged = false;

      while (accumulator >= SIMULATION_STEP_SECONDS) {
        for (const key of roomKeys) {
          const room = roomsRef.current[key];
          const spawned = updateDevBalloonSpawner(room, spawnersRef.current[key], SIMULATION_STEP_SECONDS);
          const events = updateRoomSimulation(room, SIMULATION_STEP_SECONDS);
          if (spawned.length > 0 || events.length > 0) summaryChanged = true;
          for (const event of events) {
            if (event.type === "balloon_escaped") {
              effectsRef.current.push({ room: key, x: event.balloon.x, y: 0.02, kind: "escape", startedAt: now });
            }
          }
        }
        accumulator -= SIMULATION_STEP_SECONDS;
      }

      if (summaryChanged) refreshSummary();
      effectsRef.current = effectsRef.current.filter((effect) => now - effect.startedAt < 500);
      for (const key of roomKeys) {
        const canvas = canvasesRef.current[key];
        if (canvas) drawRoom(canvas, roomsRef.current[key], key, effectsRef.current, now);
      }
      animationFrame = requestAnimationFrame(frame);
    };

    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [refreshSummary]);

  const setCanvas = useCallback((key: RoomKey, canvas: HTMLCanvasElement | null) => {
    canvasesRef.current[key] = canvas;
  }, []);

  const tapRoom = useCallback((key: RoomKey, event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const minimumHitRadius = 22 / Math.min(bounds.width, bounds.height);
    const balloon = findBalloonAtPoint(roomsRef.current[key], x, y, minimumHitRadius);
    if (!balloon) return;

    const result = damageBalloon(roomsRef.current[key], balloon.id);
    if (!result) return;
    effectsRef.current.push({
      room: key,
      x: balloon.x,
      y: balloon.y,
      kind: result.popped ? "pop" : "tap",
      startedAt: performance.now(),
    });
    refreshSummary();
  }, [refreshSummary]);

  const restart = useCallback(() => {
    roomsRef.current = createRooms();
    spawnersRef.current = createSpawners();
    effectsRef.current = [];
    refreshSummary();
  }, [refreshSummary]);

  return (
    <main className={`${styles.gameShell} text-white`}>
      <div className="mx-auto max-w-3xl px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <header className="mb-3 flex items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-pink-300">Phase 1 · Local test</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">BALLOON ROOMS</h1>
          </div>
          <button type="button" onClick={restart} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs font-black text-zinc-200 active:bg-white/10">
            RESTART
          </button>
        </header>

        <p className="mb-3 px-1 text-xs font-bold text-zinc-400">Tap any balloon once to deal 1 damage.</p>

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
                    onPointerDown={(event) => tapRoom(key, event)}
                    aria-label={`${label} balloon playfield. Tap balloons to damage them.`}
                  />
                </div>
                <div className={`${styles.statusPanel} p-3`}>
                  {roomSummary.running ? (
                    <>
                      <p className="text-[10px] font-black tracking-[0.16em] text-zinc-400">ROOM HP</p>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <p className="text-3xl font-black tabular-nums">{roomSummary.health}<span className="text-sm text-zinc-500"> / {ROOM_MAX_HEALTH}</span></p>
                        <p className="text-[10px] font-bold text-zinc-500">{roomSummary.count} ACTIVE</p>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/50"><div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width]" style={{ width: `${(roomSummary.health / ROOM_MAX_HEALTH) * 100}%` }} /></div>
                    </>
                  ) : (
                    <div className="grid min-h-14 place-items-center text-center"><p className="text-lg font-black text-red-300">ROOM BROKEN</p></div>
                  )}
                </div>
                <div className={`${styles.futureControls} mt-2 grid place-items-center px-2 text-center`} aria-hidden="true">
                  <span className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-700">Controls reserved</span>
                </div>
              </section>
            );
          })}
        </div>

        <aside className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-[10px] text-zinc-500" aria-label="Development simulation status">
          DEV · yours: {summary.yours.running ? "running" : "stopped"}, HP {summary.yours.health}, balloons {summary.yours.count} · opponent: {summary.opponent.running ? "running" : "stopped"}, HP {summary.opponent.health}, balloons {summary.opponent.count} · balloon HP appears as pips
        </aside>
      </div>
    </main>
  );
}

function drawRoom(
  canvas: HTMLCanvasElement,
  room: BalloonRoom,
  key: RoomKey,
  effects: VisualEffect[],
  now: number,
): void {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  for (const balloon of room.balloons) drawBalloon(context, balloon, bounds.width, bounds.height);

  for (const effect of effects) {
    if (effect.room !== key) continue;
    const progress = Math.min(1, (now - effect.startedAt) / (effect.kind === "escape" ? 500 : 260));
    const x = effect.x * bounds.width;
    const y = effect.y * bounds.height;
    context.save();
    if (effect.kind === "escape") {
      context.fillStyle = `rgba(248, 113, 113, ${0.23 * (1 - progress)})`;
      context.fillRect(0, 0, bounds.width, bounds.height);
      context.fillStyle = `rgba(254, 202, 202, ${1 - progress})`;
      context.font = "900 14px sans-serif";
      context.textAlign = "center";
      context.fillText("-1 ROOM HP", bounds.width / 2, 30 + progress * 10);
    } else {
      context.strokeStyle = effect.kind === "pop" ? `rgba(244, 114, 182, ${1 - progress})` : `rgba(255, 255, 255, ${1 - progress})`;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, (10 + progress * (effect.kind === "pop" ? 30 : 12)), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  if (room.health <= 0) {
    context.fillStyle = "rgba(7, 0, 15, 0.74)";
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#fca5a5";
    context.font = `900 ${Math.max(16, bounds.width * 0.09)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("ROOM BROKEN", bounds.width / 2, bounds.height / 2);
  }
}

function drawBalloon(context: CanvasRenderingContext2D, balloon: Balloon, width: number, height: number): void {
  const x = balloon.x * width;
  const y = balloon.y * height;
  const radius = Math.max(12, balloon.radius * width);
  const gradient = context.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
  gradient.addColorStop(0, "#f9a8d4");
  gradient.addColorStop(0.35, "#ec2994");
  gradient.addColorStop(1, "#8b3dff");

  context.save();
  context.shadowColor = "rgba(236, 41, 148, 0.42)";
  context.shadowBlur = 12;
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(x, y, radius * 0.82, radius, 0, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.beginPath();
  context.ellipse(x - radius * 0.25, y - radius * 0.35, radius * 0.12, radius * 0.22, -0.35, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#8b3dff";
  context.beginPath();
  context.moveTo(x, y + radius * 0.88);
  context.lineTo(x - radius * 0.16, y + radius * 1.16);
  context.lineTo(x + radius * 0.16, y + radius * 1.16);
  context.closePath();
  context.fill();

  const pipGap = 5;
  for (let index = 0; index < balloon.maxHealth; index += 1) {
    context.beginPath();
    context.arc(x + (index - 1) * pipGap, y + radius * 0.32, 1.7, 0, Math.PI * 2);
    context.fillStyle = index < balloon.health ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.25)";
    context.fill();
  }
  context.restore();
}
