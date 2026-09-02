import {
  GRID_COLUMNS,
  GRID_ROWS,
  SPAWN_LANES,
  getCellCenter,
  getLaneCell,
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
  options: { debugPaths: boolean; preview: WallPreview; selectedWallId?: string | null },
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
  drawGrid(context, bounds.width, bounds.height);
  drawLanes(context, bounds.width, bounds.height);
  if (options.debugPaths) drawPaths(context, room, bounds.width, bounds.height);
  for (const wall of room.walls) drawWall(context, wall, bounds.width, bounds.height, "rgba(195, 93, 255, 0.96)", 5, true);
  const selectedWall = room.walls.find((wall) => wall.id === options.selectedWallId);
  if (selectedWall) drawWall(context, selectedWall, bounds.width, bounds.height, "rgba(253, 230, 138, 0.9)", 11);
  for (const glue of room.glueTraps) {
    const wall = room.walls.find((candidate) => candidate.id === glue.wallSegmentId);
    if (wall) drawGlue(context, wall, bounds.width, bounds.height);
  }
  for (const wall of room.walls) {
    const nails = room.nailStrips.filter((nail) => nail.wallSegmentId === wall.id);
    if (nails.length > 0) drawNailStack(context, wall, nails, bounds.width, bounds.height);
  }
  if (options.preview) {
    drawWall(context, options.preview.wall, bounds.width, bounds.height, options.preview.valid ? "rgba(216, 180, 254, 0.72)" : "rgba(248, 113, 113, 0.82)", 7);
  }
  for (const balloon of room.balloons) drawBalloon(context, balloon, bounds.width, bounds.height, options.debugPaths);
  drawEffects(context, roomKey, effects, now, bounds.width, bounds.height);

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

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.strokeStyle = "rgba(221, 194, 255, 0.075)";
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

function drawLanes(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.textAlign = "center";
  context.font = "900 9px sans-serif";
  for (const lane of SPAWN_LANES) {
    const position = getCellCenter(getLaneCell(lane));
    context.fillStyle = "rgba(216, 180, 254, 0.48)";
    context.fillText(`↑ ${lane}`, position.x * width, height - 7);
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

function drawWall(context: CanvasRenderingContext2D, wall: WallSegment, width: number, height: number, color: string, lineWidth: number, showIntegrity = false): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.shadowColor = color;
  context.shadowBlur = 6;
  context.beginPath();
  if (wall.orientation === "vertical") {
    const x = (wall.gridX / GRID_COLUMNS) * width;
    context.moveTo(x, (wall.gridY / GRID_ROWS) * height);
    context.lineTo(x, ((wall.gridY + 1) / GRID_ROWS) * height);
  } else {
    const y = (wall.gridY / GRID_ROWS) * height;
    context.moveTo((wall.gridX / GRID_COLUMNS) * width, y);
    context.lineTo(((wall.gridX + 1) / GRID_COLUMNS) * width, y);
  }
  context.stroke();
  if (showIntegrity && wall.integrity < wall.maxIntegrity) {
    const midpoint = getWallCenter(wall);
    const ratio = wall.integrity / wall.maxIntegrity;
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(7,3,15,0.78)";
    context.lineWidth = Math.max(1.5, lineWidth * 0.45);
    context.setLineDash(ratio <= 0.3 ? [7, 5] : [3, 9]);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(253,230,138,0.98)";
    context.font = "900 8px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${wall.integrity}/${wall.maxIntegrity}`, midpoint.x * width + (wall.orientation === "vertical" ? 12 : 0), midpoint.y * height - (wall.orientation === "horizontal" ? 9 : 0));
  }
  context.restore();
}

export function getWallCenter(wall: WallSegment): { x: number; y: number } {
  return wall.orientation === "vertical"
    ? { x: wall.gridX / GRID_COLUMNS, y: (wall.gridY + 0.5) / GRID_ROWS }
    : { x: (wall.gridX + 0.5) / GRID_COLUMNS, y: wall.gridY / GRID_ROWS };
}

function drawGlue(context: CanvasRenderingContext2D, wall: WallSegment, width: number, height: number): void {
  drawWall(context, wall, width, height, "rgba(74, 222, 128, 0.92)", 10);
}

function drawNailStack(
  context: CanvasRenderingContext2D,
  wall: WallSegment,
  nails: NailStrip[],
  width: number,
  height: number,
): void {
  const totalDurability = nails.reduce((sum, nail) => sum + nail.durability, 0);
  const totalMaximum = nails.reduce((sum, nail) => sum + nail.maxDurability, 0);
  const ratio = totalDurability / totalMaximum;
  const color = ratio <= 0.2
      ? "rgba(248, 113, 113, 0.96)"
      : ratio <= 0.6
        ? "rgba(251, 191, 36, 0.96)"
        : "rgba(167, 243, 208, 0.98)";
  const startX = (wall.gridX / GRID_COLUMNS) * width;
  const startY = (wall.gridY / GRID_ROWS) * height;
  const length = wall.orientation === "vertical" ? height / GRID_ROWS : width / GRID_COLUMNS;
  const spikeCount = 4;
  const spikeSize = Math.max(3, Math.min(6, length / 7));

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1.5;
  context.shadowColor = color;
  context.shadowBlur = 5 * ratio;
  for (let index = 0; index < spikeCount; index += 1) {
    const progress = (index + 0.5) / spikeCount;
    const x = wall.orientation === "vertical" ? startX : startX + length * progress;
    const y = wall.orientation === "vertical" ? startY + length * progress : startY;
    context.beginPath();
    if (wall.orientation === "vertical") {
      context.moveTo(x, y - spikeSize * 0.7);
      context.lineTo(x + (index % 2 ? -spikeSize : spikeSize), y);
      context.lineTo(x, y + spikeSize * 0.7);
    } else {
      context.moveTo(x - spikeSize * 0.7, y);
      context.lineTo(x, y + (index % 2 ? -spikeSize : spikeSize));
      context.lineTo(x + spikeSize * 0.7, y);
    }
    context.closePath();
    context.fill();
  }
  context.setLineDash([]);
  context.shadowBlur = 0;
  context.font = "900 8px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(255,255,255,0.95)";
  const labelX = wall.orientation === "vertical" ? startX + 12 : startX + length / 2;
  const labelY = wall.orientation === "vertical" ? startY + length / 2 : startY - 10;
  context.fillText(`×${nails.length} ${totalDurability}`, labelX, labelY);
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
  const gradient = context.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
  const colors = balloon.balloonType === "speed"
    ? ["#cffafe", "#22d3ee", "#2563eb"]
    : balloon.balloonType === "heavy"
      ? ["#fde68a", "#f97316", "#7c2d12"]
      : ["#f9a8d4", "#ec2994", "#8b3dff"];
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.35, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.save();
  context.shadowColor = balloon.balloonType === "speed" ? "rgba(34, 211, 238, 0.55)" : balloon.balloonType === "heavy" ? "rgba(249, 115, 22, 0.52)" : "rgba(236, 41, 148, 0.42)";
  context.shadowBlur = 12;
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(x, y, radius * (balloon.balloonType === "speed" ? 0.66 : 0.82), radius, 0, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.beginPath();
  context.ellipse(x - radius * 0.25, y - radius * 0.35, radius * 0.12, radius * 0.22, -0.35, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = colors[2];
  context.beginPath();
  context.moveTo(x, y + radius * 0.88);
  context.lineTo(x - radius * 0.16, y + radius * 1.16);
  context.lineTo(x + radius * 0.16, y + radius * 1.16);
  context.closePath();
  context.fill();
  context.font = `900 ${Math.max(7, radius * 0.48)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(255,255,255,0.96)";
  context.fillText(`${balloon.health}`, x, y + radius * 0.27);
  if (balloon.glued) {
    context.strokeStyle = "rgba(74, 222, 128, 0.95)";
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
