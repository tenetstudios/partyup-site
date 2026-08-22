"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { createSupabaseClient } from "@/lib/supabase";
import { EventSeriesProfile, SeriesEvent, formatSeriesDate, getEventSeriesProfile } from "@/lib/eventSeries";

export default function SeriesClient({ seriesId }: { seriesId: string }) {
  const [series, setSeries] = useState<EventSeriesProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSeries(await getEventSeriesProfile(createSupabaseClient(), seriesId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series unavailable.");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function toggleFollow() {
    if (!series || processing) return;
    setProcessing(true);
    const supabase = createSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert("Sign in to follow this series.");
      setProcessing(false);
      return;
    }
    const { error: followError } = await supabase.rpc("set_event_series_follow", { p_series_id: series.id, p_follow: !series.is_following });
    if (followError) alert(followError.message);
    await load();
    setProcessing(false);
  }

  if (loading) return <PartyUpPageShell><div className="grid min-h-screen place-items-center font-bold text-[#c9c2d7]">Loading series...</div></PartyUpPageShell>;
  if (!series) return <PartyUpPageShell><div className="grid min-h-screen place-items-center px-5 text-center"><div className={`${partyUpTheme.glassElevated} max-w-lg p-8`}><h1 className="text-3xl font-black">Series unavailable</h1><p className={`mt-3 ${partyUpTheme.textSecondary}`}>{error || "This Event Series could not be found."}</p></div></div></PartyUpPageShell>;

  const hostName = series.host.display_name || series.host.username || "PartyUp host";
  return (
    <PartyUpPageShell intensity="standard" className="pb-20">
      <HomeHeader />
      <header className="relative min-h-[390px] overflow-hidden border-b border-purple-100/15 bg-[#15101d]/55">
        {series.cover_image_url && <img src={series.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,7,24,0.18),rgba(12,8,29,0.96))]" />
        <div className="relative mx-auto flex min-h-[390px] max-w-6xl flex-col justify-end px-5 py-10">
          <Link href="/" className={`${partyUpTheme.ghostButton} absolute left-5 top-7 h-10 px-4 text-sm`}>Back</Link>
          <p className="text-xs font-black uppercase text-[#ff83b8]">Event Series</p>
          <h1 className="mt-2 max-w-4xl text-4xl font-black md:text-6xl">{series.name}</h1>
          <Link href={`/user/${series.host.user_id}`} className="mt-4 flex w-fit items-center gap-3 font-bold text-[#ded8e8]">
            {series.host.avatar_url ? <img src={series.host.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-[#39264f]">{hostName.slice(0, 1).toUpperCase()}</span>}
            Hosted by {hostName}
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!series.is_owner && <button onClick={toggleFollow} disabled={processing} className={`${series.is_following ? partyUpTheme.ghostButton : partyUpTheme.primaryButton} h-11 px-6`}>{series.is_following ? "Following" : "Follow Series"}</button>}
            {series.is_owner && <Link href={`/series/${series.id}/edit`} className={`${partyUpTheme.ghostButton} h-11 px-5`}>Edit series</Link>}
            <span className="text-sm font-bold text-[#c4bdcc]">{series.follower_count} followers</span>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-6xl px-5 py-10">
        {series.description && <p className="max-w-3xl text-lg leading-8 text-[#cbc4d2]">{series.description}</p>}
        <div className="mt-8 grid grid-cols-2 gap-3 md:max-w-xl md:grid-cols-3">
          <Stat value={series.total_events} label="Events hosted" />
          <Stat value={series.follower_count} label="Series followers" />
          <Stat value={series.returning_attendees} label="Returning attendees" />
        </div>
        <EventSection title="Upcoming events" empty="The next event has not been announced yet." events={series.upcoming_events} />
        <EventSection title="Past events and recaps" empty="Completed events will stay here after their rooms end." events={series.past_events} />
      </div>
    </PartyUpPageShell>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className={`${partyUpTheme.glassCard} p-4`}><p className="text-2xl font-black text-[#d8b4fe]">{value}</p><p className={`mt-1 text-xs font-bold uppercase ${partyUpTheme.textSecondary}`}>{label}</p></div>;
}

function EventSection({ title, empty, events }: { title: string; empty: string; events: SeriesEvent[] }) {
  return <section className="mt-12"><h2 className="text-2xl font-black">{title}</h2>{events.length === 0 ? <p className={`${partyUpTheme.emptyState} mt-4 p-6 ${partyUpTheme.textSecondary}`}>{empty}</p> : <div className="mt-5 grid gap-4 md:grid-cols-2">{events.map((event) => <Link href={`/room/${event.id}`} key={event.id} className={`${partyUpTheme.glassInteractive} flex min-h-32 overflow-hidden`}>{event.cover_image_url ? <img src={event.cover_image_url} alt="" className="w-32 object-cover" /> : <div className="grid w-32 place-items-center bg-[#22152e] font-black text-[#d8b4fe]">PU</div>}<div className="min-w-0 flex-1 p-4"><div className="flex items-start justify-between gap-3"><h3 className="truncate font-black">{event.title}</h3><span className="rounded bg-purple-100/10 px-2 py-1 text-[10px] font-black uppercase">{event.status}</span></div><p className="mt-2 text-sm font-bold text-[#c9a6ff]">{formatSeriesDate(event.event_date)}</p>{event.venue_name && <p className={`mt-1 truncate text-sm ${partyUpTheme.textSecondary}`}>{event.venue_name}</p>}<p className={`mt-4 text-xs font-bold ${partyUpTheme.textMuted}`}>{event.people_count} attended / {event.memory_count} Memories</p></div></Link>)}</div>}</section>;
}
