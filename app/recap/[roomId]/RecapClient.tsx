"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { formatMemoryTimestamp, getMemoryPublicUrl, getRoomMemories, saveRoomMemory, unsaveRoomMemory, type RoomMemory } from "@/lib/memories";
import { getEventRecap, getRecapConnectionName, selectRecapMemories, type EventRecap } from "@/lib/recaps";
import { createSupabaseClient } from "@/lib/supabase";

function initials(value: string) { return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export default function RecapClient({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [recap, setRecap] = useState<EventRecap | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextRecap = await getEventRecap(supabase, roomId);
      const allMemories = await getRoomMemories(supabase, roomId);
      setRecap(nextRecap);
      setIsFollowing(nextRecap.host?.is_following ?? false);
      setMemories(selectRecapMemories(allMemories, nextRecap.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This recap is unavailable."); }
    finally { setLoading(false); }
  }, [roomId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function toggleSaved(memory: RoomMemory) {
    if (processingId) return;
    const nextSaved = !memory.is_saved;
    setProcessingId(memory.id);
    setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, is_saved: nextSaved } : item));
    try { if (nextSaved) await saveRoomMemory(supabase, memory.id); else await unsaveRoomMemory(supabase, memory.id); }
    catch (reason) { setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, is_saved: !nextSaved } : item)); setError(reason instanceof Error ? reason.message : "Could not update this Memory."); }
    finally { setProcessingId(null); }
  }

  async function toggleFollow() {
    if (!recap?.host || recap.host.is_current_user || followBusy) return;

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData.user?.id;
    if (!currentUserId) {
      setError("Sign in to follow this host.");
      return;
    }

    const nextFollowing = !isFollowing;
    setFollowBusy(true);
    setIsFollowing(nextFollowing);
    setError(null);

    const { error: followError } = nextFollowing
      ? await supabase.from("follows").insert({ follower_id: currentUserId, following_id: recap.host.user_id })
      : await supabase.from("follows").delete().eq("follower_id", currentUserId).eq("following_id", recap.host.user_id);

    if (followError) {
      setIsFollowing(!nextFollowing);
      setError(followError.message);
    }
    setFollowBusy(false);
  }

  if (loading) {
    return (
      <PartyUpPageShell intensity="immersive">
        <div className="grid min-h-screen place-items-center text-sm font-bold text-[#c9c2d7]">
          Opening your recap...
        </div>
      </PartyUpPageShell>
    );
  }

  if (!recap) {
    return (
      <PartyUpPageShell intensity="immersive">
        <div className="grid min-h-screen place-items-center px-5 text-center">
          <div className={`${partyUpTheme.glassElevated} max-w-lg p-8`}>
            <h1 className="text-3xl font-black">Recap unavailable</h1>
            <p className={`mt-3 ${partyUpTheme.textSecondary}`}>
              {error || "This event recap could not be found."}
            </p>
            <Link href="/activity" className={`${partyUpTheme.ghostButton} mt-6 px-5 text-sm`}>
              Back to Activity
            </Link>
          </div>
        </div>
      </PartyUpPageShell>
    );
  }

  const metrics = [[recap.metrics.people, "people were here"], [recap.metrics.memories, "Memories posted"], [recap.metrics.matches, "Matches happened"], [recap.metrics.connections, "Connections made"]] as const;
  const hostName = recap.host?.display_name?.trim() || recap.host?.username?.trim() || "Event host";

  return (
    <PartyUpPageShell intensity="immersive">
      <HomeHeader />
      <header className="relative overflow-hidden border-b border-purple-100/15 bg-[#120a24]/55 backdrop-blur-sm">
        {recap.cover_image_url && (
          <img src={recap.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,7,26,0.92),rgba(14,8,32,0.7)_58%,rgba(14,8,32,0.38))]" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 md:py-20">
          <Link href="/activity" className="text-sm font-black text-[#d7b2ff] hover:text-white">Back to Activity</Link>
          <p className="mt-10 text-sm font-black uppercase tracking-[0.18em] text-[#ff63a8]">Last Night</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-normal md:text-6xl">Last Night at {recap.room_title}</h1>
          <div className={`mt-4 flex flex-wrap items-center gap-2 text-sm font-bold ${partyUpTheme.textSecondary}`}>
            <span>{new Date(recap.event_date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
            {recap.host && (
              <>
                <span aria-hidden="true">&middot;</span>
                <span>Hosted by</span>
                <Link href={`/user/${recap.host.user_id}`} aria-label={`View ${hostName}'s profile`} className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-purple-200/25 bg-[#8b3dff] text-[10px] font-black text-white transition hover:border-white/60">
                  {recap.host.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={recap.host.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : initials(hostName)}
                </Link>
                <Link href={`/user/${recap.host.user_id}`} className="font-black text-white hover:text-[#d8b4fe]">{hostName}</Link>
                {!recap.host.is_current_user && (
                  <button type="button" disabled={followBusy} onClick={() => void toggleFollow()} className={`rounded-full px-3 py-1.5 text-xs font-black transition disabled:opacity-60 ${isFollowing ? "border border-white/15 bg-white/[0.06] text-zinc-200" : "bg-[#ef2f91] text-white hover:bg-[#d9277f]"}`}>
                    {followBusy ? "Saving..." : isFollowing ? "Following" : "Follow"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-6xl px-5 py-10 md:py-14">
        {error && <p className="mb-6 rounded-md border border-amber-300/20 bg-amber-950/30 p-4 text-sm font-bold text-amber-100">{error}</p>}

        {(recap.host_message || recap.host_media) && (
          <section className={`${partyUpTheme.glassElevated} overflow-hidden border-l-2 border-l-[#ff63a8]`}>
            <div className="px-6 py-7 md:px-8">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff82b8]">From your host</p>
              {recap.host_message && <p className="mt-3 max-w-3xl text-xl font-bold leading-8">{recap.host_message}</p>}
            </div>
            {recap.host_media && (
              <div className="border-t border-white/10 bg-black/35">
                {recap.host_media.media_type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={recap.host_media.signed_url} alt="Media shared by the event host" className="max-h-[680px] w-full object-contain" />
                ) : (
                  <video src={recap.host_media.signed_url} controls playsInline preload="metadata" className="max-h-[680px] w-full" />
                )}
              </div>
            )}
          </section>
        )}

        <section className={recap.host_message || recap.host_media ? "mt-14 border-t border-purple-100/15 pt-10" : undefined}>
          <p className={partyUpTheme.sectionLabel}>From the room</p>
          <h2 className="mt-2 text-3xl font-black">Memories</h2>
          {memories.length === 0 ? (
            <p className={`mt-5 text-sm font-semibold ${partyUpTheme.textSecondary}`}>No Memories from this event are available now.</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
              {memories.map((memory) => {
                const url = getMemoryPublicUrl(supabase, memory.media_path);
                return (
                  <article key={memory.id} className={`${partyUpTheme.glassCard} overflow-hidden`}>
                    <div className="aspect-square bg-[#070712]">
                      {memory.media_type === "image" ? <img src={url} alt="" className="h-full w-full object-cover" /> : <video src={url} className="h-full w-full object-cover" controls preload="metadata" />}
                    </div>
                    <div className="flex items-center justify-between gap-3 p-3 md:p-4">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black md:text-sm">{memory.uploader_name || "Guest"}</p>
                        <p className={`mt-1 truncate text-[11px] font-bold ${partyUpTheme.textMuted}`}>{formatMemoryTimestamp(memory.created_at)}</p>
                      </div>
                      <button type="button" disabled={processingId === memory.id} onClick={() => void toggleSaved(memory)} className={`${memory.is_saved ? `${partyUpTheme.tabActive} border` : partyUpTheme.ghostButton} shrink-0 rounded-md px-3 py-2 text-xs font-black`}>
                        {memory.is_saved ? "Saved" : "Save"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-14 border-t border-purple-100/15 pt-10">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-[#ff63a8]">Still with you</p>
          <h2 className="mt-2 text-3xl font-black">People You Kept</h2>
          {recap.connections.length === 0 ? (
            <p className={`mt-5 text-sm font-semibold ${partyUpTheme.textSecondary}`}>No event Connections to show.</p>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recap.connections.map((connection) => {
                const name = getRecapConnectionName(connection);
                const content = <><span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#8b3dff] text-sm font-black">{connection.avatar_url ? <img src={connection.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(name)}</span><span><strong className="block font-black">{name}</strong><span className={`mt-1 block text-xs font-bold ${partyUpTheme.textSecondary}`}>Connected</span></span></>;
                return connection.profile_user_id ? (
                  <Link key={connection.connection_id} href={`/user/${connection.profile_user_id}`} className={`${partyUpTheme.glassInteractive} flex items-center gap-3 p-4`}>{content}</Link>
                ) : (
                  <div key={connection.connection_id} className={`${partyUpTheme.glassCard} flex items-center gap-3 p-4`}>{content}</div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-14 border-t border-purple-100/15 pt-10">
          <h2 className="text-3xl font-black">The night in a few numbers</h2>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-purple-100/15 bg-purple-100/10 md:grid-cols-4">
            {metrics.map(([value, label]) => (
              <div key={label} className="bg-[#100b20]/80 p-5 backdrop-blur-md">
                <strong className="text-3xl font-black text-[#d8b4fe]">{value}</strong>
                <p className={`mt-2 text-xs font-bold leading-5 ${partyUpTheme.textSecondary}`}>{label}</p>
              </div>
            ))}
          </div>
          <p className={`mt-5 text-sm font-bold ${partyUpTheme.textSecondary}`}>
            You kept {recap.personal.connections} {recap.personal.connections === 1 ? "person" : "people"} and saved {recap.personal.saved_memories} {recap.personal.saved_memories === 1 ? "Memory" : "Memories"}.
          </p>
        </section>

      </div>
    </PartyUpPageShell>
  );
}
