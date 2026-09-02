export const ROOM_MAX_HEALTH = 20;
export const GRID_WIDTH = 6;
export const GRID_HEIGHT = 10;
export const GRID_COLUMNS = GRID_WIDTH;
export const GRID_ROWS = GRID_HEIGHT;
export const ENTRY_LANES = [1, 2, 3, 4];
export const ENTRY_LANE_COLUMNS = { 1: 0, 2: 2, 3: 3, 4: 5 };
export const BASIC_BALLOON_HP = 3;
export const BASIC_BALLOON_SPEED = 0.105;
export const BASIC_BALLOON_RADIUS = 0.06;
export const BASIC_BALLOON_ROOM_DAMAGE = 1;
export const SPEED_BALLOON_HP = 2;
export const SPEED_BALLOON_SPEED_MULTIPLIER = 1.6;
export const SPEED_BALLOON_ROOM_DAMAGE = 1;
export const SPEED_BALLOON_COST = 40;
export const SPEED_BALLOON_INCOME_GAIN = 3;
export const HEAVY_BALLOON_HP = 10;
export const HEAVY_BALLOON_SPEED_MULTIPLIER = 0.55;
export const HEAVY_BALLOON_ROOM_DAMAGE = 3;
export const HEAVY_BALLOON_COST = 100;
export const HEAVY_BALLOON_INCOME_GAIN = 5;
export const BASIC_BALLOON = {
    maxHealth: BASIC_BALLOON_HP,
    speed: BASIC_BALLOON_SPEED,
    speedMultiplier: 1,
    radius: BASIC_BALLOON_RADIUS,
    roomDamage: BASIC_BALLOON_ROOM_DAMAGE,
    cost: 25,
    incomeGain: 3,
};
export const SPEED_BALLOON = {
    maxHealth: SPEED_BALLOON_HP,
    speed: BASIC_BALLOON_SPEED * SPEED_BALLOON_SPEED_MULTIPLIER,
    speedMultiplier: SPEED_BALLOON_SPEED_MULTIPLIER,
    radius: BASIC_BALLOON_RADIUS * 0.84,
    roomDamage: SPEED_BALLOON_ROOM_DAMAGE,
    cost: SPEED_BALLOON_COST,
    incomeGain: SPEED_BALLOON_INCOME_GAIN,
};
export const HEAVY_BALLOON = {
    maxHealth: HEAVY_BALLOON_HP,
    speed: BASIC_BALLOON_SPEED * HEAVY_BALLOON_SPEED_MULTIPLIER,
    speedMultiplier: HEAVY_BALLOON_SPEED_MULTIPLIER,
    radius: BASIC_BALLOON_RADIUS * 1.34,
    roomDamage: HEAVY_BALLOON_ROOM_DAMAGE,
    cost: HEAVY_BALLOON_COST,
    incomeGain: HEAVY_BALLOON_INCOME_GAIN,
};
export const BALLOON_TYPES = {
    basic: BASIC_BALLOON,
    speed: SPEED_BALLOON,
    heavy: HEAVY_BALLOON,
};
export const MANUAL_POP_DAMAGE = 1;
export const MANUAL_TAP_DAMAGE = MANUAL_POP_DAMAGE;
export const MAX_WALL_SEGMENTS = 24;
export const MAX_HORIZONTAL_SUPPORT_DISTANCE = 2;
export const WALL_MAX_INTEGRITY = 10;
export const WALL_REPAIR_THRESHOLD = 5;
export const WALL_REPAIR_AMOUNT = 5;
export const WALL_REPAIR_COST = 25;
export const HEAVY_DIRECT_STRUCTURAL_DAMAGE = 2;
export const HEAVY_GLANCING_STRUCTURAL_DAMAGE = 1;
export const BASIC_STRUCTURAL_DAMAGE = 0;
export const SPEED_STRUCTURAL_DAMAGE = 0;
export const NAIL_DAMAGE = 1;
export const NAIL_MAX_DURABILITY = 10;
export const MAX_NAIL_STRIPS = 4;
export const GLUE_SPEED_MULTIPLIER = 0.65;
export const STARTING_COINS = 300;
export const STARTING_INCOME = 30;
export const INCOME_TICK_INTERVAL_MS = 8000;
export const VERTICAL_WALL_COST = 75;
export const HORIZONTAL_WALL_COST = 75;
export const NAIL_STRIP_COST = 30;
export const GLUE_COST = 40;
export const BASIC_BALLOON_COST = 25;
export const BASIC_BALLOON_INCOME_GAIN = 3;
export const MAX_LAUNCH_QUEUE_SIZE = 10;
export const BASIC_BALLOON_LAUNCH_INTERVAL_MS = 600;
export const PLAYER_BALLOON_LAUNCH_INTERVAL_MS = BASIC_BALLOON_LAUNCH_INTERVAL_MS;
export const WAVE_BALLOON_SPAWN_INTERVAL_MS = 700;
export const PRE_ROUND_COUNTDOWN_MS = 10000;
export const ROUND_TRANSITION_MS = 10000;
export const DEV_SPAWN_MIN_SECONDS = 1.5;
export const DEV_SPAWN_MAX_SECONDS = 2.5;
export const SIMULATION_STEP_SECONDS = 1 / 60;
export const MAX_FRAME_DELTA_SECONDS = 0.25;
//# sourceMappingURL=constants.js.map