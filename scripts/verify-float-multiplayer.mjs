import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as browserCore from "@partyup/balloon-core";
import * as edgeCore from "../supabase/functions/_shared/balloon-core/index.js";

function exercise(core) {
  const state = core.createFloatMatch({
    matchId: "phase-8-1-parity",
    playerIds: ["playerA", "playerB"],
    seed: 601,
  });
  const wall = core.createWallSegment(state.players.playerA.room.id, "vertical", 2, 5);
  assert.equal(core.applyFloatMatchAction(state, { type: "PLACE_WALL", actorPlayerId: "playerA", wall }).applied, true);
  assert.equal(core.applyFloatMatchAction(state, {
    type: "SEND_BALLOON",
    actorPlayerId: "playerB",
    targetPlayerId: "playerA",
    balloonType: "basic",
    lane: 3,
    sentAt: state.simulationTimeMs,
  }).applied, true);
  for (let step = 0; step < 300; step += 1) core.updateFloatMatch(state, core.SIMULATION_STEP_SECONDS);
  return state;
}

assert.deepEqual(exercise(edgeCore), exercise(browserCore), "Edge and browser core builds must produce identical canonical state");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.dependencies["@partyup/balloon-core"], "file:vendor/partyup-balloon-core-8.1.0.tgz");

const migration = await readFile(new URL("../supabase/migrations/20260902004000_float_realtime_multiplayer.sql", import.meta.url), "utf8");
for (const contract of [
  "alter table public.float_matches enable row level security",
  "alter table public.float_match_actions enable row level security",
  "unique (match_id, sequence)",
  "unique (match_id, client_action_id)",
  "grant select on public.float_matches to authenticated",
  "grant execute on function public.float_server_commit_action",
  "to service_role",
  "alter publication supabase_realtime add table public.float_match_actions",
]) assert.ok(migration.includes(contract), `Missing database contract: ${contract}`);

console.log("Float 8.1 browser/server core parity and database transport contracts verified.");
