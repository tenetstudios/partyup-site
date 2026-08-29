"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getRoomRecapMedia, type RoomRecapMedia } from "@/lib/recapMedia";
import { createSupabaseClient } from "@/lib/supabase";

const recapImageSizeLimit = 10 * 1024 * 1024;
const recapVideoSizeLimit = 20 * 1024 * 1024;

const recapMediaExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export default function AfterEventMessageManager({ roomId, roomEnded }: { roomId: string; roomEnded: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<RoomRecapMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("room_recap_messages").select("message").eq("room_id", roomId).maybeSingle(),
      getRoomRecapMedia(supabase, roomId).catch(() => null),
    ]).then(([messageResult, mediaResult]) => {
      setMessage(messageResult.data?.message || "");
      setMedia(mediaResult);
    });
  }, [roomId, supabase]);

  async function uploadMedia(file: File) {
    if (mediaBusy) return;

    const extension = recapMediaExtensions[file.type];
    const mediaType = file.type.startsWith("image/") ? "image" : "video";
    if (!extension || (mediaType !== "image" && mediaType !== "video")) {
      setStatus("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV file.");
      return;
    }

    const sizeLimit = mediaType === "image" ? recapImageSizeLimit : recapVideoSizeLimit;
    if (file.size > sizeLimit) {
      setStatus(mediaType === "image" ? "Images must be 10 MB or smaller." : "Videos must be 20 MB or smaller.");
      return;
    }

    setMediaBusy(true);
    setStatus(null);
    const mediaPath = `${roomId}/recap-media.${extension}`;
    const previousPath = media?.media_path ?? null;
    const { error: uploadError } = await supabase.storage
      .from("room-recap-media")
      .upload(mediaPath, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      setStatus(uploadError.message);
      setMediaBusy(false);
      return;
    }

    const { error: saveError } = await supabase.rpc("set_room_recap_media", {
      p_file_size_bytes: file.size,
      p_media_path: mediaPath,
      p_media_type: mediaType,
      p_mime_type: file.type,
      p_room_id: roomId,
    });

    if (saveError) {
      if (previousPath !== mediaPath) await supabase.storage.from("room-recap-media").remove([mediaPath]);
      setStatus(saveError.message);
      setMediaBusy(false);
      return;
    }

    if (previousPath && previousPath !== mediaPath) {
      await supabase.storage.from("room-recap-media").remove([previousPath]);
    }

    setMedia(await getRoomRecapMedia(supabase, roomId));
    setStatus("Recap media saved.");
    setMediaBusy(false);
  }

  async function removeMedia() {
    if (!media || mediaBusy) return;
    setMediaBusy(true);
    setStatus(null);
    const mediaPath = media.media_path;
    const { error } = await supabase.rpc("remove_room_recap_media", { p_room_id: roomId });

    if (error) {
      setStatus(error.message);
      setMediaBusy(false);
      return;
    }

    const { error: storageError } = await supabase.storage.from("room-recap-media").remove([mediaPath]);
    setMedia(null);
    setStatus(storageError ? `Media was removed from the recap, but file cleanup failed: ${storageError.message}` : "Recap media removed.");
    setMediaBusy(false);
  }

  async function save(successMessage = true) {
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_room_recap_message", { p_room_id: roomId, p_message: message });
    setSaving(false);
    if (error) {
      setStatus(error.message);
      return false;
    }
    if (successMessage) {
      setStatus(message.trim() ? "After-event message saved." : "After-event message removed.");
    }
    return true;
  }

  async function endEvent() {
    if (ending || saving || mediaBusy) return;

    const confirmed = window.confirm(
      "Save this after-event message and end the event? The room will become read-only while Memories, recaps, attendance, and Event Series history are kept.",
    );
    if (!confirmed) return;

    setEnding(true);
    const saved = await save(false);
    if (!saved) {
      setEnding(false);
      return;
    }

    await supabase.functions.invoke("delete-ingress", { body: { roomName: roomId } }).catch(() => undefined);
    const { error } = await supabase.functions.invoke("end-event-room", { body: { roomId } });
    if (error) {
      setStatus(error.message);
      setEnding(false);
      return;
    }

    router.push(`/room/${roomId}`);
    router.refresh();
  }

  return (
    <section id="event-closeout" className="mt-10 rounded-xl border border-purple-300/25 bg-purple-950/20 p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">Final step</p>
      <h2 className="mt-2 text-2xl font-black">Event closeout</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        Leave guests a note in their recap, then end the event when the room is finished.
      </p>

      <label className="mt-5 block text-sm font-black text-purple-200" htmlFor="after-event-message">
        After-event message <span className="font-semibold text-zinc-500">(optional)</span>
      </label>
      <textarea
        id="after-event-message"
        value={message}
        maxLength={500}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Thanks for coming. See you next time."
        className="mt-2 min-h-28 w-full resize-y rounded-lg border border-white/10 bg-black/30 p-4 text-sm font-semibold text-white outline-none focus:border-[#9146ff]"
      />
      <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-purple-200">Message media <span className="font-semibold text-zinc-500">(optional)</span></p>
            <p className="mt-1 text-xs font-semibold text-zinc-500">Add one image up to 10 MB or one video up to 20 MB.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadMedia(file);
                event.target.value = "";
              }}
            />
            <button type="button" disabled={mediaBusy || ending} onClick={() => mediaInputRef.current?.click()} className="rounded-md bg-[#9146ff] px-4 py-2 text-xs font-black hover:bg-[#7b31e8] disabled:opacity-50">
              {mediaBusy ? "Working..." : media ? "Replace media" : "Add media"}
            </button>
            {media && (
              <button type="button" disabled={mediaBusy || ending} onClick={() => void removeMedia()} className="rounded-md border border-red-400/35 px-4 py-2 text-xs font-black text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                Remove
              </button>
            )}
          </div>
        </div>
        {media && (
          <div className="mt-4 max-w-xl overflow-hidden rounded-lg border border-white/10 bg-black">
            {media.media_type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.signed_url} alt="Recap attachment preview" className="max-h-80 w-full object-contain" />
            ) : (
              <video src={media.signed_url} controls preload="metadata" className="max-h-80 w-full" />
            )}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <span className="text-xs font-bold text-zinc-500">{message.length}/500</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || ending || mediaBusy}
            onClick={() => void save()}
            className="rounded-full border border-purple-300/40 px-5 py-2.5 text-sm font-black text-purple-100 hover:bg-purple-400/10 disabled:opacity-60"
          >
            {saving && !ending ? "Saving..." : roomEnded ? "Save message" : "Save draft"}
          </button>
          {!roomEnded && (
            <button
              type="button"
              disabled={saving || ending || mediaBusy}
              onClick={() => void endEvent()}
              className="rounded-full bg-[#7c3aed] px-5 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_rgba(124,58,237,0.38)] hover:bg-[#9146ff] disabled:opacity-60"
            >
              {ending ? "Saving & ending..." : message.trim() ? "Save message & end event" : "End event"}
            </button>
          )}
        </div>
      </div>
      {roomEnded && <p className="mt-4 text-sm font-bold text-emerald-200">This event has ended. You can still update its recap message.</p>}
      {status && <p className="mt-3 text-sm font-bold text-[#c4b5fd]">{status}</p>}
    </section>
  );
}
