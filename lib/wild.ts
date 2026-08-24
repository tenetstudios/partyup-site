import type { SupabaseClient } from "@supabase/supabase-js";

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
  };
  viewer_completed: boolean;
  eligible: boolean;
};

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
  },
) {
  const { data, error } = await supabase.rpc("publish_wild_faction_mission", {
    p_game_id: input.gameId,
    p_faction_key: input.factionKey,
    p_territory_key: input.territoryKey,
    p_title: input.title,
    p_description: input.description ?? null,
    p_influence_reward: input.influenceReward,
    p_duration_minutes: input.durationMinutes,
  });
  if (error) throw new Error(error.message);
  return data;
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
  return data;
}

export function wildFactionByKey(state: WildRoomState, key: string | null | undefined) {
  return state.game?.config.factions.find((faction) => faction.key === key) ?? null;
}
