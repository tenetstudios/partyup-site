import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export type RoomAnnouncement = {
  id: string;
  room_id: string;
  created_by: string | null;
  title: string;
  message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type RoomAnnouncementInput = {
  title: string;
  message?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  expiresAt?: string;
  notifyAttendees?: boolean;
};

export function normalizeAnnouncementInput(input: RoomAnnouncementInput) {
  const title = input.title.trim();
  const message = input.message?.trim() || null;
  let ctaLabel = input.ctaLabel?.trim() || null;
  let ctaUrl = input.ctaUrl?.trim() || null;
  const expiresAt = input.expiresAt?.trim() || null;

  if (!title) {
    throw new Error("Title is required.");
  }

  if (title.length > 120) {
    throw new Error("Title must be 120 characters or fewer.");
  }

  if (message && message.length > 500) {
    throw new Error("Message must be 500 characters or fewer.");
  }

  if (ctaLabel && ctaLabel.length > 40) {
    throw new Error("CTA label must be 40 characters or fewer.");
  }

  if (ctaUrl && ctaUrl.length > 500) {
    throw new Error("CTA URL must be 500 characters or fewer.");
  }

  if (ctaUrl && !isSafeAnnouncementUrl(ctaUrl)) {
    throw new Error("CTA URL must start with http://, https://, or /.");
  }

  if (!ctaLabel || !ctaUrl) {
    ctaLabel = null;
    ctaUrl = null;
  }

  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);

    if (Number.isNaN(expiresAtMs)) {
      throw new Error("Expiration must be a valid date.");
    }

    if (expiresAtMs <= Date.now()) {
      throw new Error("Expiration must be in the future.");
    }
  }

  return {
    title,
    message,
    ctaLabel,
    ctaUrl,
    expiresAt,
  };
}

export function isSafeAnnouncementUrl(value: string) {
  return value.startsWith("/") || value.startsWith("https://") || value.startsWith("http://");
}

export function isAnnouncementCurrentlyActive(announcement: RoomAnnouncement | null) {
  if (!announcement?.is_active) {
    return false;
  }

  if (!announcement.expires_at) {
    return true;
  }

  return Date.parse(announcement.expires_at) > Date.now();
}

function firstAnnouncement(value: unknown): RoomAnnouncement | null {
  if (Array.isArray(value)) {
    return (value[0] as RoomAnnouncement | undefined) ?? null;
  }

  return (value as RoomAnnouncement | null) ?? null;
}

export async function getActiveRoomAnnouncement(
  supabase: SupabaseClient,
  roomId: string,
): Promise<RoomAnnouncement | null> {
  const { data, error } = await supabase.rpc("get_active_room_announcement", {
    p_room_id: roomId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstAnnouncement(data);
}

export async function publishRoomAnnouncement(
  supabase: SupabaseClient,
  roomId: string,
  input: RoomAnnouncementInput,
) {
  const normalized = normalizeAnnouncementInput(input);
  const { data, error } = await supabase.rpc("publish_room_announcement_with_push", {
    p_room_id: roomId,
    p_title: normalized.title,
    p_message: normalized.message,
    p_cta_label: normalized.ctaLabel,
    p_cta_url: normalized.ctaUrl,
    p_expires_at: normalized.expiresAt,
    p_notify_attendees: input.notifyAttendees ?? false,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (input.notifyAttendees) requestPushDispatch(supabase, roomId);

  return firstAnnouncement(data);
}

export async function updateRoomAnnouncement(
  supabase: SupabaseClient,
  announcementId: string,
  input: RoomAnnouncementInput,
) {
  const normalized = normalizeAnnouncementInput(input);
  const { data, error } = await supabase.rpc("update_room_announcement", {
    p_announcement_id: announcementId,
    p_title: normalized.title,
    p_message: normalized.message,
    p_cta_label: normalized.ctaLabel,
    p_cta_url: normalized.ctaUrl,
    p_expires_at: normalized.expiresAt,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstAnnouncement(data);
}

export async function endRoomAnnouncement(supabase: SupabaseClient, announcementId: string) {
  const { data, error } = await supabase.rpc("end_room_announcement", {
    p_announcement_id: announcementId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return firstAnnouncement(data);
}
