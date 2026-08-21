"use client";
import Link from "next/link";
import React from "react";

type MatchIdleProps = {
  authLoading?: boolean;
  busy?: boolean;
  contextLabel?: string | null;
  eventRoomName?: string | null;
  backHref?: string;
  error?: string | null;
  guestClaimMessage?: string | null;
  hasGuestSession?: boolean;
  isAuthenticated?: boolean;
  onSignIn?: () => void;
  onStart: () => void;
};

export default function MatchIdle({
  authLoading = false,
  busy = false,
  contextLabel = null,
  eventRoomName = null,
  backHref = "/",
  error,
  guestClaimMessage,
  hasGuestSession = false,
  isAuthenticated = false,
  onSignIn,
  onStart,
}: MatchIdleProps) {
  const disabled = authLoading || busy;

  return (
    <div className="relative mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-lg border border-fuchsia-400/20 bg-[linear-gradient(145deg,rgba(17,6,28,0.98),rgba(37,8,48,0.9)_52%,rgba(10,5,20,0.98))] shadow-[0_28px_90px_rgba(156,39,176,0.18)]">
        <div className="border-b border-white/10 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-fuchsia-200">
              Match ready
            </span>
            <span className="text-xs font-bold text-zinc-400">1:1 live connection</span>
          </div>
        </div>

        <div className="p-5 sm:p-8">
          <h2 className="max-w-xl text-3xl font-black leading-tight sm:text-5xl">Find the person who changes the night.</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
            {contextLabel ?? "Drop into a live one-to-one and see where the energy goes."}
          </p>

          <div className="mt-7 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              ["Energy", "Live"],
              ["Social radius", eventRoomName ?? (contextLabel ? "Event room" : "PartyUp")],
              ["Momentum", "Ready"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-md border border-white/10 bg-white/[0.04] p-3 sm:p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500 sm:text-xs">{label}</p>
                <p className="mt-1 break-words text-sm font-black text-white sm:text-base">{value}</p>
              </div>
            ))}
          </div>

        {!isAuthenticated && !authLoading && (
          <div className="mt-5 rounded-md border border-purple-300/20 bg-purple-950/30 p-4 text-sm text-zinc-200">
            <p className="font-bold text-white">Jump in as a guest.</p>
            <p className="mt-1 text-zinc-300">
              You can sign in with Google later to save your connections.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-md border border-red-400/30 bg-red-950/30 p-4 text-sm font-bold text-red-100">
            {error}
          </div>
        )}

        {guestClaimMessage && (
          <div className="mt-5 rounded-md border border-emerald-300/20 bg-emerald-950/30 p-4 text-sm font-bold text-emerald-100">
            {guestClaimMessage}
          </div>
        )}

        {!isAuthenticated && hasGuestSession && (
          <div className="mt-5 rounded-md border border-pink-300/20 bg-pink-950/20 p-4 text-sm text-zinc-200">
            <p className="font-bold text-white">You have guest Match activity on this browser.</p>
            <p className="mt-1 text-zinc-300">Sign in with Google later to keep it attached.</p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {isAuthenticated ? (
            <button
              disabled={disabled}
              onClick={onStart}
              className="min-h-12 rounded-full bg-pink-500 px-6 py-3 font-black text-white shadow-[0_0_24px_rgba(236,72,153,0.3)] transition hover:-translate-y-0.5 hover:bg-pink-400 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Tuning your signal..." : "Start matching"}
            </button>
          ) : (
            <button
              disabled={disabled}
              onClick={onStart}
              className="min-h-12 rounded-full bg-pink-500 px-6 py-3 font-black text-white shadow-[0_0_24px_rgba(236,72,153,0.3)] transition hover:-translate-y-0.5 hover:bg-pink-400 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading ? "Checking your signal..." : "Start matching"}
            </button>
          )}
          {!isAuthenticated && onSignIn && (
            <button
              disabled={disabled}
              onClick={onSignIn}
              className="min-h-12 rounded-full border border-white/15 px-6 py-3 font-black text-white transition hover:border-white/30 hover:bg-white/10 active:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue with Google
            </button>
          )}
          <Link href={backHref} className="px-2 py-3 text-center text-sm font-bold text-zinc-300 hover:text-white sm:text-left">
            {eventRoomName ? `Back to ${eventRoomName}` : "Back to PartyUp"}
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}
