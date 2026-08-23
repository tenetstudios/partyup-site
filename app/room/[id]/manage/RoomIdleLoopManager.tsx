"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRoomIdleMedia, type RoomIdleMedia } from "@/lib/roomIdleMedia";
import { createSupabaseClient } from "@/lib/supabase";

const videoSizeLimit = 20 * 1024 * 1024;
const gifSizeLimit = 10 * 1024 * 1024;
const videoDurationLimitSeconds = 30;

async function readVideoDuration(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("Could not inspect this video."));
      video.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function RoomIdleLoopManager({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<RoomIdleMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    try {
      setMedia(await getRoomIdleMedia(supabase, roomId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Idle Loop.");
    }
  }, [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void loadMedia());

    const channel = supabase
      .channel(`idle-loop-manager-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_idle_media", filter: `room_id=eq.${roomId}` },
        () => void loadMedia(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMedia, roomId, supabase]);

  async function uploadMedia(file: File) {
    if (busy) return;

    const isGif = file.type === "image/gif";
    const isVideo = file.type === "video/mp4";
    if (!isGif && !isVideo) {
      setError("Choose an MP4/H.264 video or GIF.");
      return;
    }

    const sizeLimit = isGif ? gifSizeLimit : videoSizeLimit;
    if (file.size > sizeLimit) {
      setError(isGif ? "GIF files must be 10 MB or smaller." : "MP4 files must be 20 MB or smaller.");
      return;
    }

    if (isVideo) {
      try {
        const duration = await readVideoDuration(file);
        if (!Number.isFinite(duration) || duration > videoDurationLimitSeconds) {
          setError("Idle Loop videos must be 30 seconds or shorter.");
          return;
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not inspect this video.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    const mediaType = isGif ? "gif" : "video";
    const mediaPath = `${roomId}/idle-loop.${isGif ? "gif" : "mp4"}`;
    const previousPath = media?.media_path ?? null;
    const { error: uploadError } = await supabase.storage
      .from("room-idle-media")
      .upload(mediaPath, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { error: saveError } = await supabase.rpc("set_room_idle_media", {
      p_enabled: true,
      p_file_size_bytes: file.size,
      p_media_path: mediaPath,
      p_media_type: mediaType,
      p_mime_type: file.type,
      p_room_id: roomId,
    });

    if (saveError) {
      if (previousPath !== mediaPath) {
        await supabase.storage.from("room-idle-media").remove([mediaPath]);
      }
      setError(saveError.message);
      setBusy(false);
      return;
    }

    if (previousPath && previousPath !== mediaPath) {
      await supabase.storage.from("room-idle-media").remove([previousPath]);
    }

    await loadMedia();
    setStatus("Idle Loop saved and enabled.");
    setBusy(false);
  }

  async function toggleEnabled() {
    if (!media || busy) return;
    setBusy(true);
    setError(null);

    const { error: toggleError } = await supabase.rpc("set_room_idle_media_enabled", {
      p_enabled: !media.enabled,
      p_room_id: roomId,
    });

    if (toggleError) setError(toggleError.message);
    else await loadMedia();
    setBusy(false);
  }

  async function removeMedia() {
    if (!media || busy) return;
    if (!window.confirm("Remove this Idle Loop? The uploaded media will be permanently deleted.")) return;

    setBusy(true);
    setError(null);
    const mediaPath = media.media_path;
    const { error: configError } = await supabase.rpc("remove_room_idle_media", { p_room_id: roomId });

    if (configError) {
      setError(configError.message);
      setBusy(false);
      return;
    }

    const { error: removeError } = await supabase.storage.from("room-idle-media").remove([mediaPath]);
    if (removeError) setError(`Idle Loop was removed, but its file cleanup failed: ${removeError.message}`);
    setMedia(null);
    setStatus("Idle Loop removed.");
    setBusy(false);
  }

  return (
    <section id="idle-loop" className="mt-8 rounded-xl border border-purple-300/20 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-purple-300">Streaming</p>
        <h2 className="mt-1 text-lg font-black">Idle Loop</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Play a highlight reel or visual while nobody is live.
        </p>
      </div>

      <div className="space-y-4 p-4">
        {media && (
          <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
            {media.media_type === "video" ? (
              <video src={media.signed_url} autoPlay loop muted playsInline className="h-full w-full object-cover" />
            ) : (
              <Image src={media.signed_url} alt="Idle Loop preview" fill unoptimized className="object-cover" />
            )}
            <span className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-black text-white">
              HIGHLIGHTS
            </span>
          </div>
        )}

        <p className="text-xs leading-5 text-zinc-500">
          MP4/H.264 is recommended: up to 30 seconds and 20 MB. GIF is supported up to 10 MB.
          Idle media always starts muted.
        </p>

        {media && (
          <label className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 p-3">
            <span>
              <span className="block text-sm font-black text-white">Play when nobody is live</span>
              <span className="mt-1 block text-xs text-zinc-500">Real livestreams always take priority.</span>
            </span>
            <input type="checkbox" checked={media.enabled} onChange={() => void toggleEnabled()} disabled={busy} className="h-5 w-5 accent-purple-500" />
          </label>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadMedia(file);
            event.target.value = "";
          }}
        />

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8] disabled:opacity-50">
            {busy ? "Working..." : media ? "Replace" : "Upload Media"}
          </button>
          {media && (
            <button type="button" onClick={() => void removeMedia()} disabled={busy} className="rounded-md border border-red-400/35 px-4 py-2 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:opacity-50">
              Remove
            </button>
          )}
        </div>

        {error && <p role="alert" className="rounded-md border border-red-400/25 bg-red-500/10 p-3 text-sm font-bold text-red-100">{error}</p>}
        {status && <p role="status" className="rounded-md border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-100">{status}</p>}
      </div>
    </section>
  );
}
