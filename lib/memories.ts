import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryMediaType = "image" | "video";

export type RoomMemory = {
  id: string;
  room_id: string;
  uploader_identity_id: string;
  media_type: MemoryMediaType;
  media_path: string;
  thumbnail_path: string | null;
  created_at: string;
  uploader_name: string | null;
  uploader_avatar_url: string | null;
  is_saved?: boolean;
};

export type SavedMemory = RoomMemory & {
  saved_memory_id: string;
  saved_at: string;
  room_title: string;
  room_date: string | null;
};

export type SavedMemoryGroup = {
  room_id: string;
  room_title: string;
  room_date: string | null;
  latest_saved_at: string;
  memory_count: number;
  memories: SavedMemory[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeRoomMemory(value: unknown): RoomMemory {
  const record = asRecord(value);
  const mediaType = asString(record.media_type) === "video" ? "video" : "image";

  return {
    id: asString(record.id) ?? "",
    room_id: asString(record.room_id) ?? "",
    uploader_identity_id: asString(record.uploader_identity_id) ?? "",
    media_type: mediaType,
    media_path: asString(record.media_path) ?? "",
    thumbnail_path: asString(record.thumbnail_path),
    created_at: asString(record.created_at) ?? "",
    uploader_name: asString(record.uploader_name),
    uploader_avatar_url: asString(record.uploader_avatar_url),
    is_saved: record.is_saved === true,
  };
}

function normalizeSavedMemory(value: unknown): SavedMemory {
  const record = asRecord(value);
  const base = normalizeRoomMemory(record);

  return {
    ...base,
    saved_memory_id: asString(record.saved_memory_id) ?? "",
    saved_at: asString(record.saved_at) ?? "",
    room_title: asString(record.room_title) ?? "PartyUp event",
    room_date: asString(record.room_date),
  };
}

function normalizeSavedMemoryGroup(value: unknown): SavedMemoryGroup {
  const record = asRecord(value);
  const rawMemories = Array.isArray(record.memories) ? record.memories : [];
  const memories = rawMemories.map(normalizeSavedMemory).filter((memory) => memory.id);

  return {
    room_id: asString(record.room_id) ?? "",
    room_title: asString(record.room_title) ?? "PartyUp event",
    room_date: asString(record.room_date),
    latest_saved_at: asString(record.latest_saved_at) ?? "",
    memory_count: asNumber(record.memory_count) || memories.length,
    memories,
  };
}

export function formatMemoryDate(value: string | null) {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function formatMemoryTimestamp(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getMemoryPublicUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from("room-memories").getPublicUrl(path).data.publicUrl;
}

export async function getRoomMemories(
  supabase: SupabaseClient,
  roomId: string,
): Promise<RoomMemory[]> {
  const { data, error } = await supabase.rpc("get_room_memories", {
    p_room_id: roomId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const memories = Array.isArray(data) ? data.map(normalizeRoomMemory).filter((memory) => memory.id) : [];
  const savedIds = await getSavedRoomMemoryIds(
    supabase,
    memories.map((memory) => memory.id),
  );

  return memories.map((memory) => ({
    ...memory,
    is_saved: savedIds.has(memory.id),
  }));
}

export async function getSavedRoomMemoryIds(
  supabase: SupabaseClient,
  memoryIds: string[],
): Promise<Set<string>> {
  if (memoryIds.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase.rpc("get_saved_room_memory_ids", {
    p_memory_ids: memoryIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const ids = Array.isArray(data)
    ? data.map((row) => asString(asRecord(row).memory_id)).filter((id): id is string => Boolean(id))
    : [];

  return new Set(ids);
}

export async function saveRoomMemory(
  supabase: SupabaseClient,
  memoryId: string,
): Promise<void> {
  const { error } = await supabase.rpc("save_room_memory", {
    p_memory_id: memoryId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function unsaveRoomMemory(
  supabase: SupabaseClient,
  memoryId: string,
): Promise<void> {
  const { error } = await supabase.rpc("unsave_room_memory", {
    p_memory_id: memoryId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getMySavedMemoryGroups(
  supabase: SupabaseClient,
): Promise<SavedMemoryGroup[]> {
  const { data, error } = await supabase.rpc("get_my_saved_memories");

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data)
    ? data.map(normalizeSavedMemoryGroup).filter((group) => group.room_id)
    : [];
}
