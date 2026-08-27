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
    verification_type?: "none" | "encounter" | "memory_upload" | "match_faction" | "live_node" | "form_squad";
    encounter_relationship?: "same_faction" | "different_faction" | "specific_faction" | null;
    required_encounters?: number;
    target_faction?: string | null;
    required_media_type?: "any" | "image" | "video";
    required_memories?: number;
    match_relationship?: "opposing_faction";
    required_matches?: number;
    scope?: "faction" | "squad";
    progress_mode?: "aggregate";
    required_progress?: number;
    node_id?: string | null;
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

export type WildSquadFormationStatus = WildEncounterStatus | "already_in_squad" | "squad_full";

export type WildSquadState = {
  id: string;
  game_id: string;
  faction_key: string;
  label: string;
  status: "provisional" | "active" | "ended";
  member_count: number;
  minimum_members: number;
  maximum_members: number;
  formation_progress: number;
  members_needed: number;
  can_add_members: boolean;
  members: { identity_id: string; display_name: string; avatar_url: string | null; joined_at: string; is_you: boolean }[];
};

export type WildSquadMissionState = {
  squad_id: string | null;
  progress: number;
  required_progress: number;
  personal_progress: number;
  completed: boolean;
  eligible: boolean;
  verification_type: "encounter" | "match_faction" | "memory_upload" | "live_node" | "form_squad";
  mission_active: boolean;
};
export type WildSquadOverview = { id: string; faction_key: string; status: "provisional" | "active" | "ended"; member_count: number; missions_completed: number };

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
    verificationType?: "none" | "encounter" | "memory_upload" | "match_faction" | "live_node" | "form_squad";
    encounterRelationship?: "same_faction" | "different_faction" | "specific_faction" | null;
    requiredEncounters?: number;
    targetFaction?: string | null;
    requiredMediaType?: "any" | "image" | "video";
    requiredMatches?: number;
    scope?: "faction" | "squad";
    requiredProgress?: number;
    liveNodeId?: string | null;
  },
) {
  if (input.scope === "squad") {
    const { data, error } = await supabase.rpc("publish_wild_squad_mission", {
      p_game_id: input.gameId,
      p_faction_key: input.factionKey,
      p_territory_key: input.territoryKey,
      p_title: input.title,
      p_description: input.description ?? null,
      p_influence_reward: input.influenceReward,
      p_duration_minutes: input.durationMinutes,
      p_verification_type: input.verificationType,
      p_required_progress: input.requiredProgress ?? input.requiredMatches ?? input.requiredEncounters ?? 1,
      p_encounter_relationship: input.encounterRelationship ?? null,
      p_target_faction: input.targetFaction ?? null,
      p_required_media_type: input.requiredMediaType ?? "any",
      p_live_node_id: input.liveNodeId ?? null,
    });
    if (error) throw new Error(error.message);
    requestPushDispatch(supabase, (data as { room_id?: string } | null)?.room_id);
    return data;
  }
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

export async function beginWildSquad(supabase: SupabaseClient, gameId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("begin_wild_squad", { p_game_id: gameId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getMyWildSquadState(supabase: SupabaseClient, gameId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_my_wild_squad_state", { p_game_id: gameId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const squad = data as WildSquadState;
  return { ...squad, member_count: Number(squad.member_count), formation_progress: Number(squad.formation_progress), members_needed: Number(squad.members_needed) };
}

export async function createWildSquadToken(supabase: SupabaseClient, gameId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("create_wild_squad_token", { p_game_id: gameId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  return data as { token: string; qr_payload: string; short_code: string; expires_at: string };
}

export async function redeemWildSquadToken(supabase: SupabaseClient, gameId: string, value: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("redeem_wild_squad_token", { p_game_id: gameId, p_token_or_code: value, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  const result = data as { status: WildSquadFormationStatus; squad_id?: string; member_count?: number; formed?: boolean; just_formed?: boolean; room_id?: string };
  if (result.just_formed) requestPushDispatch(supabase, result.room_id);
  return result;
}

export async function getMyWildSquadMissionState(supabase: SupabaseClient, missionId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_my_wild_squad_mission_state", { p_mission_id: missionId, p_guest_token: guestToken ?? null });
  if (error) throw new Error(error.message);
  const state = data as WildSquadMissionState;
  return { ...state, progress: Number(state.progress), required_progress: Number(state.required_progress), personal_progress: Number(state.personal_progress) };
}

export async function getWildSquadsOverview(supabase: SupabaseClient, gameId: string) {
  const { data, error } = await supabase.rpc("get_wild_squads_overview", { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as WildSquadOverview[]).map((item) => ({ ...item, member_count: Number(item.member_count), missions_completed: Number(item.missions_completed) }));
}

export function wildFactionByKey(state: WildRoomState, key: string | null | undefined) {
  return state.game?.config.factions.find((faction) => faction.key === key) ?? null;
}
