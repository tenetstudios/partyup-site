import {
  GRID_COLUMNS,
  GRID_ROWS,
  getCellCenter,
  type Balloon,
  type BalloonRoom,
  type NailStrip,
  type WallSegment,
} from "@partyup/balloon-core";

export type RoomVisualEffect = {
  roomKey: string;
  x: number;
  y: number;
  kind: "tap" | "pop" | "escape" | "nail" | "wall" | "collapse";
  label?: string;
  startedAt: number;
};

export type WallPreview = { wall: WallSegment; valid: boolean } | null;

export function drawBalloonRoom(
  canvas: HTMLCanvasElement,
  room: BalloonRoom,
  roomKey: string,
  effects: RoomVisualEffect[],
  now: number,
  options: { showGrid?: boolean; debugPaths: boolean; preview: WallPreview; selectedWallId?: string | null },
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
  if (options.showGrid) drawGrid(context, bounds.width, bounds.height);
  if (options.debugPaths) drawPaths(context, room, bounds.width, bounds.height);
  for (const wall of room.walls) drawWall(context, wall, bounds.width, bounds.height, "#fffdf3", 5, true);
  const selectedWall = room.walls.find((wall) => wall.id === options.selectedWallId);
  if (selectedWall) drawWall(context, selectedWall, bounds.width, bounds.height, "#d3eeff", 11);
  for (const glue of room.glueTraps) {
    const wall = room.walls.find((candidate) => candidate.id === glue.wallSegmentId);
    if (wall) drawGlue(context, wall, bounds.width, bounds.height);
  }
  for (const wall of room.walls) {
    const nails = room.nailStrips.filter((nail) => nail.wallSegmentId === wall.id);
    if (nails.length > 0) drawNailStack(context, wall, nails, bounds.width, bounds.height);
  }
  if (options.preview) {
    drawWall(context, options.preview.wall, bounds.width, bounds.height, options.preview.valid ? "#c5eeff" : "rgba(248, 113, 113, 0.82)", 7);
  }
  for (const balloon of room.balloons) drawBalloon(context, balloon, bounds.width, bounds.height, options.debugPaths);
  drawEffects(context, roomKey, effects, now, bounds.width, bounds.height);

  if (room.health <= 0) {
    context.fillStyle = "rgba(42, 90, 138, 0.48)";
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#fca5a5";
    context.font = `900 ${Math.max(16, bounds.width * 0.09)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("ROOM BROKEN", bounds.width / 2, bounds.height / 2);
  }
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.strokeStyle = "rgba(242, 251, 255, 0.18)";
  context.lineWidth = 1;
  for (let column = 1; column < GRID_COLUMNS; column += 1) {
    const x = (column / GRID_COLUMNS) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let row = 1; row < GRID_ROWS; row += 1) {
    const y = (row / GRID_ROWS) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawPaths(context: CanvasRenderingContext2D, room: BalloonRoom, width: number, height: number): void {
  context.save();
  context.setLineDash([3, 4]);
  context.lineWidth = 1;
  for (const balloon of room.balloons) {
    context.strokeStyle = balloon.pathBias === "left" ? "rgba(125, 211, 252, 0.34)" : "rgba(253, 164, 175, 0.34)";
    context.beginPath();
    context.moveTo(balloon.x * width, balloon.y * height);
    for (const cell of balloon.path.slice(1)) {
      const point = getCellCenter(cell);
      context.lineTo(point.x * width, point.y * height);
    }
    context.stroke();
  }
  context.restore();
}

// Visual thickness is centered on the canonical grid edge; collision data stays unchanged.
function wallRect(wall: WallSegment, width: number, height: number) {
  const thickness = Math.max(10, Math.min(30, width / GRID_COLUMNS * .62, height / GRID_ROWS * .66));
  const vertical = wall.orientation === "vertical";
  return { x: wall.gridX / GRID_COLUMNS * width - (vertical ? thickness / 2 : 0), y: wall.gridY / GRID_ROWS * height - (vertical ? 0 : thickness / 2), w: vertical ? thickness : width / GRID_COLUMNS, h: vertical ? height / GRID_ROWS : thickness, thickness };
}

function drawWall(context: CanvasRenderingContext2D, wall: WallSegment, width: number, height: number, color: string, lineWidth: number, showIntegrity = false): void {
  const { x, y, w, h } = wallRect(wall, width, height);
  context.save();
  context.shadowColor = "#42618270";
  context.shadowBlur = 4;
  context.shadowOffsetY = 3;
  const face = context.createLinearGradient(x, y, x + w * .25, y + h);
  face.addColorStop(0, "#fffef7"); face.addColorStop(.2, "#f4f0e8"); face.addColorStop(1, "#c4bfba");
  context.fillStyle = showIntegrity ? face : color;
  context.globalAlpha = showIntegrity || lineWidth === 11 ? 1 : .65;
  context.beginPath(); context.roundRect(x + 1, y, Math.max(1, w - 2), h, 3); context.fill();
  context.shadowBlur = 0; context.shadowOffsetY = 0;
  context.strokeStyle = showIntegrity ? "#fdfbf1" : color; context.lineWidth = lineWidth === 11 ? 3 : 1;
  context.stroke();
  context.strokeStyle = "#ffffffb0"; context.lineWidth = 3;
  context.beginPath(); context.moveTo(x + 4, y + h - 4); context.lineTo(x + 4, y + 3); context.lineTo(x + w - 4, y + 3); context.stroke();
  context.strokeStyle = "#97989565"; context.lineWidth = 2;
  context.beginPath(); context.moveTo(x + 4, y + h - 2); context.lineTo(x + w - 3, y + h - 2); context.stroke();
  // Subdivide the face visually, while preserving one canonical wall segment.
  const blocks = Math.max(1, Math.round((wall.orientation === "horizontal" ? w : h) / 42));
  for (let i = 1; i < blocks; i++) {
    context.strokeStyle = "#a8a49d90"; context.lineWidth = 1;
    context.beginPath();
    if (wall.orientation === "horizontal") { context.moveTo(x + w * i / blocks, y + 2); context.lineTo(x + w * i / blocks, y + h - 2); }
    else { context.moveTo(x + 2, y + h * i / blocks); context.lineTo(x + w - 2, y + h * i / blocks); }
    context.stroke();
  }
  if (showIntegrity && wall.integrity < wall.maxIntegrity) {
    const ratio = wall.integrity / wall.maxIntegrity;
    context.strokeStyle = ratio <= .3 ? "#827c78" : "#aaa29a"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(x + w * .6, y + 1); context.lineTo(x + w * .45, y + h * .42); context.lineTo(x + w * .6, y + h * .58);
    if (ratio <= .6) context.lineTo(x + w * .35, y + h - 1);
    context.stroke();
  }
  context.restore();
}

export function getWallCenter(wall: WallSegment): { x: number; y: number } {
  return wall.orientation === "vertical"
    ? { x: wall.gridX / GRID_COLUMNS, y: (wall.gridY + 0.5) / GRID_ROWS }
    : { x: (wall.gridX + 0.5) / GRID_COLUMNS, y: wall.gridY / GRID_ROWS };
}

function drawGlue(context: CanvasRenderingContext2D, wall: WallSegment, width: number, height: number): void {
  const { x, y, w, h } = wallRect(wall, width, height);
  context.save();
  const gel = context.createLinearGradient(x, y, x + w, y + h);
  gel.addColorStop(0, "#e1fbffbd"); gel.addColorStop(.45, "#56c2f2a8"); gel.addColorStop(1, "#c8faffd9");
  context.fillStyle = gel; context.strokeStyle = "#e1fbff"; context.lineWidth = 1.5;
  context.beginPath(); context.roundRect(x, y - 1, w, h + 3, 5); context.fill(); context.stroke();
  context.strokeStyle = "#ffffffbd";
  for (let i = 1; i < 4; i++) {
    const bx = x + w * i / 4;
    context.beginPath(); context.moveTo(bx - 3, y + 5); context.quadraticCurveTo(bx + 4, y + 1, bx + 3, y + h * .4); context.stroke();
  }
  context.beginPath(); context.moveTo(x + 3, y + h - 4); context.bezierCurveTo(x + w * .3, y + h + 1, x + w * .6, y + h - 8, x + w - 3, y + h - 3); context.stroke();
  context.restore();
}

function drawNailStack(context: CanvasRenderingContext2D, wall: WallSegment, nails: NailStrip[], width: number, height: number): void {
  const { x, y, w, h, thickness } = wallRect(wall, width, height);
  const ratio = nails.reduce((sum, nail) => sum + nail.durability, 0) / nails.reduce((sum, nail) => sum + nail.maxDurability, 0);
  const vertical = wall.orientation === "vertical";
  const count = Math.min(4, 2 + nails.length - 1);
  context.save();
  context.globalAlpha = .6 + ratio * .4;
  for (let i = 0; i < count; i++) {
    context.save();
    if (vertical) { context.translate(x + w, y + h * (i + .5) / count); context.rotate(-Math.PI / 2); }
    else context.translate(x + w * (i + .5) / count, y + h);
    const half = Math.max(3, thickness * .2), length = thickness * 1.1;
    const metal = context.createLinearGradient(-half, 0, half, 0);
    metal.addColorStop(0, "#33465e"); metal.addColorStop(.38, "#c5d4e2"); metal.addColorStop(.55, "#f2f7fa"); metal.addColorStop(.7, "#8594a8"); metal.addColorStop(1, "#33445e");
    context.fillStyle = metal; context.strokeStyle = "#41546b"; context.lineWidth = .8;
    context.beginPath(); context.moveTo(-half, 2); context.lineTo(0, length); context.lineTo(half, 2); context.closePath(); context.fill(); context.stroke();
    context.fillRect(-half - 2, 0, half * 2 + 4, 3);
    context.restore();
  }
  context.restore();
}

function drawEffects(context: CanvasRenderingContext2D, roomKey: string, effects: RoomVisualEffect[], now: number, width: number, height: number): void {
  for (const effect of effects) {
    if (effect.roomKey !== roomKey) continue;
    const progress = Math.min(1, (now - effect.startedAt) / (effect.kind === "escape" ? 500 : 260));
    const x = effect.x * width;
    const y = effect.y * height;
    context.save();
    if (effect.kind === "escape") {
      context.fillStyle = `rgba(248, 113, 113, ${0.23 * (1 - progress)})`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = `rgba(254, 202, 202, ${1 - progress})`;
      context.font = "900 14px sans-serif";
      context.textAlign = "center";
      context.fillText("-1 ROOM HP", width / 2, 30 + progress * 10);
    } else {
      context.strokeStyle = effect.kind === "pop"
        ? `rgba(244, 114, 182, ${1 - progress})`
        : effect.kind === "nail"
          ? `rgba(167, 243, 208, ${1 - progress})`
          : effect.kind === "wall"
            ? `rgba(253, 230, 138, ${1 - progress})`
            : effect.kind === "collapse"
              ? `rgba(251, 113, 133, ${1 - progress})`
          : `rgba(255, 255, 255, ${1 - progress})`;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 10 + progress * (effect.kind === "pop" ? 30 : 12), 0, Math.PI * 2);
      context.stroke();
      if (effect.label) {
        context.fillStyle = effect.kind === "collapse" ? `rgba(254, 202, 202, ${1 - progress})` : `rgba(253, 230, 138, ${1 - progress})`;
        context.font = "900 9px monospace";
        context.textAlign = "center";
        context.fillText(effect.label, x, y - 12 - progress * 8);
      }
    }
    context.restore();
  }
}

function drawBalloon(context: CanvasRenderingContext2D, balloon: Balloon, width: number, height: number, showDebug: boolean): void {
  const x = balloon.x * width;
  const y = balloon.y * height;
  const radius = Math.max(10, balloon.radius * width);
  const gradient = context.createRadialGradient(x + radius * 0.4, y - radius * 0.45, radius * 0.1, x, y, radius);
  const colors = balloon.balloonType === "speed"
    ? ["#c3f1ff", "#2589ff", "#153bc9"]
    : balloon.balloonType === "heavy"
      ? ["#c4b4d0", "#594467", "#211d36"]
      : ["#ffb4c0", "#ff294e", "#c30034"];
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.35, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.save();
  context.shadowColor = balloon.balloonType === "speed" ? "rgba(100, 193, 255, 0.4)" : balloon.balloonType === "heavy" ? "rgba(92, 73, 117, 0.25)" : "rgba(255, 129, 156, 0.3)";
  context.shadowBlur = 12;
  context.fillStyle = gradient;
  context.beginPath();
  const rx = radius * (balloon.balloonType === "speed" ? .66 : .82);
  context.moveTo(x, y + radius);
  context.bezierCurveTo(x - rx * 1.5, y + radius * .2, x - rx * 1.1, y - radius, x, y - radius);
  context.bezierCurveTo(x + rx * 1.1, y - radius, x + rx * 1.5, y + radius * .2, x, y + radius);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(255,205,222,.25)";
  context.lineWidth = Math.max(1, radius * .035);
  context.stroke();
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.beginPath();
  context.ellipse(x + radius * 0.34, y - radius * 0.48, radius * 0.12, radius * 0.22, -0.35, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = colors[2];
  context.beginPath();
  context.moveTo(x, y + radius * 0.88);
  context.lineTo(x - radius * 0.16, y + radius * 1.16);
  context.lineTo(x + radius * 0.16, y + radius * 1.16);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.7)";
  context.lineWidth = .8;
  context.beginPath(); context.moveTo(x, y + radius * 1.16);
  context.bezierCurveTo(x - radius * .22, y + radius * 1.5, x + radius * .18, y + radius * 1.65, x - radius * .08, y + radius * 1.95); context.stroke();
  context.font = `700 ${Math.max(7, radius * 0.48)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.fillText(`${balloon.health}`, x, y + radius * 0.27);
  if (balloon.glued) {
    context.strokeStyle = "rgba(187, 242, 255, 0.9)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, radius * 1.08, 0, Math.PI * 2);
    context.stroke();
  }
  if (showDebug) {
    context.font = "700 8px monospace";
    context.textAlign = "center";
    context.fillStyle = "rgba(255,255,255,0.8)";
    context.fillText(`L${balloon.spawnLane} ${balloon.currentCell.column},${balloon.currentCell.row} p${Math.max(0, balloon.path.length - 1)}`, x, y - radius - 5);
  }
  context.restore();
}
