"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import {
  formatMemoryTimestamp,
  getMemoryPublicUrl,
  getRoomMemories,
  saveRoomMemory,
  unsaveRoomMemory,
  type MemoryMediaType,
  type RoomMemory,
} from "@/lib/memories";
import { ensurePartyUpIdentity } from "@/lib/matchmaking";
import { createSupabaseClient } from "@/lib/supabase";

type Room = {
  id: string;
  title: string | null;
  host_id: string | null;
};

type SelectedMemory = RoomMemory & {
  publicUrl: string;
};

const imageSizeLimit = 12 * 1024 * 1024;
const videoSizeLimit = 50 * 1024 * 1024;

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getMediaType(file: File): MemoryMediaType | null {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  return null;
}

function cleanFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M7 4.75A2.25 2.25 0 0 1 9.25 2.5h5.5A2.25 2.25 0 0 1 17 4.75v16l-5-3.1-5 3.1v-16Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function RoomMemoriesClient({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [room, setRoom] = useState<Room | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentIdentityId, setCurrentIdentityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<SelectedMemory | null>(null);

  const loadMemories = useCallback(async () => {
    setMemories(await getRoomMemories(supabase, roomId));
  }, [roomId, supabase]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setCurrentUserId(user?.id ?? null);

      const { data: roomData, error: roomError } = await supabase
        .from("event_rooms")
        .select("id, title, host_id")
        .eq("id", roomId)
        .maybeSingle<Room>();

      if (roomError) {
        throw new Error(roomError.message);
      }

      setRoom(roomData);

      if (user) {
        const identity = await ensurePartyUpIdentity(supabase);
        setCurrentIdentityId(identity.id);
        await loadMemories();
      } else {
        setCurrentIdentityId(null);
        setMemories([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Memories.");
    } finally {
      setLoading(false);
    }
  }, [loadMemories, roomId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadAll]);

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/room/${roomId}/memories`,
      },
    });
  }

  async function uploadMemory(file: File | null) {
    if (!file || uploading) {
      return;
    }

    setMessage(null);

    if (!currentIdentityId) {
      setMessage("Sign in and join the room to add Memories.");
      return;
    }

    const mediaType = getMediaType(file);

    if (!mediaType) {
      setMessage("Choose a photo or video file.");
      return;
    }

    const limit = mediaType === "image" ? imageSizeLimit : videoSizeLimit;

    if (file.size > limit) {
      setMessage(mediaType === "image" ? "Photos must be 12 MB or smaller." : "Videos must be 50 MB or smaller.");
      return;
    }

    setUploading(true);

    const filePath = `${roomId}/${currentIdentityId}/${Date.now()}-${cleanFileName(file.name)}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("room-memories")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: insertError } = await supabase.from("room_memories").insert({
        room_id: roomId,
        uploader_identity_id: currentIdentityId,
        media_type: mediaType,
        media_path: filePath,
      });

      if (insertError) {
        await supabase.storage.from("room-memories").remove([filePath]);
        throw new Error(insertError.message);
      }

      await loadMemories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload this Memory.");
    } finally {
      setUploading(false);
    }
  }

  async function toggleSaved(memory: RoomMemory) {
    if (processingId) {
      return;
    }

    if (!currentUserId) {
      setMessage("Sign in to save Memories.");
      return;
    }

    setProcessingId(memory.id);
    setMessage(null);
    const nextSaved = !memory.is_saved;
    setMemories((current) =>
      current.map((item) => (item.id === memory.id ? { ...item, is_saved: nextSaved } : item)),
    );

    try {
      if (nextSaved) {
        await saveRoomMemory(supabase, memory.id);
      } else {
        await unsaveRoomMemory(supabase, memory.id);
      }
    } catch (error) {
      setMemories((current) =>
        current.map((item) => (item.id === memory.id ? { ...item, is_saved: !nextSaved } : item)),
      );
      setMessage(error instanceof Error ? error.message : "Could not update saved Memory.");
    } finally {
      setProcessingId(null);
    }
  }

  async function deleteMemory(memory: RoomMemory) {
    const confirmed = window.confirm("Delete this Memory from the room?");

    if (!confirmed) {
      return;
    }

    setProcessingId(memory.id);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("delete_room_memory", {
        p_memory_id: memory.id,
      });

      if (error) {
        throw new Error(error.message);
      }

      setMemories((current) => current.filter((item) => item.id !== memory.id));
      await supabase.storage.from("room-memories").remove([memory.media_path]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete this Memory.");
    } finally {
      setProcessingId(null);
    }
  }

  const isHost = Boolean(room?.host_id && currentUserId === room.host_id);

  return (
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader />

      <div className="mx-auto w-full max-w-6xl px-5 py-8">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href={`/room/${roomId}`} className="text-sm font-black text-[#c35dff] hover:text-white">
              Back to Room
            </Link>
            <h1 className="mt-3 text-4xl font-black tracking-normal md:text-5xl">
              Memories
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-[#aaa4b8]">
              {room?.title || "Photos and clips from this room."}
            </p>
          </div>

          <label className={`inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-pink-500 px-5 text-sm font-black text-white hover:bg-pink-600 ${!currentIdentityId || uploading ? "pointer-events-none opacity-55" : ""}`}>
            {uploading ? "Uploading..." : "Add Memory"}
            <input
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm"
              className="sr-only"
              disabled={!currentIdentityId || uploading}
              onChange={(event) => {
                void uploadMemory(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {message && (
          <div className="mt-6 rounded-md border border-amber-300/20 bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-100">
            {message}
          </div>
        )}

        {!currentUserId && !loading ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-[#10101a] p-6">
            <h2 className="text-xl font-black">Sign in to see room Memories.</h2>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-5 rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]"
            >
              Sign in
            </button>
          </section>
        ) : loading ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Loading...
          </section>
        ) : memories.length === 0 ? (
          <section className="mt-8 rounded-lg border border-dashed border-purple-300/20 bg-black/20 p-8 text-center">
            <h2 className="text-xl font-black">No memories yet.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
              Add a photo or clip from this room and it will appear here.
            </p>
          </section>
        ) : (
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {memories.map((memory) => {
              const publicUrl = getMemoryPublicUrl(supabase, memory.media_path);
              const uploaderName = memory.uploader_name || "Guest";
              const canDelete = isHost || memory.uploader_identity_id === currentIdentityId;

              return (
                <article key={memory.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#10101a]">
                  <button
                    type="button"
                    onClick={() => setSelectedMemory({ ...memory, publicUrl })}
                    className="relative block aspect-square w-full overflow-hidden bg-black text-left"
                    aria-label="Open Memory"
                  >
                    {memory.media_type === "image" ? (
                      <img src={publicUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center bg-[#171322] text-white">
                        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/12 text-sm font-black">Play</span>
                      </div>
                    )}
                  </button>

                  <div className="p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {memory.uploader_avatar_url ? (
                        <img src={memory.uploader_avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#8b3dff] text-xs font-black">
                          {getInitials(uploaderName)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black">{uploaderName}</p>
                        <p className="mt-1 truncate text-xs font-bold text-[#aaa4b8]">
                          {formatMemoryTimestamp(memory.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={processingId === memory.id}
                        onClick={() => void toggleSaved(memory)}
                        className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-black ${
                          memory.is_saved
                            ? "border-[#c35dff] bg-[#c35dff]/18 text-white"
                            : "border-white/10 bg-white/[0.04] text-[#d6d1df] hover:text-white"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <BookmarkIcon filled={memory.is_saved} />
                        {memory.is_saved ? "Saved" : "Save"}
                      </button>

                      {canDelete && (
                        <button
                          type="button"
                          disabled={processingId === memory.id}
                          onClick={() => void deleteMemory(memory)}
                          className="min-h-10 rounded-md border border-red-400/30 px-3 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {selectedMemory && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 px-4 py-8" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#10101a]">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-[#d4b6ff]">
                  {selectedMemory.uploader_name || "Guest"}
                </p>
                <p className="mt-1 text-xs font-bold text-[#aaa4b8]">
                  {formatMemoryTimestamp(selectedMemory.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMemory(null)}
                className="grid h-10 w-10 place-items-center rounded-md border border-white/10 text-xl font-black hover:bg-white/10"
                aria-label="Close Memory"
              >
                x
              </button>
            </div>

            <div className="grid max-h-[76vh] place-items-center bg-black">
              {selectedMemory.media_type === "image" ? (
                <img src={selectedMemory.publicUrl} alt="" className="max-h-[76vh] w-full object-contain" />
              ) : (
                <video src={selectedMemory.publicUrl} className="max-h-[76vh] w-full" controls />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
