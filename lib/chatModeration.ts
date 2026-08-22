import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatModerationPreset = "relaxed" | "social" | "host_only";
export type ChatLinksMode = "everyone" | "hosts_only";

export type RoomModerationSettings = {
  room_id: string;
  preset: ChatModerationPreset;
  slow_mode_seconds: number;
  links_mode: ChatLinksMode;
  duplicate_filter_enabled: boolean;
  chat_mode: "everyone" | "host_only";
  updated_at: string | null;
};

export async function getRoomModerationSettings(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_room_moderation_settings", {
    p_room_id: roomId,
  });

  if (error) throw new Error(error.message);
  return data as RoomModerationSettings;
}

export async function setRoomModerationSettings(
  supabase: SupabaseClient,
  roomId: string,
  preset: ChatModerationPreset,
  linksMode: ChatLinksMode,
) {
  const { data, error } = await supabase.rpc("set_room_moderation_settings", {
    p_room_id: roomId,
    p_preset: preset,
    p_links_mode: linksMode,
  });

  if (error) throw new Error(error.message);
  return data as RoomModerationSettings;
}

const friendlyChatErrors = [
  "Slow mode is on.",
  "You are muted in this room until",
  "Chat is currently limited to hosts and bouncers.",
  "Links are currently limited to hosts and bouncers.",
  "That looks like a repeated message.",
  "This event has ended. Chat is now read-only.",
];

export function friendlyChatError(message: string | undefined) {
  const cleanMessage = message?.trim() || "";
  const knownMessage = friendlyChatErrors.find((prefix) => cleanMessage.includes(prefix));

  if (knownMessage) {
    const start = cleanMessage.indexOf(knownMessage);
    return cleanMessage.slice(start);
  }

  return "That message could not be sent. Please try again.";
}
