"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { formatMemoryTimestamp, getMemoryPublicUrl, getRoomMemories, saveRoomMemory, unsaveRoomMemory, type RoomMemory } from "@/lib/memories";
import { getEventRecap, getRecapConnectionName, selectRecapMemories, type EventRecap } from "@/lib/recaps";
import { createSupabaseClient } from "@/lib/supabase";

function initials(value: string) { return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export default function RecapClient({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [recap, setRecap] = useState<EventRecap | null>(null);
  const [memories, setMemories] = useState<RoomMemory[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextRecap = await getEventRecap(supabase, roomId);
      const allMemories = await getRoomMemories(supabase, roomId);
      setRecap(nextRecap);
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#05040b] text-sm font-bold text-[#aaa4b8]">Opening your recap...</main>;
  if (!recap) return <main className="grid min-h-screen place-items-center bg-[#05040b] px-5 text-center text-white"><div><h1 className="text-3xl font-black">Recap unavailable</h1><p className="mt-3 text-[#aaa4b8]">{error || "This event recap could not be found."}</p><Link href="/activity" className="mt-6 inline-block text-sm font-black text-[#c35dff]">Back to Activity</Link></div></main>;

  const metrics = [[recap.metrics.people, "people were here"], [recap.metrics.memories, "Memories posted"], [recap.metrics.matches, "Matches happened"], [recap.metrics.connections, "Connections made"]] as const;

  return <main className="min-h-screen bg-[#05040b] text-white"><HomeHeader />
    <header className="relative overflow-hidden border-b border-white/10 bg-[#100817]">{recap.cover_image_url && <img src={recap.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}<div className="relative mx-auto max-w-6xl px-5 py-14 md:py-20"><Link href="/activity" className="text-sm font-black text-[#d7b2ff] hover:text-white">Back to Activity</Link><p className="mt-10 text-sm font-black uppercase tracking-[0.18em] text-[#ff63a8]">Last Night</p><h1 className="mt-3 max-w-4xl text-4xl font-black tracking-normal md:text-6xl">Last Night at {recap.room_title}</h1><p className="mt-4 text-sm font-bold text-[#c9c2d0]">{new Date(recap.event_date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div></header>
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">{error && <p className="mb-6 rounded-md border border-amber-300/20 bg-amber-950/30 p-4 text-sm font-bold text-amber-100">{error}</p>}
      <section><p className="text-sm font-black uppercase tracking-[0.16em] text-[#c35dff]">From the room</p><h2 className="mt-2 text-3xl font-black">Memories</h2>{memories.length === 0 ? <p className="mt-5 text-sm font-semibold text-[#aaa4b8]">No Memories from this event are available now.</p> : <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">{memories.map((memory) => { const url = getMemoryPublicUrl(supabase, memory.media_path); return <article key={memory.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#10101a]"><div className="aspect-square bg-black">{memory.media_type === "image" ? <img src={url} alt="" className="h-full w-full object-cover" /> : <video src={url} className="h-full w-full object-cover" controls preload="metadata" />}</div><div className="flex items-center justify-between gap-3 p-3 md:p-4"><div className="min-w-0"><p className="truncate text-xs font-black md:text-sm">{memory.uploader_name || "Guest"}</p><p className="mt-1 truncate text-[11px] font-bold text-[#817b8b]">{formatMemoryTimestamp(memory.created_at)}</p></div><button type="button" disabled={processingId === memory.id} onClick={() => void toggleSaved(memory)} className={`shrink-0 rounded-md border px-3 py-2 text-xs font-black ${memory.is_saved ? "border-[#c35dff] bg-[#c35dff]/20" : "border-white/10 bg-white/[0.04]"}`}>{memory.is_saved ? "Saved" : "Save"}</button></div></article>; })}</div>}</section>
      <section className="mt-14 border-t border-white/10 pt-10"><p className="text-sm font-black uppercase tracking-[0.16em] text-[#ff63a8]">Still with you</p><h2 className="mt-2 text-3xl font-black">People You Kept</h2>{recap.connections.length === 0 ? <p className="mt-5 text-sm font-semibold text-[#aaa4b8]">No event Connections to show.</p> : <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{recap.connections.map((connection) => { const name = getRecapConnectionName(connection); const content = <><span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#8b3dff] text-sm font-black">{connection.avatar_url ? <img src={connection.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(name)}</span><span><strong className="block font-black">{name}</strong><span className="mt-1 block text-xs font-bold text-[#aaa4b8]">Connected</span></span></>; return connection.profile_user_id ? <Link key={connection.connection_id} href={`/user/${connection.profile_user_id}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#10101a] p-4 hover:border-purple-300/35">{content}</Link> : <div key={connection.connection_id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#10101a] p-4">{content}</div>; })}</div>}</section>
      <section className="mt-14 border-t border-white/10 pt-10"><h2 className="text-3xl font-black">The night in a few numbers</h2><div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-4">{metrics.map(([value, label]) => <div key={label} className="bg-[#10101a] p-5"><strong className="text-3xl font-black text-[#d8b4fe]">{value}</strong><p className="mt-2 text-xs font-bold leading-5 text-[#aaa4b8]">{label}</p></div>)}</div><p className="mt-5 text-sm font-bold text-[#aaa4b8]">You kept {recap.personal.connections} {recap.personal.connections === 1 ? "person" : "people"} and saved {recap.personal.saved_memories} {recap.personal.saved_memories === 1 ? "Memory" : "Memories"}.</p></section>
      {recap.host_message && <section className="mt-14 border-l-2 border-[#ff63a8] bg-[#140d19] px-6 py-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff82b8]">From your host</p><p className="mt-3 max-w-3xl text-xl font-bold leading-8">{recap.host_message}</p></section>}
    </div>
  </main>;
}
