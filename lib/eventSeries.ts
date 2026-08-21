import type { SupabaseClient } from "@supabase/supabase-js";

export type EventSeriesSummary = {
  id: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  event_count: number;
  follower_count: number;
  next_event_at: string | null;
};

export type SeriesEvent = {
  id: string;
  title: string;
  status: string;
  event_date: string | null;
  venue_name: string | null;
  cover_image_url: string | null;
  people_count: number;
  memory_count: number;
};

export type EventSeriesProfile = {
  id: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  created_at: string;
  host: {
    user_id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    is_verified_host: boolean;
  };
  follower_count: number;
  is_following: boolean;
  is_owner: boolean;
  total_events: number;
  returning_attendees: number;
  upcoming_events: SeriesEvent[];
  past_events: SeriesEvent[];
};

export type FollowedSeriesEvent = Pick<SeriesEvent, "id" | "title" | "status" | "event_date" | "cover_image_url"> & {
  series_id: string;
  series_name: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

function event(value: unknown): SeriesEvent | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    title: text(row.title) || "PartyUp event",
    status: text(row.status) || "scheduled",
    event_date: text(row.event_date),
    venue_name: text(row.venue_name),
    cover_image_url: text(row.cover_image_url),
    people_count: number(row.people_count),
    memory_count: number(row.memory_count),
  };
}

export function normalizeEventSeriesSummary(value: unknown): EventSeriesSummary | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    name: text(row.name) || "Event Series",
    description: text(row.description),
    cover_image_url: text(row.cover_image_url),
    event_count: number(row.event_count),
    follower_count: number(row.follower_count),
    next_event_at: text(row.next_event_at),
  };
}

export function normalizeEventSeriesProfile(value: unknown): EventSeriesProfile | null {
  const row = record(value);
  const host = record(row.host);
  const id = text(row.id);
  const hostUserId = text(host.user_id);
  if (!id || !hostUserId) return null;
  return {
    id,
    name: text(row.name) || "Event Series",
    description: text(row.description),
    cover_image_url: text(row.cover_image_url),
    created_at: text(row.created_at) || new Date(0).toISOString(),
    host: {
      user_id: hostUserId,
      username: text(host.username),
      display_name: text(host.display_name),
      avatar_url: text(host.avatar_url),
      is_verified_host: host.is_verified_host === true,
    },
    follower_count: number(row.follower_count),
    is_following: row.is_following === true,
    is_owner: row.is_owner === true,
    total_events: number(row.total_events),
    returning_attendees: number(row.returning_attendees),
    upcoming_events: Array.isArray(row.upcoming_events) ? row.upcoming_events.map(event).filter((item): item is SeriesEvent => item !== null) : [],
    past_events: Array.isArray(row.past_events) ? row.past_events.map(event).filter((item): item is SeriesEvent => item !== null) : [],
  };
}

export async function getEventSeriesProfile(supabase: SupabaseClient, seriesId: string) {
  const { data, error } = await supabase.rpc("get_event_series_profile", { p_series_id: seriesId });
  if (error) throw error;
  return normalizeEventSeriesProfile(data);
}

export async function getHostEventSeries(supabase: SupabaseClient, hostUserId: string) {
  const { data, error } = await supabase.rpc("get_host_event_series", { p_host_user_id: hostUserId });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeEventSeriesSummary).filter((item): item is EventSeriesSummary => item !== null);
}

export async function getMyEventSeries(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("get_my_event_series");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeEventSeriesSummary).filter((item): item is EventSeriesSummary => item !== null);
}

export function formatSeriesDate(value: string | null) {
  if (!value) return "Date to be announced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be announced";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
