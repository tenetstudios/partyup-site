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
    <div className={`rounded-[8px] border px-3 py-3 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b587ff]">{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
      {detail && <p className="mt-1.5 text-xs font-bold text-[#aaa3b8]">{detail}</p>}
    </div>
  );
}

export default function HostDashboardOverview({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [dashboard, setDashboard] = useState<HostDashboardData | null>(null);
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
  return (
    <section id="overview" className="mt-6 rounded-[10px] border border-[#7f3dff]/30 bg-[radial-gradient(circle_at_20%_0%,rgba(239,47,145,0.1),transparent_30%),#12051e] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ff71b4]">
            Host Dashboard
          </p>
          <h2 className="mt-1 truncate text-2xl font-black text-white">{dashboard.room.title}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-400">
          <span className="rounded-md bg-emerald-400/10 px-2 py-1 font-black uppercase text-emerald-200">
            {dashboard.room.status ?? "live"}
          </span>
          <span>Since {formatDateTime(dashboard.window_start)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Here Now" value={formatNumber(live.here_now || dashboard.room.current_users)} detail="Active room presence" tone="green" />
        <MetricCard label="Matching" value={formatNumber(live.matching)} detail="Searching in this room" tone="pink" />
        <MetricCard label="Active Matches" value={formatNumber(live.active_matches)} detail="Room-specific sessions" />
        <MetricCard label="Connections" value={formatNumber(live.connections)} detail="Mutual Keep in Touch" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
        <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b587ff]">Tonight&apos;s Funnel</p>
            <span className="text-[11px] font-bold text-zinc-500">Since {formatDateTime(dashboard.window_start)}</span>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {funnelDisplayRows.map((row) => (
              <div key={row.key} className="flex items-center gap-2 rounded-[6px] bg-white/[0.04] px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-xs font-bold text-zinc-300">{row.label}</span>
                <span className="text-sm font-black text-white">{formatNumber(row.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b587ff]">Live Operations</p>
          <div className="mt-2 divide-y divide-white/[0.07]">
            {[
              ["Stream", live.streamers > 0 ? `${formatNumber(live.streamers)} live` : "Offline"],
              ["OBS", live.obs_ready ? "Ready" : "Not set up"],
              ["Waiting to stream", formatNumber(live.waiting_to_stream)],
              ["Bouncers", formatNumber(live.bouncers)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 py-2 text-xs font-bold">
                <span className="text-zinc-400">{label}</span>
                <span className="text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
