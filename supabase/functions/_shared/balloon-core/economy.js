import { INCOME_TICK_INTERVAL_MS, STARTING_COINS, STARTING_INCOME } from "./constants.js";
export function createPlayerEconomy() {
    return {
        coins: STARTING_COINS,
        income: STARTING_INCOME,
        nextIncomeTickAt: INCOME_TICK_INTERVAL_MS,
    };
}
export function applyIncomeTicks(room, simulationTimeMs) {
    if (!Number.isFinite(simulationTimeMs) || simulationTimeMs < 0) {
        return { valid: false, code: "invalid_time", message: "Valid simulation time is required", ticksApplied: 0, coinsGranted: 0 };
    }
    if (simulationTimeMs < room.economy.nextIncomeTickAt) {
        return { valid: true, code: "valid", message: "No income tick due", ticksApplied: 0, coinsGranted: 0 };
    }
    const ticksApplied = Math.floor((simulationTimeMs - room.economy.nextIncomeTickAt) / INCOME_TICK_INTERVAL_MS) + 1;
    const coinsGranted = ticksApplied * room.economy.income;
    room.economy.coins += coinsGranted;
    room.economy.nextIncomeTickAt += ticksApplied * INCOME_TICK_INTERVAL_MS;
    return { valid: true, code: "valid", message: `${ticksApplied} income tick${ticksApplied === 1 ? "" : "s"} applied`, ticksApplied, coinsGranted };
}
//# sourceMappingURL=economy.js.map