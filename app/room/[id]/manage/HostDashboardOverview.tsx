"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getRoomHostDashboard,
  type HostDashboardData,
  type RoomAnalyticsEventType,
} from "@/lib/roomAnalytics";

const funnelRows: Array<{ key: RoomAnalyticsEventType; label: string }> = [
  { key: "qr_scan", label: "QR Scans" },
  { key: "room_entry", label: "Room Entries" },
  { key: "match_started", label: "Match Starts" },
  { key: "match_connected", label: "Successful Matches" },
  { key: "match_next", label: "Next Actions" },
  { key: "keep_in_touch", label: "Keep in Touch" },
  { key: "mutual_connection", label: "Mutual Connections" },
];

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Room start";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Room start";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "pink" | "green";
}) {
  const toneClass =
    tone === "pink"
      ? "border-[#ef2f91]/35 bg-[#ef2f91]/10"
      : tone === "green"
        ? "border-emerald-400/25 bg-emerald-400/10"
        : "border-white/10 bg-white/[0.045]";

  return (
    <div className={`rounded-[8px] border p-4 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">{label}</p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      {detail && <p className="mt-2 text-sm font-bold text-[#aaa3b8]">{detail}</p>}
    </div>
  );
}

function QuickAction({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-purple-300/60 bg-[#7c3aed] px-5 text-sm font-black text-white shadow-[0_8px_24px_rgba(124,58,237,0.38)] transition hover:-translate-y-0.5 hover:bg-[#9146ff] hover:shadow-[0_10px_30px_rgba(145,70,255,0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
    >
      {children}
    </a>
  );
}

export default function HostDashboardOverview({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [dashboard, setDashboard] = useState<HostDashboardData | null>(null);
  const [entryUrl, setEntryUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventPoolId = dashboard?.event_pool_id ?? null;
  const hasDashboard = Boolean(dashboard);
  const funnelDisplayRows = useMemo(() => {
    if (!dashboard) return [];

    return funnelRows.map((row) => {
      const value = dashboard.funnel[row.key] ?? 0;

      return {
        ...row,
        value,
      };
    });
  }, [dashboard]);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await getRoomHostDashboard(supabase, roomId);
      setDashboard(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load host dashboard.");
    }
  }, [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      setEntryUrl(`${window.location.origin}/join/${encodeURIComponent(roomId)}`);
      void loadDashboard();
    });
  }, [loadDashboard, roomId]);

  useEffect(() => {
    if (!hasDashboard) return;

    let refreshTimer: number | null = null;
    const refreshSoon = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadDashboard();
      }, 350);
    };

    const channels = [
      supabase
        .channel(`host-dashboard-room-${roomId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "event_rooms", filter: `id=eq.${roomId}` }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "event_attendees", filter: `event_room_id=eq.${roomId}` }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_presence", filter: `room_id=eq.${roomId}` }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_announcements", filter: `room_id=eq.${roomId}` }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_stream_keys", filter: `room_id=eq.${roomId}` }, refreshSoon)
        .on("postgres_changes", { event: "*", schema: "public", table: "room_analytics_events", filter: `room_id=eq.${roomId}` }, refreshSoon)
        .subscribe(),
    ];

    if (eventPoolId) {
      channels.push(
        supabase
          .channel(`host-dashboard-match-${eventPoolId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "match_queue", filter: `pool_id=eq.${eventPoolId}` }, refreshSoon)
          .on("postgres_changes", { event: "*", schema: "public", table: "match_sessions", filter: `pool_id=eq.${eventPoolId}` }, refreshSoon)
          .on("postgres_changes", { event: "*", schema: "public", table: "partyup_connections", filter: `source_pool_id=eq.${eventPoolId}` }, refreshSoon)
          .subscribe(),
      );
    }

    const fallbackId = window.setInterval(() => {
      void loadDashboard();
    }, 15000);

    return () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer);
      }
      window.clearInterval(fallbackId);
      channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
    };
  }, [eventPoolId, hasDashboard, loadDashboard, roomId, supabase]);

  async function copyEntryLink() {
    if (!entryUrl) return;

    await navigator.clipboard.writeText(entryUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (error) {
    return (
      <section className="mt-8 rounded-[10px] border border-red-500/30 bg-red-500/10 p-5 text-red-100">
        {error}
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="mt-8 rounded-[10px] border border-white/10 bg-[#12051e] p-5 text-sm font-bold text-zinc-400">
        Loading host dashboard...
      </section>
    );
  }

  const live = dashboard.live;
  const announcement = dashboard.announcement;
  return (
    <section id="overview" className="mt-8 rounded-[10px] border border-[#7f3dff]/35 bg-[radial-gradient(circle_at_20%_0%,rgba(239,47,145,0.14),transparent_28%),#12051e] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ff71b4]">
            Host Dashboard
          </p>
          <h2 className="mt-2 text-3xl font-black text-white">{dashboard.room.title}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-white">
              {dashboard.room.status ?? "live"}
            </span>
            <span className="rounded-full bg-[#7f3dff]/20 px-3 py-1 text-xs font-black text-[#d8c6ff]">
              Since {formatDateTime(dashboard.window_start)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!roomEnded && <QuickAction href="#room-details">Room Description</QuickAction>}
          {!roomEnded && <QuickAction href="#qr-poster">QR & Poster</QuickAction>}
          {!roomEnded && <QuickAction href="#chat-moderation">Chat Moderation</QuickAction>}
          {!roomEnded && <QuickAction href="#announcements">{announcement ? "Manage Announcement" : "Create Announcement"}</QuickAction>}
          <QuickAction href="#missions">Missions</QuickAction>
          {!roomEnded && <QuickAction href="#people-queue">People / Queue</QuickAction>}
          {!roomEnded && <QuickAction href="#streaming">Streaming / OBS</QuickAction>}
          <QuickAction href="#event-closeout">Event Closeout</QuickAction>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Here Now" value={formatNumber(live.here_now || dashboard.room.current_users)} detail="Active room presence" tone="green" />
        <MetricCard label="Matching" value={formatNumber(live.matching)} detail="Searching in this room" tone="pink" />
        <MetricCard label="Active Matches" value={formatNumber(live.active_matches)} detail="Room-specific sessions" />
        <MetricCard label="Connections" value={formatNumber(live.connections)} detail="Mutual Keep in Touch" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-[8px] border border-white/10 bg-black/25 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">Announcement</p>
              {announcement ? (
                <>
                  <p className="mt-3 text-sm font-black uppercase text-emerald-200">Active</p>
                  <h3 className="mt-1 text-xl font-black text-white">{announcement.title}</h3>
                  {announcement.message && <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{announcement.message}</p>}
                </>
              ) : (
                <p className="mt-3 text-sm font-bold text-zinc-400">No active announcement</p>
              )}
            </div>
            <a href="#announcements" className="rounded-md bg-[#9146ff] px-3 py-2 text-xs font-black text-white hover:bg-[#7b31e8]">
              Manage
            </a>
          </div>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/25 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">Stream</p>
          <p className="mt-3 text-2xl font-black text-white">
            {live.streamers > 0 ? "Live" : "Offline"}
          </p>
          <p className="mt-2 text-sm font-bold text-zinc-400">
            {formatNumber(live.streamers)} streamer{live.streamers === 1 ? "" : "s"} active
          </p>
          <p className="mt-1 text-sm font-bold text-zinc-400">
            OBS {live.obs_ready ? "ready" : "not set up"}
          </p>
          <a href="#streaming" className="mt-4 inline-flex rounded-md border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10">
            Streaming Settings
          </a>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/25 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">Venue Entry</p>
          <p className="mt-3 text-2xl font-black text-white">QR Ready</p>
          <p className="mt-2 break-all text-sm font-bold text-zinc-400">{entryUrl}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="#qr-poster" className="rounded-md border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10">View QR</a>
            <button type="button" onClick={copyEntryLink} className="rounded-md border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10">
              {copied ? "Copied" : "Copy Link"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="rounded-[8px] border border-white/10 bg-black/25 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">Tonight&apos;s Funnel</p>
            <span className="text-xs font-bold text-zinc-500">V1 scope starts {formatDateTime(dashboard.window_start)}</span>
          </div>
          <div className="mt-4 space-y-2">
            {funnelDisplayRows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 rounded-[6px] bg-white/[0.04] px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-bold text-zinc-300">{row.label}</span>
                <span className="w-16 text-right text-lg font-black text-white">{formatNumber(row.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/25 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b587ff]">People</p>
          <div className="mt-4 space-y-3">
            <div className="flex justify-between gap-3 text-sm font-bold">
              <span className="text-zinc-400">Waiting to stream</span>
              <span className="text-white">{formatNumber(live.waiting_to_stream)}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm font-bold">
              <span className="text-zinc-400">Bouncers</span>
              <span className="text-white">{formatNumber(live.bouncers)}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm font-bold">
              <span className="text-zinc-400">Room count fallback</span>
              <span className="text-white">{formatNumber(dashboard.room.current_users)}</span>
            </div>
          </div>
          <a href="#people-queue" className="mt-5 inline-flex rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8]">
            Manage People
          </a>
        </div>
      </div>
    </section>
  );
}
