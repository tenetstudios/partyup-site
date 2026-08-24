import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export type RoomMission = {
  id: string;
  room_id: string;
  created_by_identity_id: string;
  title: string;
  description: string | null;
  mission_type: "generic" | "animal_pack" | "connection" | "wild_faction";
  config: {
    animals?: string[];
    target_encounters?: number;
    target_connections?: number;
    completion_event?: "partyup_connection_created";
    game_id?: string;
    faction_key?: string;
    territory_key?: string;
    influence_reward?: number;
    verification_type?: "none" | "encounter" | "memory_upload" | "match_faction";
    encounter_relationship?: "same_faction" | "different_faction" | "specific_faction" | null;
    required_encounters?: number;
    target_faction?: string | null;
    required_media_type?: "any" | "image" | "video";
    required_memories?: number;
    match_relationship?: "opposing_faction";
    required_matches?: number;
  };
  status: "draft" | "active" | "ended";
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  ended_at: string | null;
  completion_count: number;
  participant_count: number;
  viewer_completed: boolean;
  can_manage: boolean;
};

export type RoomMissionHistoryItem = Omit<RoomMission, "viewer_completed" | "can_manage"> & {
  ended_reason: "manual" | "expired" | "replaced" | "room_ended" | null;
};

export type RoomMissionInput = {
  title: string;
  description?: string;
  durationMinutes?: number | null;
  verificationType?: "none" | "memory_upload";
  requiredMediaType?: "any" | "image" | "video";
};

export type AnimalPackState = {
  assignment_key: string;
  progress: number;
  target_encounters: number;
  completed: boolean;
  completed_at: string | null;
  mission_active: boolean;
};

export type ConnectionMissionState = {
  progress: number;
  target_connections: number;
  completed: boolean;
  completed_at: string | null;
  mission_active: boolean;
};

export type MissionEncounterToken = {
  token: string;
  qr_payload: string;
  short_code: string;
  expires_at: string;
};

export type EncounterResultStatus =
  | "valid"
  | "self_scan"
  | "wrong_mission"
  | "wrong_animal"
  | "duplicate"
  | "expired"
  | "mission_ended"
  | "invalid";

export type MissionEncounterResult = {
  status: EncounterResultStatus;
  progress?: number;
  target_encounters?: number;
  completed?: boolean;
};

export type AnimalPackHostResults = {
  participant_count: number;
  completed_count: number;
  completed_participants: Array<{
    identity_id: string;
    display_name: string;
    avatar_url: string | null;
    completed_at: string;
  }>;
};

export type MissionOperationalStatus =
  | "healthy"
  | "waiting_for_participants"
  | "needs_people"
  | "imbalanced"
  | "ended";

export type MissionOperationsGroup = {
  assignment_key: string;
  label: string;
  color: string | null;
  participant_count: number;
  completed_count: number;
  encounter_count: number;
  minimum_group_size: number | null;
  underfilled: boolean;
};

export type MissionOperationsDashboard = {
  mission_id: string;
  mission_type: string;
  title: string;
  status: RoomMission["status"];
  starts_at: string | null;
  ends_at: string | null;
  generated_at: string;
  last_activity_at: string;
  minimum_group_size: number | null;
  operational_status: MissionOperationalStatus;
  summary: {
    participant_count: number;
    assigned_participant_count: number;
    unassigned_participant_count: number;
    completed_count: number;
    completion_rate: number;
    encounter_count: number;
    group_count: number;
    smallest_group_count: number;
    largest_group_count: number;
    assignment_spread: number;
    underfilled_group_count: number;
  };
  groups: MissionOperationsGroup[];
};

export type MissionCompletedParticipants = {
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
  participants: {
    identity_id: string;
    display_name: string;
    avatar_url: string | null;
    assignment_key: string | null;
    completed_at: string;
  }[];
};

export const animalDetails: Record<string, { singular: string; plural: string }> = {
  "🐸": { singular: "frog", plural: "frogs" },
  "🦁": { singular: "lion", plural: "lions" },
  "🐼": { singular: "panda", plural: "pandas" },
  "🦊": { singular: "fox", plural: "foxes" },
  "🐵": { singular: "monkey", plural: "monkeys" },
  "🐙": { singular: "octopus", plural: "octopuses" },
  "🐯": { singular: "tiger", plural: "tigers" },
  "🐨": { singular: "koala", plural: "koalas" },
  "🐧": { singular: "penguin", plural: "penguins" },
  "🐰": { singular: "rabbit", plural: "rabbits" },
  "🐺": { singular: "wolf", plural: "wolves" },
  "🦄": { singular: "unicorn", plural: "unicorns" },
};

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }

  return (value as T | null) ?? null;
}

function withNumericCount<T extends { completion_count: unknown; participant_count?: unknown }>(row: T) {
  return {
    ...row,
    completion_count: Number(row.completion_count ?? 0),
    participant_count: Number(row.participant_count ?? 0),
  };
}

export function normalizeRoomMissionInput(input: RoomMissionInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const durationMinutes = input.durationMinutes ?? null;

  if (!title) {
    throw new Error("Mission title is required.");
  }

  if (title.length > 120) {
    throw new Error("Mission title must be 120 characters or fewer.");
  }

  if (description && description.length > 1000) {
    throw new Error("Mission description must be 1000 characters or fewer.");
  }

  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)
  ) {
    throw new Error("Mission duration must be between 1 and 1440 minutes.");
  }

  return { title, description, durationMinutes };
}

export function getMissionTimeRemaining(endsAt: string | null, now = Date.now()) {
  if (!endsAt) {
    return null;
  }

  const remainingMs = Math.max(0, Date.parse(endsAt) - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    expired: remainingMs === 0,
    label: `${minutes}:${seconds.toString().padStart(2, "0")}`,
    remainingMs,
  };
}

export async function getActiveRoomMission(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_active_room_mission", {
    p_room_id: roomId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const mission = firstRow<RoomMission>(data);
  return mission ? withNumericCount(mission) : null;
}

export async function getRoomMissionHistory(
  supabase: SupabaseClient,
  roomId: string,
  limit = 10,
) {
  const { data, error } = await supabase.rpc("get_room_mission_history", {
    p_room_id: roomId,
    p_limit: limit,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as RoomMissionHistoryItem[]).map(withNumericCount);
}

export async function publishRoomMission(
  supabase: SupabaseClient,
  roomId: string,
  input: RoomMissionInput,
) {
  const normalized = normalizeRoomMissionInput(input);
  const memoryVerification = input.verificationType === "memory_upload";
  const { data, error } = await supabase.rpc(memoryVerification ? "publish_memory_room_mission" : "publish_room_mission", {
    p_room_id: roomId,
    p_title: normalized.title,
    p_description: normalized.description,
    p_duration_minutes: normalized.durationMinutes,
    ...(memoryVerification ? { p_required_media_type: input.requiredMediaType ?? "any" } : {}),
  });

  if (error) {
    throw new Error(error.message);
  }

  requestPushDispatch(supabase, roomId);
  return firstRow<RoomMission>(data);
}

export async function publishAnimalPackMission(
  supabase: SupabaseClient,
  roomId: string,
  input: { animalCount: number; targetEncounters: number; durationMinutes: number },
) {
  const { data, error } = await supabase.rpc("publish_animal_pack_mission", {
    p_room_id: roomId,
    p_animal_count: input.animalCount,
    p_target_encounters: input.targetEncounters,
    p_duration_minutes: input.durationMinutes,
  });
  if (error) throw new Error(error.message);
  requestPushDispatch(supabase, roomId);
  return firstRow<RoomMission>(data);
}

export async function publishConnectionMission(
  supabase: SupabaseClient,
  roomId: string,
  input: { targetConnections: number; durationMinutes: number },
) {
  if (!Number.isInteger(input.targetConnections) || input.targetConnections < 1 || input.targetConnections > 20) {
    throw new Error("Connection target must be between 1 and 20 people.");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) {
    throw new Error("Connection Mission duration must be between 1 and 1440 minutes.");
  }

  const { data, error } = await supabase.rpc("publish_connection_mission", {
    p_room_id: roomId,
    p_target_connections: input.targetConnections,
    p_duration_minutes: input.durationMinutes,
  });
  if (error) throw new Error(error.message);
  requestPushDispatch(supabase, roomId);
  return firstRow<RoomMission>(data);
}

export async function getMyConnectionMissionState(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("get_my_connection_mission_state", {
    p_mission_id: missionId,
  });
  if (error) throw new Error(error.message);
  const state = data as ConnectionMissionState;
  return {
    ...state,
    progress: Number(state.progress ?? 0),
    target_connections: Number(state.target_connections ?? 1),
  };
}

export async function joinAnimalPackMission(
  supabase: SupabaseClient,
  missionId: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("join_animal_pack_mission", {
    p_mission_id: missionId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { assignment_key: string };
}

export async function getMyAnimalPackState(
  supabase: SupabaseClient,
  missionId: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("get_my_animal_pack_state", {
    p_mission_id: missionId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as AnimalPackState | null) ?? null;
}

export async function createMissionEncounterToken(
  supabase: SupabaseClient,
  missionId: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("create_mission_encounter_token", {
    p_mission_id: missionId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MissionEncounterToken;
}

export async function redeemMissionEncounterToken(
  supabase: SupabaseClient,
  missionId: string,
  tokenOrCode: string,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("redeem_mission_encounter_token", {
    p_mission_id: missionId,
    p_token_or_code: tokenOrCode,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MissionEncounterResult;
}

export async function getAnimalPackHostResults(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("get_animal_pack_host_results", {
    p_mission_id: missionId,
  });
  if (error) throw new Error(error.message);
  const result = data as AnimalPackHostResults;
  return {
    ...result,
    participant_count: Number(result.participant_count ?? 0),
    completed_count: Number(result.completed_count ?? 0),
    completed_participants: result.completed_participants ?? [],
  };
}

export async function getMissionOperationsDashboard(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("get_mission_operations_dashboard", {
    p_mission_id: missionId,
  });
  if (error) throw new Error(error.message);
  return data as MissionOperationsDashboard;
}

export async function getMissionCompletedParticipants(
  supabase: SupabaseClient,
  missionId: string,
  limit = 100,
  offset = 0,
) {
  const { data, error } = await supabase.rpc("get_mission_completed_participants", {
    p_mission_id: missionId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return data as MissionCompletedParticipants;
}

export async function endRoomMission(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("end_room_mission", {
    p_mission_id: missionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstRow<RoomMission>(data);
}

export async function completeRoomMission(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("complete_room_mission", {
    p_mission_id: missionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstRow<{ id: string; completed_at: string }>(data);
}

export async function verifyMemoryMissionCompletion(
  supabase: SupabaseClient,
  missionId: string,
  memoryId: string,
) {
  const { data, error } = await supabase.rpc("verify_memory_mission_completion", {
    p_mission_id: missionId,
    p_memory_id: memoryId,
  });
  if (error) throw new Error(error.message);
  return data as { status: "verified"; mission_id: string; memory_id: string; completed: boolean };
}

export async function claimMemoryMissionCompletion(supabase: SupabaseClient, missionId: string) {
  const { data, error } = await supabase.rpc("claim_memory_mission_completion", {
    p_mission_id: missionId,
  });
  if (error) throw new Error(error.message);
  return data as { status: "verified"; mission_id: string; memory_id: string; completed: boolean };
}
