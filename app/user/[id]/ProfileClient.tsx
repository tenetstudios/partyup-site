"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import {
  getProfileSocialState,
  removePartyUpConnection,
  type ProfileSocialState,
} from "@/lib/connections";
import {
  formatHostEventDate,
  getHostDisplayName,
  getHostReputationProfile,
  type HostEvent,
  type HostReputationProfile,
} from "@/lib/hostProfile";
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
import { EventSeriesSummary, formatSeriesDate, getHostEventSeries } from "@/lib/eventSeries";

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  is_verified_host: boolean;
};

const emptyState: ProfileSocialState = {
  followers: 0,
  following: 0,
  is_following: false,
  connected: false,
  connection_id: null,
};

function getProfileName(profile: Profile) {
  return getHostDisplayName(profile);
}

export default function ProfileClient({ profileId }: { profileId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hostData, setHostData] = useState<HostReputationProfile | null>(null);
  const [hostSeries, setHostSeries] = useState<EventSeriesSummary[]>([]);
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

      const loadedHostData = await getHostReputationProfile(supabase, profileId);
      const loadedSeries = await getHostEventSeries(supabase, profileId).catch(() => []);
      setHostData(loadedHostData);
      setHostSeries(loadedSeries);
      setProfile(loadedHostData?.profile ?? null);

      if (loadedHostData) {
        setState(loadedHostData.social);

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

      const nextHostData = await getHostReputationProfile(supabase, profile.id);
      setHostData(nextHostData);
      setState(nextHostData?.social ?? (await getProfileSocialState(supabase, profile.id)));
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

  const pageContent = (
    <>
      <HomeHeader />

      <div className="mx-auto w-full max-w-3xl px-5 py-8">
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
          <section className={isOwnProfile && activeSection === "memories" ? `${partyUpTheme.glassElevated} mt-6 p-6` : "mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6"}>
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
                {profile.location && (
                  <p className="mt-2 text-sm font-bold text-[#aaa4b8]">{profile.location}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {hostData?.summary.is_live_now && (
                    <span className="rounded-md border border-pink-300/25 bg-pink-500/15 px-3 py-1 text-sm font-black text-pink-100">
                      Live now
                    </span>
                  )}
                  {profile.is_verified_host && (
                    <span className="rounded-md border border-purple-300/25 bg-purple-400/10 px-3 py-1 text-sm font-black text-purple-100">
                      Verified host
                    </span>
                  )}
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

            {hostData && (
              <HostEvidenceSections data={hostData} />
            )}
            <HostSeriesSection series={hostSeries} isOwner={currentUserId === profile.id} />

            {isOwnProfile && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection("profile");
                    setSelectedGroupId(null);
                  }}
                  className={`${partyUpTheme.tabBase} px-4 py-2 text-sm ${
                    activeSection === "profile"
                      ? partyUpTheme.tabActive
                      : partyUpTheme.tabInactive
                  }`}
                >
                  Connections
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("memories")}
                  className={`${partyUpTheme.tabBase} px-4 py-2 text-sm ${
                    activeSection === "memories"
                      ? partyUpTheme.tabActive
                      : partyUpTheme.tabInactive
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
    </>
  );

  if (isOwnProfile && activeSection === "memories") {
    return <PartyUpPageShell intensity="standard">{pageContent}</PartyUpPageShell>;
  }

  return <main className="min-h-screen bg-[#05040b] text-white">{pageContent}</main>;
}

function HostSeriesSection({ series, isOwner }: { series: EventSeriesSummary[]; isOwner: boolean }) {
  if (series.length === 0 && !isOwner) return null;
  return <section className="mt-6 border-t border-white/10 pt-6">
    <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-black uppercase text-[#ff63a8]">Event Series</p><h2 className="mt-1 text-2xl font-black">Recurring events</h2></div>{isOwner && <Link href="/series/new" className="rounded-md bg-[#8b3dff] px-4 py-2.5 text-sm font-black">Create Series</Link>}</div>
    {series.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-white/15 p-5 text-sm text-[#aaa4b8]">Create a series to keep your audience and event history together.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{series.map((item) => <Link key={item.id} href={`/series/${item.id}`} className="flex min-h-28 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] hover:border-[#8b5dc2]">{item.cover_image_url ? <img src={item.cover_image_url} alt="" className="w-28 object-cover" /> : <div className="grid w-28 place-items-center bg-[#23152f] font-black text-[#d8b4fe]">SERIES</div>}<div className="min-w-0 flex-1 p-4"><h3 className="truncate font-black">{item.name}</h3><p className="mt-2 text-xs font-bold text-[#aaa4b8]">{item.event_count} events / {item.follower_count} followers</p><p className="mt-3 text-xs font-bold text-[#c9a6ff]">{item.next_event_at ? `Next: ${formatSeriesDate(item.next_event_at)}` : "Next date coming soon"}</p></div></Link>)}</div>}
  </section>;
}

function HostEvidenceSections({ data }: { data: HostReputationProfile }) {
  const summaryItems = [
    [data.summary.events_hosted, "Events hosted"],
    [data.summary.people_attended, "People attended"],
    [data.summary.connections_created, "Connections started"],
    [data.summary.memories_created, "Memories posted"],
  ] as const;

  return (
    <section className="mt-8 border-t border-white/10 pt-8">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff63a8]">Host reputation</p>
        <h2 className="mt-2 text-2xl font-black">What they have made happen</h2>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-4">
        {summaryItems.map(([value, label]) => (
          <div key={label} className="bg-black/35 p-4">
            <p className="text-2xl font-black text-[#d8b4fe]">{value}</p>
            <p className="mt-1 text-xs font-black uppercase tracking-[0.1em] text-[#aaa4b8]">{label}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm font-bold leading-6 text-[#aaa4b8]">
        {data.summary.connections_created} Connections started at their events.
      </p>

      <HostEventList
        title="Upcoming events"
        emptyTitle="Nothing announced yet."
        emptyCopy="Follow this host to catch what they put together next."
        events={data.upcoming_events}
      />

      <HostEventList
        title="Past events"
        emptyTitle="New host energy."
        emptyCopy="No completed PartyUp events are visible for this host yet."
        events={data.past_events}
      />
    </section>
  );
}

function HostEventList({
  title,
  emptyTitle,
  emptyCopy,
  events,
}: {
  title: string;
  emptyTitle: string;
  emptyCopy: string;
  events: HostEvent[];
}) {
  return (
    <section className="mt-8">
      <h3 className="text-xl font-black">{title}</h3>
      {events.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-purple-300/20 bg-black/20 p-5">
          <p className="font-black">{emptyTitle}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#aaa4b8]">{emptyCopy}</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/room/${event.id}`}
              className="group overflow-hidden rounded-lg border border-white/10 bg-black/20 hover:border-purple-300/35"
            >
              <div className="flex gap-4 p-4">
                {event.cover_image_url ? (
                  <img src={event.cover_image_url} alt="" className="h-20 w-20 rounded-md object-cover" />
                ) : (
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-[#20112f] text-lg font-black text-[#d8b4fe]">
                    PU
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-lg font-black group-hover:text-[#f0d7ff]">{event.title}</h4>
                    {event.status && (
                      <span className="rounded bg-white/10 px-2 py-1 text-[11px] font-black uppercase text-[#c9c2d7]">
                        {event.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-bold text-[#aaa4b8]">
                    {formatHostEventDate(event.event_date)}
                    {event.venue_name ? ` / ${event.venue_name}` : ""}
                  </p>
                  <p className="mt-3 text-xs font-black uppercase tracking-[0.1em] text-[#817b8b]">
                    {event.people_count} people / {event.memory_count} Memories / {event.connection_count} Connections
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
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
      <section className={`${partyUpTheme.emptyState} mt-6 p-8`}>
        <h2 className="text-xl font-black">No saved memories yet.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
          Save photos and clips from event rooms and they&apos;ll appear here.
        </p>
        <Link
          href="/live-now"
          className={`${partyUpTheme.primaryButton} mt-6 px-5 text-sm`}
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
            className={`${partyUpTheme.ghostButton} h-10 px-4 text-sm`}
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
            className={`${partyUpTheme.glassInteractive} p-4 text-left`}
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
    <article className={`${partyUpTheme.glassCard} overflow-hidden`}>
      <button
        type="button"
        onClick={() => onSelect(memory)}
        className="block aspect-square w-full overflow-hidden bg-[#070712]"
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
          className={`${partyUpTheme.ghostButton} mt-3 min-h-9 w-full text-xs`}
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
      <div className={`${partyUpTheme.glassElevated} w-full max-w-4xl overflow-hidden`}>
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
            className={`${partyUpTheme.ghostButton} grid h-10 w-10 place-items-center text-xl`}
            aria-label="Close Memory"
          >
            x
          </button>
        </div>

        <div className="grid max-h-[70vh] place-items-center bg-[#060610]">
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
            className={`${partyUpTheme.destructiveButton} px-4 py-2 text-sm`}
          >
            Unsave
          </button>
        </div>
      </div>
    </div>
  );
}
