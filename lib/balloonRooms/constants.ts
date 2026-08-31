export const ROOM_MAX_HEALTH = 20;

export const BASIC_BALLOON = {
  maxHealth: 3,
  speed: 0.105,
  radius: 0.075,
  roomDamage: 1,
} as const;

export const MANUAL_TAP_DAMAGE = 1;
export const BALLOON_SPAWN_Y = 0.91;
export const BALLOON_SAFE_X_MIN = 0.13;
export const BALLOON_SAFE_X_MAX = 0.87;
export const DEV_SPAWN_MIN_SECONDS = 1.5;
export const DEV_SPAWN_MAX_SECONDS = 2.5;
export const SIMULATION_STEP_SECONDS = 1 / 60;
export const MAX_FRAME_DELTA_SECONDS = 0.25;
