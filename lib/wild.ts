import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export type WildFaction = {
  key: string;
  label: string;
  emoji: string;
  color?: string;
};

export type WildTerritory = {
  id: string;
  key: string;
  display_name: string;
  influence: Record<string, number>;
  controlling_faction: string | null;
  updated_at: string;
};

export type WildMission = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  config: {
    game_id: string;
    faction_key: string;
    territory_key: string;
    influence_reward: number;
    verification_type?: "none" | "encounter" | "memory_upload" | "match_faction";
    encounter_relationship?: "same_faction" | "different_faction" | "specific_faction" | null;
    required_encounters?: number;
    target_faction?: string | null;
    required_media_type?: "any" | "image" | "video";
    required_memories?: number;
    match_relationship?: "opposing_faction";
    required_matches?: number;
  };
  viewer_completed: boolean;
  eligible: boolean;
};

export type WildEncounterState = {
  progress: number;
  required_encounters: number;
  completed: boolean;
  eligible: boolean;
  verification_type: "encounter";
  encounter_relationship: "same_faction" | "different_faction" | "specific_faction";
  target_faction: string | null;
  verified_encounter_count: number;
  mission_completion_count: number;
  mission_active: boolean;
};

export type WildMatchState = {
  progress: number;
  required_matches: number;
  completed: boolean;
  eligible: boolean;
  verification_type: "match_faction";
  match_relationship: "opposing_faction";
  verified_match_count: number;
  mission_completion_count: number;
  mission_active: boolean;
};

export type WildEncounterStatus = "valid" | "self_scan" | "wrong_mission" | "wrong_game" | "wrong_room" | "wrong_faction" | "wrong_animal" | "same_faction_required" | "different_faction_required" | "specific_faction_required" | "duplicate" | "expired" | "mission_ended" | "game_ended" | "invalid";

export type WildWinnerScore = {
  faction_key: string;
  label: string;
  emoji: string;
  territories_controlled: number;
  total_influence: number;
};

export type WildRoomState = {
  game: null | {
    id: string;
    room_id: string;
    status: "draft" | "active" | "ended";
    config: { factions: WildFaction[]; territories: { key: string; label: string }[] };
    started_at: string | null;
    ended_at: string | null;
    winner_summary: null | { winners: WildWinnerScore[]; scores: WildWinnerScore[] };
  };
  assignment: WildFaction | null;
  territories: WildTerritory[];
  populations: (Omit<WildFaction, "key"> & { faction_key: string; population: number })[];
  impact: { missions_completed: number; influence_added: number };
  mission: WildMission | null;
  can_manage: boolean;
  room_closed: boolean;
};

function normalizeState(value: unknown): WildRoomState {
  const state = value as WildRoomState;
  return {
    ...state,
    territories: (state.territories ?? []).map((territory) => ({
      ...territory,
      influence: Object.fromEntries(
        Object.entries(territory.influence ?? {}).map(([key, amount]) => [key, Number(amount ?? 0)]),
      ),
    })),
    populations: (state.populations ?? []).map((faction) => ({ ...faction, population: Number(faction.population ?? 0) })),
    impact: {
      missions_completed: Number(state.impact?.missions_completed ?? 0),
      influence_added: Number(state.impact?.influence_added ?? 0),
    },
  };
}

export async function getWildRoomState(supabase: SupabaseClient, roomId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_wild_room_state", {
    p_room_id: roomId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return normalizeState(data);
}

export async function startWildGame(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("start_wild_game", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as { id: string };
}

export async function enterWildGame(supabase: SupabaseClient, gameId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("enter_wild_game", {
    p_game_id: gameId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { game_id: string; participant_identity_id: string; faction: WildFaction };
}

export async function publishWildMission(
  supabase: SupabaseClient,
  input: {
    gameId: string;
    factionKey: string;
    territoryKey: string;
    title: string;
    description?: string | null;
    influenceReward: number;
    durationMinutes: number;
    verificationType?: "none" | "encounter" | "memory_upload" | "match_faction";
    encounterRelationship?: "same_faction" | "different_faction" | "specific_faction" | null;
    requiredEncounters?: number;
    targetFaction?: string | null;
    requiredMediaType?: "any" | "image" | "video";
    requiredMatches?: number;
  },
) {
  const memoryVerification = input.verificationType === "memory_upload";
  const matchVerification = input.verificationType === "match_faction";
  const { data, error } = await supabase.rpc(memoryVerification ? "publish_wild_memory_mission" : matchVerification ? "publish_wild_match_mission" : "publish_wild_faction_mission", {
    p_game_id: input.gameId,
    p_faction_key: input.factionKey,
    p_territory_key: input.territoryKey,
    p_title: input.title,
    p_description: input.description ?? null,
    p_influence_reward: input.influenceReward,
    p_duration_minutes: input.durationMinutes,
    ...(memoryVerification ? {
      p_required_media_type: input.requiredMediaType ?? "any",
    } : matchVerification ? {
      p_required_matches: input.requiredMatches ?? 2,
    } : {
      p_verification_type: input.verificationType ?? "none",
      p_encounter_relationship: input.encounterRelationship ?? null,
      p_required_encounters: input.requiredEncounters ?? 1,
      p_target_faction: input.targetFaction ?? null,
    }),
  });
  if (error) throw new Error(error.message);
  requestPushDispatch(supabase, (data as { room_id?: string } | null)?.room_id);
  return data;
}

export async function getWildEncounterState(supabase: SupabaseClient, missionId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_my_wild_encounter_state", { p_mission_id: missionId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  const state = data as WildEncounterState;
  return { ...state, progress: Number(state.progress ?? 0), required_encounters: Number(state.required_encounters ?? 1), verified_encounter_count: Number(state.verified_encounter_count ?? 0), mission_completion_count: Number(state.mission_completion_count ?? 0) };
}

export async function getWildMatchState(supabase: SupabaseClient, missionId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_my_wild_match_state", {
    p_mission_id: missionId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  const state = data as WildMatchState;
  return {
    ...state,
    progress: Number(state.progress ?? 0),
    required_matches: Number(state.required_matches ?? 1),
    verified_match_count: Number(state.verified_match_count ?? 0),
    mission_completion_count: Number(state.mission_completion_count ?? 0),
  };
}

export async function createWildEncounterToken(supabase: SupabaseClient, missionId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("create_mission_encounter_token", { p_mission_id: missionId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as { token: string; qr_payload: string; short_code: string; expires_at: string };
}

export async function redeemWildEncounterToken(supabase: SupabaseClient, missionId: string, value: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("redeem_mission_encounter_token", { p_mission_id: missionId, p_token_or_code: value, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as { status: WildEncounterStatus; progress?: number; target_encounters?: number; completed?: boolean; owner_completed?: boolean };
}

export async function completeWildMission(
  supabase: SupabaseClient,
  missionId: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("complete_wild_faction_mission", {
    p_mission_id: missionId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as {
    status: "awarded" | "already_completed";
    territory_key: string;
    controlling_faction: string | null;
    influence: Record<string, number>;
    impact: { missions_completed: number; influence_added: number };
  };
}

export async function endWildGame(supabase: SupabaseClient, gameId: string) {
  const { data, error } = await supabase.rpc("end_wild_game", { p_game_id: gameId });
  if (error) throw new Error(error.message);
  requestPushDispatch(supabase, (data as { room_id?: string } | null)?.room_id);
  return data;
}

export function wildFactionByKey(state: WildRoomState, key: string | null | undefined) {
  return state.game?.config.factions.find((faction) => faction.key === key) ?? null;
}
