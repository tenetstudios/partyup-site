"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { resolveMyEventRecaps } from "@/lib/recaps";
import { createSupabaseClient } from "@/lib/supabase";
import { FollowedSeriesEvent, formatSeriesDate } from "@/lib/eventSeries";

type ActivityItem = { id: string; actor_id: string | null; type: string; title: string; body: string; room_id: string | null; recap_room_id: string | null; is_read: boolean; created_at: string };

function formatTime(value: string) {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ActivityPage() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [seriesEvents, setSeriesEvents] = useState<FollowedSeriesEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { setItems([]); setSeriesEvents([]); return; }
      await resolveMyEventRecaps(supabase);
      const [{ data, error: loadError }, seriesResult] = await Promise.all([
        supabase.from("notifications").select("id,actor_id,type,title,body,room_id,recap_room_id,is_read,created_at").eq("user_id", userData.user.id).order("created_at", { ascending: false }).limit(50),
        supabase.rpc("get_my_followed_series_events"),
      ]);
      if (loadError) throw new Error(loadError.message);
      setItems((data || []) as ActivityItem[]);
      setSeriesEvents(seriesResult.error ? [] : (seriesResult.data || []) as FollowedSeriesEvent[]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Activity is unavailable."); }
    finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void loadActivity(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadActivity]);

  async function markRead(item: ActivityItem) {
    if (item.is_read) return;
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
    await supabase.from("notifications").update({ is_read: true }).eq("id", item.id);
  }

  return (
    <PartyUpPageShell intensity="standard" crowd>
      <HomeHeader />
      <section className="mx-auto w-full max-w-3xl px-5 py-10 md:py-12">
        <div className="border-b border-purple-200/10 pb-7">
          <p className={partyUpTheme.sectionLabel}>PartyUp</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">Activity</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-[#c0b9ca]">The rooms, people, and moments worth coming back to.</p>
        </div>

        {seriesEvents.length > 0 && (
          <section className="mt-8">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff75b5]">Series you follow</p>
            <h2 className="mt-1 text-2xl font-black">Coming up again</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {seriesEvents.map((event) => (
                <article key={event.id} className={`${partyUpTheme.glassInteractive} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/series/${event.series_id}`} className="text-xs font-black uppercase text-[#d7b2ff] hover:text-white">{event.series_name}</Link>
                    <span className="rounded bg-purple-100/10 px-2 py-1 text-[9px] font-black uppercase text-[#d8d0e3]">{event.status}</span>
                  </div>
                  <Link href={`/room/${event.id}`}>
                    <h3 className="mt-2 font-black">{event.title}</h3>
                    <p className="mt-2 text-xs font-bold text-[#aaa4b8]">{formatSeriesDate(event.event_date)}</p>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-3">
          {loading ? (
            <div className={`${partyUpTheme.glassElevated} p-6 text-sm font-bold text-[#aaa4b8]`}>Loading Activity...</div>
          ) : error ? (
            <div className="rounded-lg border border-amber-300/20 bg-amber-950/30 p-6 text-sm font-bold text-amber-100 backdrop-blur-md">{error}</div>
          ) : items.length === 0 ? (
            <div className={`${partyUpTheme.emptyState} p-8`}>
              <h2 className="text-xl font-black">Nothing new yet.</h2>
              <p className="mt-2 text-sm text-[#aaa4b8]">Your event recaps and connection updates will stay here.</p>
            </div>
          ) : items.map((item) => {
            const recapRoomId = item.recap_room_id || (item.type === "event_recap" ? item.room_id : null);
            const href = recapRoomId ? `/recap/${recapRoomId}` : item.room_id ? `/room/${item.room_id}` : "/activity";

            return (
              <Link
                key={item.id}
                href={href}
                onClick={() => void markRead(item)}
                className={`${partyUpTheme.glassInteractive} group flex gap-4 p-5 ${item.is_read ? "" : "ring-1 ring-[#8b3dff]/55"}`}
              >
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.is_read ? "bg-white/15" : "bg-[#c35dff] shadow-[0_0_12px_rgba(195,93,255,0.7)]"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-4">
                    <strong className="text-base font-black">{item.title}</strong>
                    <span className={`shrink-0 text-xs font-bold ${partyUpTheme.textMuted}`}>{formatTime(item.created_at)}</span>
                  </span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-[#b8b0c4]">{item.body}</span>
                  {recapRoomId && <span className="mt-3 block text-sm font-black text-[#c35dff] group-hover:text-white">Open recap</span>}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </PartyUpPageShell>
  );
}
