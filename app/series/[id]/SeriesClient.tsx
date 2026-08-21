"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#05040b] text-white">Loading series...</main>;
  if (!series) return <main className="grid min-h-screen place-items-center bg-[#05040b] px-5 text-center text-white"><div><h1 className="text-3xl font-black">Series unavailable</h1><p className="mt-3 text-[#aaa4b8]">{error || "This Event Series could not be found."}</p></div></main>;

  const hostName = series.host.display_name || series.host.username || "PartyUp host";
  return (
    <main className="min-h-screen bg-[#05040b] pb-20 text-white">
      <header className="relative min-h-[390px] overflow-hidden border-b border-white/10 bg-[#15101d]">
        {series.cover_image_url && <img src={series.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,4,11,0.15),rgba(5,4,11,0.95))]" />
        <div className="relative mx-auto flex min-h-[390px] max-w-6xl flex-col justify-end px-5 py-10">
          <Link href="/" className="absolute left-5 top-7 text-sm font-black text-white">Back</Link>
          <p className="text-xs font-black uppercase text-[#ff83b8]">Event Series</p>
          <h1 className="mt-2 max-w-4xl text-4xl font-black md:text-6xl">{series.name}</h1>
          <Link href={`/user/${series.host.user_id}`} className="mt-4 flex w-fit items-center gap-3 font-bold text-[#ded8e8]">
            {series.host.avatar_url ? <img src={series.host.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-[#39264f]">{hostName.slice(0, 1).toUpperCase()}</span>}
            Hosted by {hostName}
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!series.is_owner && <button onClick={toggleFollow} disabled={processing} className="h-11 rounded-md bg-[#8b3dff] px-6 font-black disabled:opacity-50">{series.is_following ? "Following" : "Follow Series"}</button>}
            {series.is_owner && <Link href={`/series/${series.id}/edit`} className="grid h-11 place-items-center rounded-md border border-white/20 px-5 font-black">Edit series</Link>}
            <span className="text-sm font-bold text-[#c4bdcc]">{series.follower_count} followers</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10">
        {series.description && <p className="max-w-3xl text-lg leading-8 text-[#cbc4d2]">{series.description}</p>}
        <div className="mt-8 grid grid-cols-2 gap-3 md:max-w-xl md:grid-cols-3">
          <Stat value={series.total_events} label="Events hosted" />
          <Stat value={series.follower_count} label="Series followers" />
          <Stat value={series.returning_attendees} label="Returning attendees" />
        </div>
        <EventSection title="Upcoming events" empty="The next event has not been announced yet." events={series.upcoming_events} />
        <EventSection title="Past events and recaps" empty="Completed events will stay here after their rooms end." events={series.past_events} />
      </div>
    </main>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4"><p className="text-2xl font-black">{value}</p><p className="mt-1 text-xs font-bold uppercase text-[#a9a2b1]">{label}</p></div>;
}

function EventSection({ title, empty, events }: { title: string; empty: string; events: SeriesEvent[] }) {
  return <section className="mt-12"><h2 className="text-2xl font-black">{title}</h2>{events.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-white/15 p-6 text-[#aaa4b8]">{empty}</p> : <div className="mt-5 grid gap-4 md:grid-cols-2">{events.map((event) => <Link href={`/room/${event.id}`} key={event.id} className="flex min-h-32 overflow-hidden rounded-lg border border-white/10 bg-[#111019] hover:border-[#8b5dc2]">{event.cover_image_url ? <img src={event.cover_image_url} alt="" className="w-32 object-cover" /> : <div className="grid w-32 place-items-center bg-[#22152e] font-black text-[#d8b4fe]">PU</div>}<div className="min-w-0 flex-1 p-4"><div className="flex items-start justify-between gap-3"><h3 className="truncate font-black">{event.title}</h3><span className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase">{event.status}</span></div><p className="mt-2 text-sm font-bold text-[#c9a6ff]">{formatSeriesDate(event.event_date)}</p>{event.venue_name && <p className="mt-1 truncate text-sm text-[#aaa4b8]">{event.venue_name}</p>}<p className="mt-4 text-xs font-bold text-[#817a89]">{event.people_count} attended / {event.memory_count} Memories</p></div></Link>)}</div>}</section>;
}
