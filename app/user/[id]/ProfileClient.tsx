"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import {
  getProfileSocialState,
  removePartyUpConnection,
  type ProfileSocialState,
} from "@/lib/connections";
import {
  formatMemoryDate,
  formatMemoryTimestamp,
  getMemoryPublicUrl,
  getMySavedMemoryGroups,
  unsaveRoomMemory,
  type SavedMemory,
  type SavedMemoryGroup,
} from "@/lib/memories";
import { createSupabaseClient } from "@/lib/supabase";

type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

const emptyState: ProfileSocialState = {
  followers: 0,
  following: 0,
  is_following: false,
  connected: false,
  connection_id: null,
};

function getProfileName(profile: Profile) {
  return profile.username?.trim() || `Guest ${profile.id.slice(0, 4)}`;
}

export default function ProfileClient({ profileId }: { profileId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [state, setState] = useState<ProfileSocialState>(emptyState);
  const [memoryGroups, setMemoryGroups] = useState<SavedMemoryGroup[]>([]);
  const [activeSection, setActiveSection] = useState<"profile" | "memories">("profile");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<SavedMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processingMemoryId, setProcessingMemoryId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;
      setCurrentUserId(userId);

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio")
        .eq("id", profileId)
        .maybeSingle<Profile>();

      if (error) {
        throw new Error(error.message);
      }

      setProfile(data);

      if (data) {
        setState(await getProfileSocialState(supabase, profileId));

        if (userId === profileId) {
          setMemoryGroups(await getMySavedMemoryGroups(supabase));
        } else {
          setMemoryGroups([]);
          setActiveSection("profile");
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  }, [profileId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProfile();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadProfile]);

  async function toggleFollow() {
    if (!profile || !currentUserId || currentUserId === profile.id || processing) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      if (state.is_following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profile.id);

        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: currentUserId,
          following_id: profile.id,
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      setState(await getProfileSocialState(supabase, profile.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Follow.");
    } finally {
      setProcessing(false);
    }
  }

  async function removeConnection() {
    if (!state.connection_id || processing) {
      return;
    }

    const confirmed = window.confirm("Remove this PartyUp Connection? Following will not change.");

    if (!confirmed) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      await removePartyUpConnection(supabase, state.connection_id);
      setState((current) => ({
        ...current,
        connected: false,
        connection_id: null,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this Connection.");
    } finally {
      setProcessing(false);
    }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/user/${profileId}`,
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setCurrentUserId(null);
    window.location.href = "/";
  }

  async function removeSavedMemory(memory: SavedMemory) {
    if (processingMemoryId) {
      return;
    }

    setProcessingMemoryId(memory.id);
    setMessage(null);

    try {
      await unsaveRoomMemory(supabase, memory.id);
      setMemoryGroups((current) =>
        current
          .map((group) => ({
            ...group,
            memories: group.memories.filter((item) => item.id !== memory.id),
            memory_count: group.memories.filter((item) => item.id !== memory.id).length,
          }))
          .filter((group) => group.memories.length > 0),
      );
      setSelectedMemory(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unsave this Memory.");
    } finally {
      setProcessingMemoryId(null);
    }
  }

  const isOwnProfile = currentUserId === profile?.id;
  const selectedGroup = selectedGroupId
    ? memoryGroups.find((group) => group.room_id === selectedGroupId) ?? null
    : null;

  return (
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader />

      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <Link href="/connections" className="text-sm font-black text-[#c35dff] hover:text-white">
          Back to Connections
        </Link>

        {message && (
          <div className="mt-6 rounded-md border border-amber-300/20 bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-100">
            {message}
          </div>
        )}

        {loading ? (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Loading...
          </section>
        ) : profile ? (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-24 w-24 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full bg-[#8b3dff] text-3xl font-black">
                  {getProfileName(profile).slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h1 className="truncate text-4xl font-black tracking-normal">
                  {getProfileName(profile)}
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state.connected && (
                    <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-sm font-black text-emerald-100">
                      Connected
                    </span>
                  )}
                  {state.is_following && (
                    <span className="rounded-md border border-purple-300/25 bg-purple-400/10 px-3 py-1 text-sm font-black text-purple-100">
                      Following
                    </span>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-6 text-sm leading-6 text-[#c9c2d7]">
              {profile.bio?.trim() || "This user has no bio yet."}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-2xl font-black">{state.followers}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[#aaa4b8]">
                  Followers
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-2xl font-black">{state.following}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[#aaa4b8]">
                  Following
                </p>
              </div>
            </div>

            {isOwnProfile && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection("profile");
                    setSelectedGroupId(null);
                  }}
                  className={`rounded-md border px-4 py-2 text-sm font-black ${
                    activeSection === "profile"
                      ? "border-[#c35dff] bg-[#c35dff]/18 text-white"
                      : "border-white/10 bg-white/[0.04] text-[#aaa4b8] hover:text-white"
                  }`}
                >
                  Connections
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("memories")}
                  className={`rounded-md border px-4 py-2 text-sm font-black ${
                    activeSection === "memories"
                      ? "border-[#c35dff] bg-[#c35dff]/18 text-white"
                      : "border-white/10 bg-white/[0.04] text-[#aaa4b8] hover:text-white"
                  }`}
                >
                  Memories
                </button>
              </div>
            )}

            {isOwnProfile ? (
              activeSection === "memories" ? (
                <ProfileMemories
                  groups={memoryGroups}
                  selectedGroup={selectedGroup}
                  selectedMemory={selectedMemory}
                  processingMemoryId={processingMemoryId}
                  onSelectGroup={setSelectedGroupId}
                  onBackToGroups={() => setSelectedGroupId(null)}
                  onSelectMemory={setSelectedMemory}
                  onCloseMemory={() => setSelectedMemory(null)}
                  onUnsave={(memory) => void removeSavedMemory(memory)}
                  supabase={supabase}
                />
              ) : (
                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-bold text-[#aaa4b8]">This is your public profile.</p>
                  <button
                    type="button"
                    onClick={signOut}
                    className="inline-flex h-11 items-center justify-center rounded-md border border-white/10 px-5 text-sm font-black text-white hover:bg-white/10"
                  >
                    Sign out
                  </button>
                </div>
              )
            ) : currentUserId ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={processing}
                  className="rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state.is_following ? "Unfollow" : "Follow"}
                </button>
                {state.connected && (
                  <button
                    type="button"
                    onClick={removeConnection}
                    disabled={processing}
                    className="rounded-md border border-red-400/30 px-5 py-3 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove Connection
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="mt-6 rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]"
              >
                Sign in to Follow
              </button>
            )}
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Profile not found.
          </section>
        )}
      </div>
    </main>
  );
}

function ProfileMemories({
  groups,
  selectedGroup,
  selectedMemory,
  processingMemoryId,
  onSelectGroup,
  onBackToGroups,
  onSelectMemory,
  onCloseMemory,
  onUnsave,
  supabase,
}: {
  groups: SavedMemoryGroup[];
  selectedGroup: SavedMemoryGroup | null;
  selectedMemory: SavedMemory | null;
  processingMemoryId: string | null;
  onSelectGroup: (roomId: string) => void;
  onBackToGroups: () => void;
  onSelectMemory: (memory: SavedMemory) => void;
  onCloseMemory: () => void;
  onUnsave: (memory: SavedMemory) => void;
  supabase: ReturnType<typeof createSupabaseClient>;
}) {
  if (groups.length === 0) {
    return (
      <section className="mt-6 rounded-lg border border-dashed border-purple-300/20 bg-black/20 p-8 text-center">
        <h2 className="text-xl font-black">No saved memories yet.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
          Save photos and clips from event rooms and they&apos;ll appear here.
        </p>
        <Link
          href="/live-now"
          className="mt-6 inline-flex h-11 items-center rounded-md bg-pink-500 px-5 text-sm font-black text-white hover:bg-pink-600"
        >
          Explore Rooms
        </Link>
      </section>
    );
  }

  if (selectedGroup) {
    return (
      <section className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              type="button"
              onClick={onBackToGroups}
              className="text-sm font-black text-[#c35dff] hover:text-white"
            >
              Back to Memories
            </button>
            <h2 className="mt-2 text-2xl font-black">{selectedGroup.room_title}</h2>
            <p className="mt-1 text-sm font-bold text-[#aaa4b8]">
              {formatMemoryDate(selectedGroup.room_date)}
            </p>
          </div>
          <Link
            href={`/room/${selectedGroup.room_id}/memories`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 px-4 text-sm font-black text-white hover:bg-white/10"
          >
            Open Room Memories
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {selectedGroup.memories.map((memory) => (
            <SavedMemoryTile
              key={memory.id}
              memory={memory}
              processing={processingMemoryId === memory.id}
              onSelect={onSelectMemory}
              onUnsave={onUnsave}
              supabase={supabase}
            />
          ))}
        </div>

        <SavedMemoryModal
          memory={selectedMemory}
          processing={selectedMemory ? processingMemoryId === selectedMemory.id : false}
          onClose={onCloseMemory}
          onUnsave={onUnsave}
          supabase={supabase}
        />
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h2 className="text-2xl font-black">My Memories</h2>
      <div className="mt-5 grid gap-4">
        {groups.map((group) => (
          <button
            key={group.room_id}
            type="button"
            onClick={() => onSelectGroup(group.room_id)}
            className="rounded-lg border border-white/10 bg-black/20 p-4 text-left hover:border-[#c35dff]/50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-xl font-black">{group.room_title}</h3>
                <p className="mt-1 text-sm font-bold text-[#aaa4b8]">
                  {formatMemoryDate(group.room_date)}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-[#c35dff]/18 px-3 py-1 text-sm font-black text-white">
                {group.memory_count}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {group.memories.slice(0, 6).map((memory) => {
                const url = getMemoryPublicUrl(supabase, memory.thumbnail_path || memory.media_path);

                return memory.media_type === "image" ? (
                  <img
                    key={memory.id}
                    src={url}
                    alt=""
                    className="aspect-square w-full rounded-md object-cover"
                  />
                ) : (
                  <div key={memory.id} className="grid aspect-square place-items-center rounded-md bg-[#171322] text-lg">
                    Play
                  </div>
                );
              })}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function SavedMemoryTile({
  memory,
  processing,
  onSelect,
  onUnsave,
  supabase,
}: {
  memory: SavedMemory;
  processing: boolean;
  onSelect: (memory: SavedMemory) => void;
  onUnsave: (memory: SavedMemory) => void;
  supabase: ReturnType<typeof createSupabaseClient>;
}) {
  const url = getMemoryPublicUrl(supabase, memory.thumbnail_path || memory.media_path);

  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-black/25">
      <button
        type="button"
        onClick={() => onSelect(memory)}
        className="block aspect-square w-full overflow-hidden bg-black"
        aria-label="Open saved Memory"
      >
        {memory.media_type === "image" ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center bg-[#171322] text-sm font-black">Play</div>
        )}
      </button>
      <div className="p-3">
        <p className="truncate text-xs font-bold text-[#aaa4b8]">
          {formatMemoryTimestamp(memory.created_at)}
        </p>
        <button
          type="button"
          disabled={processing}
          onClick={() => onUnsave(memory)}
          className="mt-3 min-h-9 w-full rounded-md border border-white/10 text-xs font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Unsave
        </button>
      </div>
    </article>
  );
}

function SavedMemoryModal({
  memory,
  processing,
  onClose,
  onUnsave,
  supabase,
}: {
  memory: SavedMemory | null;
  processing: boolean;
  onClose: () => void;
  onUnsave: (memory: SavedMemory) => void;
  supabase: ReturnType<typeof createSupabaseClient>;
}) {
  if (!memory) {
    return null;
  }

  const publicUrl = getMemoryPublicUrl(supabase, memory.media_path);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#10101a]">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black">{memory.room_title}</h3>
            <p className="mt-1 text-xs font-bold text-[#aaa4b8]">
              {memory.uploader_name || "Guest"} / {formatMemoryTimestamp(memory.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-md border border-white/10 text-xl font-black hover:bg-white/10"
            aria-label="Close Memory"
          >
            x
          </button>
        </div>

        <div className="grid max-h-[70vh] place-items-center bg-black">
          {memory.media_type === "image" ? (
            <img src={publicUrl} alt="" className="max-h-[70vh] w-full object-contain" />
          ) : (
            <video src={publicUrl} className="max-h-[70vh] w-full" controls />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm font-bold text-[#aaa4b8]">
            Saved from {memory.room_title}
          </p>
          <button
            type="button"
            disabled={processing}
            onClick={() => onUnsave(memory)}
            className="rounded-md border border-red-400/30 px-4 py-2 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Unsave
          </button>
        </div>
      </div>
    </div>
  );
}
