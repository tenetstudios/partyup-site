import type { SupabaseClient } from "@supabase/supabase-js";

export type HostProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  is_verified_host: boolean;
};

export type HostSocialState = {
  followers: number;
  following: number;
  is_following: boolean;
  connected: boolean;
  connection_id: string | null;
};

export type HostSummary = {
  events_hosted: number;
  people_attended: number;
  connections_created: number;
  memories_created: number;
  is_live_now: boolean;
};

export type HostEvent = {
  id: string;
  title: string;
  status: string | null;
  event_date: string | null;
  venue_name: string | null;
  cover_image_url: string | null;
  people_count: number;
  memory_count: number;
  connection_count: number;
};

export type HostReputationProfile = {
  profile: HostProfile;
  social: HostSocialState;
  summary: HostSummary;
  upcoming_events: HostEvent[];
  past_events: HostEvent[];
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

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function normalizeHostEvent(value: unknown): HostEvent {
  const record = asRecord(value);

  return {
    id: asString(record.id) ?? "",
    title: asString(record.title) ?? "PartyUp event",
    status: asString(record.status),
    event_date: asString(record.event_date),
    venue_name: asString(record.venue_name),
    cover_image_url: asString(record.cover_image_url),
    people_count: asNumber(record.people_count),
    memory_count: asNumber(record.memory_count),
    connection_count: asNumber(record.connection_count),
  };
}

export function normalizeHostReputationProfile(value: unknown): HostReputationProfile | null {
  if (!value) {
    return null;
  }

  const record = asRecord(value);
  const profile = asRecord(record.profile);
  const social = asRecord(record.social);
  const summary = asRecord(record.summary);

  const id = asString(profile.id);

  if (!id) {
    return null;
  }

  return {
    profile: {
      id,
      username: asString(profile.username),
      display_name: asString(profile.display_name),
      avatar_url: asString(profile.avatar_url),
      bio: asString(profile.bio),
      location: asString(profile.location),
      is_verified_host: asBoolean(profile.is_verified_host),
    },
    social: {
      followers: asNumber(social.followers),
      following: asNumber(social.following),
      is_following: asBoolean(social.is_following),
      connected: asBoolean(social.connected),
      connection_id: asString(social.connection_id),
    },
    summary: {
      events_hosted: asNumber(summary.events_hosted),
      people_attended: asNumber(summary.people_attended),
      connections_created: asNumber(summary.connections_created),
      memories_created: asNumber(summary.memories_created),
      is_live_now: asBoolean(summary.is_live_now),
    },
    upcoming_events: Array.isArray(record.upcoming_events)
      ? record.upcoming_events.map(normalizeHostEvent).filter((event) => event.id)
      : [],
    past_events: Array.isArray(record.past_events)
      ? record.past_events.map(normalizeHostEvent).filter((event) => event.id)
      : [],
  };
}

export async function getHostReputationProfile(
  supabase: SupabaseClient,
  hostUserId: string,
): Promise<HostReputationProfile | null> {
  const { data, error } = await supabase.rpc("get_host_reputation_profile", {
    p_host_user_id: hostUserId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeHostReputationProfile(data);
}

export function getHostDisplayName(profile: HostProfile) {
  return (
    profile.username?.trim() ||
    profile.display_name?.trim() ||
    `Guest ${profile.id.slice(0, 4)}`
  );
}

export function formatHostEventDate(value: string | null) {
  if (!value) {
    return "Date TBA";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date TBA";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
