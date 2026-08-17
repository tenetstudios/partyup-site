"use client";
import Link from "next/link";
import React from "react";

type MatchIdleProps = {
  authLoading?: boolean;
  busy?: boolean;
  contextLabel?: string | null;
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
  error,
  guestClaimMessage,
  hasGuestSession = false,
  isAuthenticated = false,
  onSignIn,
  onStart,
}: MatchIdleProps) {
  const disabled = authLoading || busy;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl bg-gradient-to-br from-[#0b0410]/80 via-[#12051e]/60 to-[#0b0410]/80 p-8">
        <h1 className="text-4xl font-extrabold">Meet someone new.</h1>
        <p className="mt-3 text-lg text-zinc-300">
          {contextLabel ?? "Match connects you with another person for a 1-on-1 conversation."}
        </p>

        {!isAuthenticated && !authLoading && (
          <div className="mt-5 rounded-md border border-purple-300/20 bg-purple-950/30 p-4 text-sm text-zinc-200">
            <p className="font-bold text-white">Continue as a guest.</p>
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

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {isAuthenticated ? (
            <button
              disabled={disabled}
              onClick={onStart}
              className="rounded-full bg-pink-500 px-6 py-3 font-black text-white hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Starting..." : contextLabel ? "Start Event Match" : "Start Matching"}
            </button>
          ) : (
            <button
              disabled={disabled}
              onClick={onStart}
              className="rounded-full bg-pink-500 px-6 py-3 font-black text-white hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading ? "Checking sign-in..." : "Continue as Guest"}
            </button>
          )}
          {!isAuthenticated && onSignIn && (
            <button
              disabled={disabled}
              onClick={onSignIn}
              className="rounded-full border border-white/15 px-6 py-3 font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue with Google
            </button>
          )}
          <Link href="/" className="text-sm font-bold text-zinc-300 hover:underline">
            Back to PartyUp
          </Link>
        </div>
      </div>
    </div>
  );
}
