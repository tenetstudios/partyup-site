import { applyGameAction } from "./actions.js";
import { createSendBalloonAction } from "./offense.js";
import { createBalloonRoom, updateRoomSimulation } from "./simulation.js";
import { createWaveState, updateWaveState } from "./waves.js";
export function createFloatMatch(input) {
    const simulationTimeMs = input.simulationTimeMs ?? 0;
    const [firstPlayerId, secondPlayerId] = input.playerIds;
    if (!input.matchId || !firstPlayerId || !secondPlayerId)
        throw new Error("Match and player IDs are required");
    if (firstPlayerId === secondPlayerId)
        throw new Error("A match requires two distinct players");
    const players = Object.fromEntries(input.playerIds.map((playerId) => {
        const room = createBalloonRoom(`${input.matchId}:room:${encodeURIComponent(playerId)}`);
        room.economy.nextIncomeTickAt += simulationTimeMs;
        return [playerId, { playerId, room, nextSendSequence: 1 }];
    }));
    return {
        matchId: input.matchId,
        seed: input.seed,
        status: "active",
        simulationTimeMs,
        playerOrder: [firstPlayerId, secondPlayerId],
        players,
        waveState: createWaveState(input.seed, simulationTimeMs),
        result: null,
    };
}
export function getOpponentPlayerId(match, playerId) {
    if (match.playerOrder[0] === playerId)
        return match.playerOrder[1];
    if (match.playerOrder[1] === playerId)
        return match.playerOrder[0];
    return null;
}
export function applyFloatMatchAction(match, action) {
    if (match.status === "complete")
        return rejected(action.type, "match_complete", "Match is complete");
    const actor = match.players[action.actorPlayerId];
    if (!actor)
        return rejected(action.type, "actor_not_found", "Acting player not found");
    if (action.type === "SEND_BALLOON") {
        const target = match.players[action.targetPlayerId];
        if (!target || action.targetPlayerId === action.actorPlayerId)
            return rejected(action.type, "invalid_target", "Choose the opposing player");
        const senderSequence = actor.nextSendSequence;
        const sendAction = createSendBalloonAction({
            matchId: match.matchId,
            senderId: action.actorPlayerId,
            targetRoomId: target.room.id,
            lane: action.lane,
            senderSequence,
            sentAt: action.sentAt,
            balloonType: action.balloonType,
        });
        const result = applyGameAction(actor.room, sendAction, target.room);
        if (result.applied)
            actor.nextSendSequence += 1;
        return result;
    }
    if (action.type === "PLACE_WALL" && action.wall.roomId !== actor.room.id) {
        return rejected(action.type, "not_owner", "Player may only build in their own room");
    }
    const resourceOwnerId = getActionResourceOwnerId(match, action);
    if (resourceOwnerId && resourceOwnerId !== action.actorPlayerId) {
        return rejected(action.type, "not_owner", "Player may only modify their own room");
    }
    return applyGameAction(actor.room, action);
}
export function updateFloatMatch(match, deltaSeconds) {
    const emptyWaveResult = { spawnedBalloons: [], completedRoundId: null, startedRoundId: null, unlockedBalloonType: null, allWavesComplete: match.waveState.status === "complete" };
    const roomEvents = Object.fromEntries(match.playerOrder.map((playerId) => [playerId, []]));
    const result = { roomEvents, launchedBalloons: [], waveResult: emptyWaveResult, completedResult: null };
    if (match.status === "complete" || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
        return result;
    match.simulationTimeMs += deltaSeconds * 1000;
    for (const playerId of match.playerOrder) {
        applyGameAction(match.players[playerId].room, { type: "APPLY_INCOME_TICK", simulationTimeMs: match.simulationTimeMs });
    }
    for (const playerId of match.playerOrder) {
        const targetPlayerId = getOpponentPlayerId(match, playerId);
        const launch = applyGameAction(match.players[playerId].room, { type: "APPLY_LAUNCH_QUEUE", simulationTimeMs: match.simulationTimeMs }, match.players[targetPlayerId].room);
        if (launch.applied && launch.launchedBalloon)
            result.launchedBalloons.push(launch.launchedBalloon);
    }
    for (const playerId of match.playerOrder) {
        roomEvents[playerId] = updateRoomSimulation(match.players[playerId].room, deltaSeconds);
    }
    result.waveResult = updateWaveState(match.waveState, match.playerOrder.map((playerId) => match.players[playerId].room), match.simulationTimeMs);
    result.completedResult = completeMatchIfNeeded(match);
    return result;
}
export function completeMatchIfNeeded(match) {
    if (match.status === "complete")
        return match.result;
    const [firstPlayerId, secondPlayerId] = match.playerOrder;
    const firstLost = match.players[firstPlayerId].room.health <= 0;
    const secondLost = match.players[secondPlayerId].room.health <= 0;
    if (!firstLost && !secondLost)
        return null;
    match.status = "complete";
    match.result = firstLost && secondLost
        ? { type: "draw", winnerPlayerId: null, loserPlayerId: null, completedAt: match.simulationTimeMs }
        : firstLost
            ? { type: "win", winnerPlayerId: secondPlayerId, loserPlayerId: firstPlayerId, completedAt: match.simulationTimeMs }
            : { type: "win", winnerPlayerId: firstPlayerId, loserPlayerId: secondPlayerId, completedAt: match.simulationTimeMs };
    return match.result;
}
function rejected(action, code, message) {
    return { action, applied: false, code, message };
}
function getActionResourceOwnerId(match, action) {
    if (action.type === "PLACE_WALL") {
        return match.playerOrder.find((playerId) => match.players[playerId].room.id === action.wall.roomId) ?? null;
    }
    const entityId = action.type === "POP_BALLOON" ? action.balloonId : action.wallSegmentId;
    return match.playerOrder.find((playerId) => {
        const room = match.players[playerId].room;
        return action.type === "POP_BALLOON"
            ? room.balloons.some((balloon) => balloon.id === entityId)
            : room.walls.some((wall) => wall.id === entityId);
    }) ?? null;
}
//# sourceMappingURL=match.js.map