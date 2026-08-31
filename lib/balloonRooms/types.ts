export type BalloonStatus = "active" | "popped" | "escaped";
export type SpawnLane = 1 | 2 | 3 | 4;
export type PathBias = "left" | "right";
export type WallOrientation = "vertical" | "horizontal";
export type NailStripStatus = "active" | "broken";

export type GridCell = {
  column: number;
  row: number;
};

export type WallSegment = {
  id: string;
  roomId: string;
  orientation: WallOrientation;
  gridX: number;
  gridY: number;
};

export type NailStrip = {
  id: string;
  roomId: string;
  wallSegmentId: string;
  durability: number;
  maxDurability: number;
  status: NailStripStatus;
};

export type Balloon = {
  id: string;
  roomId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  speed: number;
  radius: number;
  roomDamage: number;
  status: BalloonStatus;
  spawnLane: SpawnLane;
  pathBias: PathBias;
  currentCell: GridCell;
  targetCell: GridCell | null;
  path: GridCell[];
  pathRevision: number;
  contactingNailIds: string[];
};

export type BalloonRoom = {
  id: string;
  health: number;
  maxHealth: number;
  balloons: Balloon[];
  walls: WallSegment[];
  nailStrips: NailStrip[];
  wallRevision: number;
  width: number;
  height: number;
};

export type BalloonSimulationEvent =
  | { type: "balloon_popped"; balloon: Balloon }
  | { type: "balloon_escaped"; balloon: Balloon; damage: number }
  | {
    type: "nail_contact";
    balloonId: string;
    nailStripId: string;
    wallSegmentId: string;
    balloonHealthBefore: number;
    balloonHealthAfter: number;
    durabilityBefore: number;
    durabilityAfter: number;
    popped: boolean;
  };

export type BalloonDamageResult = {
  balloonId: string;
  remainingHealth: number;
  popped: boolean;
};

export type WallValidationCode =
  | "valid"
  | "invalid_edge"
  | "duplicate"
  | "budget_reached"
  | "needs_support"
  | "path_required"
  | "supporting_span"
  | "not_found";

export type WallValidationResult = {
  valid: boolean;
  code: WallValidationCode;
  message: string;
};

export type NailValidationCode = "valid" | "wall_required" | "duplicate" | "limit_reached" | "not_found";

export type NailValidationResult = {
  valid: boolean;
  code: NailValidationCode;
  message: string;
};
