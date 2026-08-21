"use client";
import React from "react";

export default function MatchSearching({
  busy,
  contextLabel,
  onCancel,
}: {
  busy?: boolean;
  contextLabel?: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-lg border border-fuchsia-400/20 bg-[linear-gradient(145deg,rgba(17,6,28,0.98),rgba(37,8,48,0.9),rgba(10,5,20,0.98))] p-6 text-center shadow-[0_28px_90px_rgba(156,39,176,0.18)] sm:p-10">
        <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full border border-pink-400/30" />
          <div className="absolute inset-4 animate-pulse rounded-full border border-purple-300/40" />
          <div className="h-10 w-10 rounded-full bg-pink-500 shadow-[0_0_32px_rgba(236,72,153,0.75)]" />
        </div>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.16em] text-fuchsia-300">Signal sweeping</p>
        <h2 className="mt-2 text-3xl font-black">Reading the room...</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-300">
          {contextLabel ?? "Looking for someone with live energy and room to connect."}
        </p>
        <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2 text-left">
          {["Vibe", "Timing", "Readiness"].map((signal) => (
            <div key={signal} className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">{signal}</p>
              <p className="mt-1 text-xs font-bold text-fuchsia-100">Scanning</p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <button
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-zinc-200 transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Leaving the radar..." : "Leave the radar"}
          </button>
        </div>
      </div>
    </div>
  );
}
