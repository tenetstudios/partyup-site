import {
  asNumber,
  asText,
  getActivity,
  getRoomCoordinates,
  getRoomLocation,
  type LiveRoom,
} from "@/lib/homeHelpers";

export type ActivityFeedReason = "activity" | "connection" | "following" | "nearby" | "discovery" | "yours";

export type ActivityFeedSignals = {
  currentUserId: string | null;
  notificationRoomIds: string[];
  notificationActorIds: string[];
  connectedUserIds: Set<string>;
  followedUserIds: Set<string>;
  viewerCoordinates: { latitude: number; longitude: number } | null;
  viewerLocation: string | null;
};

export type RankedActivityRoom = {
  room: LiveRoom;
  reason: ActivityFeedReason;
};

function normalizeLocation(value: string | null) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null;
}

function distanceInMiles(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const latitudeA = radians(left.latitude);
  const latitudeB = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function recencyScore(room: LiveRoom) {
  const raw = asText(room.last_active_at) ?? asText(room.updated_at) ?? asText(room.created_at);
  const timestamp = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(timestamp)) return 0;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  return Math.max(0, 24 - ageHours);
}

function relevanceForRoom(room: LiveRoom, signals: ActivityFeedSignals) {
  const roomId = String(room.id);
  const hostId = room.host_id == null ? null : String(room.host_id);
  const notificationRoomIndex = signals.notificationRoomIds.indexOf(roomId);
  const notificationActorIndex = hostId ? signals.notificationActorIds.indexOf(hostId) : -1;
  let reason: Exclude<ActivityFeedReason, "discovery"> | null = null;
  let score = 0;

  if (hostId && signals.currentUserId === hostId) {
    reason = "yours";
    score = 1_100;
  } else if (notificationRoomIndex >= 0) {
    reason = "activity";
    score = 1_000 - Math.min(notificationRoomIndex, 50) * 4;
  } else if (notificationActorIndex >= 0) {
    reason = "activity";
    score = 900 - Math.min(notificationActorIndex, 50) * 3;
  } else if (hostId && signals.connectedUserIds.has(hostId)) {
    reason = "connection";
    score = 800;
  } else if (hostId && signals.followedUserIds.has(hostId)) {
    reason = "following";
    score = 700;
  } else {
    const roomCoordinates = getRoomCoordinates(room);
    const roomLocation = normalizeLocation(getRoomLocation(room));
    const viewerLocation = normalizeLocation(signals.viewerLocation);

    if (signals.viewerCoordinates && roomCoordinates) {
      const miles = distanceInMiles(signals.viewerCoordinates, roomCoordinates);
      if (miles <= 50) {
        reason = "nearby";
        score = 600 - miles * 4;
      }
    } else if (
      viewerLocation &&
      roomLocation &&
      (roomLocation.includes(viewerLocation) || viewerLocation.includes(roomLocation))
    ) {
      reason = "nearby";
      score = 550;
    }
  }

  if (!reason) return null;
  score += room.status === "live" ? 35 : 10;
  score += Math.min(getActivity(room), 25);
  score += recencyScore(room);
  score += asNumber(room.priority) ?? 0;

  return { reason, score };
}

export function rankActivityFeedRooms(
  rooms: LiveRoom[],
  signals: ActivityFeedSignals,
  limit = 5,
  random: () => number = Math.random,
): RankedActivityRoom[] {
  const availableRooms = rooms.filter((room) => room.status === "live" || room.status === "scheduled");
  const relevant = availableRooms
    .map((room) => {
      const relevance = relevanceForRoom(room, signals);
      return relevance ? { room, ...relevance } : null;
    })
    .filter((entry): entry is { room: LiveRoom; reason: Exclude<ActivityFeedReason, "discovery">; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score);
  const relevantIds = new Set(relevant.map((entry) => String(entry.room.id)));
  const discoveryCandidates = availableRooms.filter((room) => !relevantIds.has(String(room.id)));
  const reserveDiscoverySlot = discoveryCandidates.length > 0 ? 1 : 0;
  const selected: RankedActivityRoom[] = relevant
    .slice(0, Math.max(0, limit - reserveDiscoverySlot))
    .map(({ room, reason }) => ({ room, reason }));

  if (reserveDiscoverySlot) {
    const discoveryIndex = Math.min(
      discoveryCandidates.length - 1,
      Math.floor(random() * discoveryCandidates.length),
    );
    selected.push({ room: discoveryCandidates[discoveryIndex], reason: "discovery" });
  }

  return selected;
}
