import { asText, getRoomTitle, type DatabaseRecord } from "@/lib/homeHelpers";

export type RoomContextRecord = DatabaseRecord & {
  id?: string | number | null;
  status?: string | null;
  ends_at?: string | null;
  expires_at?: string | null;
  deleted_at?: string | null;
};

export type AvailableRoomContextRecord = RoomContextRecord & {
  id: string | number;
};

const inactiveStatuses = new Set(["ended", "deleted", "archived", "cancelled", "canceled"]);

function isPast(value: unknown, nowMs: number) {
  const text = asText(value);

  if (!text) {
    return false;
  }

  const time = Date.parse(text);
  return Number.isFinite(time) && time <= nowMs;
}

export function isRoomContextAvailable(
  room: RoomContextRecord | null | undefined,
  now = new Date(),
): room is AvailableRoomContextRecord {
  if (!room?.id) {
    return false;
  }

  const status = asText(room.status)?.toLowerCase();

  if (status && inactiveStatuses.has(status)) {
    return false;
  }

  if (asText(room.deleted_at)) {
    return false;
  }

  const nowMs = now.getTime();

  return !isPast(room.ends_at, nowMs) && !isPast(room.expires_at, nowMs);
}

export function getRoomContextLabel(room: RoomContextRecord) {
  return getRoomTitle({ ...room, id: room.id ?? "room" });
}
