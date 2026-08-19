import { createSupabaseClient } from "@/lib/supabase";

export type DatabaseRecord = Record<string, unknown>;

export type LiveRoom = DatabaseRecord & {
  id: string | number;
  host_id?: string | number | null;
  status?: string | null;
  scheduled_at?: string | null;
  cover_image?: string | null;
};

export type HostProfile = DatabaseRecord & {
  id: string | number;
};

export function asText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function getRoomTitle(room: LiveRoom) {
  return (
    asText(room.title) ?? asText(room.name) ?? asText(room.room_name) ?? "Live Room"
  );
}

export function getRoomDescription(room: LiveRoom) {
  return (
    asText(room.description) ??
    asText(room.topic) ??
    asText(room.subtitle) ??
    "Jump into the live conversation happening now."
  );
}

export function getActivity(room: LiveRoom) {
  const activityFields = [
    "active_count",
    "participant_count",
    "participants_count",
    "viewer_count",
    "viewers_count",
    "listener_count",
    "listeners_count",
    "member_count",
    "members_count",
    "live_count",
  ];

  return activityFields.reduce((highest, field) => {
    return Math.max(highest, asNumber(room[field]) ?? 0);
  }, 0);
}

export function getHostName(profile?: HostProfile) {
  if (!profile) {
    return "PartyUp host";
  }

  return (
    asText(profile.display_name) ??
    asText(profile.full_name) ??
    asText(profile.username) ??
    asText(profile.name) ??
    "PartyUp host"
  );
}

export function getHostInitial(profile?: HostProfile) {
  return getHostName(profile).slice(0, 1).toUpperCase();
}

export function getCategory(room: LiveRoom) {
  return (
    asText(room.category) ?? asText(room.room_type) ?? asText(room.type) ?? "Live"
  );
}

export function getRoomLocation(room: LiveRoom) {
  return (
    asText(room.venue_name) ??
    asText(room.location) ??
    asText(room.city) ??
    asText(room.place) ??
    asText(room.region) ??
    null
  );
}

export function getRoomCoordinates(room: LiveRoom) {
  const latitude = asNumber(room.latitude);
  const longitude = asNumber(room.longitude);

  if (
    latitude == null ||
    longitude == null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function getScheduledText(room: LiveRoom) {
  const rawDate = asText(room.scheduled_at);

  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function getLiveRooms() {
  const supabase = createSupabaseClient();

  const { data: rooms, error: roomsError } = await supabase
    .from("event_rooms")
    .select("*")
    .in("status", ["live", "scheduled"]);

  if (roomsError) {
    throw roomsError;
  }

  const liveRooms = ((rooms ?? []) as LiveRoom[]).filter((room) => room.id);
  const hostIds = Array.from(
    new Set(
      liveRooms
        .map((room) => room.host_id)
        .filter((hostId): hostId is string | number => hostId != null),
    ),
  );

  if (hostIds.length === 0) {
    return { rooms: liveRooms, profilesById: new Map<string, HostProfile>() };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", hostIds);

  if (profilesError) {
    throw profilesError;
  }

  return {
    rooms: liveRooms,
    profilesById: new Map(
      ((profiles ?? []) as HostProfile[]).map((profile) => [String(profile.id), profile]),
    ),
  };
}
