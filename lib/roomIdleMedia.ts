import type { SupabaseClient } from "@supabase/supabase-js";

export type RoomIdleMedia = {
  room_id: string;
  media_path: string;
  media_type: "video" | "gif";
  mime_type: "video/mp4" | "image/gif";
  file_size_bytes: number;
  enabled: boolean;
  updated_at: string;
  signed_url: string;
};

export async function getRoomIdleMedia(
  supabase: SupabaseClient,
  roomId: string,
): Promise<RoomIdleMedia | null> {
  const { data, error } = await supabase
    .from("room_idle_media")
    .select("room_id,media_path,media_type,mime_type,file_size_bytes,enabled,updated_at")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: signed, error: signedError } = await supabase.storage
    .from("room-idle-media")
    .createSignedUrl(data.media_path, 60 * 60);

  if (signedError) throw new Error(signedError.message);

  return {
    ...data,
    media_type: data.media_type as RoomIdleMedia["media_type"],
    mime_type: data.mime_type as RoomIdleMedia["mime_type"],
    signed_url: signed.signedUrl,
  } as RoomIdleMedia;
}
