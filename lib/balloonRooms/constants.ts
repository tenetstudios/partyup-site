export const ROOM_MAX_HEALTH = 20;
export const GRID_COLUMNS = 6;
export const GRID_ROWS = 10;
export const MAX_WALL_SEGMENTS = 10;
export const MAX_HORIZONTAL_SUPPORT_DISTANCE = 2;
export const WALL_REMOVE_HOLD_MS = 900;

export const ENTRY_LANE_COLUMNS = {
  1: 0,
  2: 2,
  3: 3,
  4: 5,
} as const;

export const BASIC_BALLOON = {
  maxHealth: 3,
  speed: 0.105,
  radius: 0.06,
  roomDamage: 1,
} as const;

export const MANUAL_TAP_DAMAGE = 1;
export const DEV_SPAWN_MIN_SECONDS = 1.5;
export const DEV_SPAWN_MAX_SECONDS = 2.5;
export const SIMULATION_STEP_SECONDS = 1 / 60;
export const MAX_FRAME_DELTA_SECONDS = 0.25;
