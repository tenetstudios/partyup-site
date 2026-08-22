import type { SupabaseClient } from "@supabase/supabase-js";

export type RoomMission = {
  id: string;
  room_id: string;
  created_by_identity_id: string;
  title: string;
  description: string | null;
  status: "draft" | "active" | "ended";
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  ended_at: string | null;
  completion_count: number;
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
};

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }

  return (value as T | null) ?? null;
}

function withNumericCount<T extends { completion_count: unknown }>(row: T) {
  return { ...row, completion_count: Number(row.completion_count ?? 0) };
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
  const { data, error } = await supabase.rpc("publish_room_mission", {
    p_room_id: roomId,
    p_title: normalized.title,
    p_description: normalized.description,
    p_duration_minutes: normalized.durationMinutes,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstRow<RoomMission>(data);
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
