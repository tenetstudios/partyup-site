"use client";
import Link from "next/link";
import React from "react";

type MatchIdleProps = {
  authLoading?: boolean;
  busy?: boolean;
  contextLabel?: string | null;
  error?: string | null;
  isAuthenticated?: boolean;
  onSignIn?: () => void;
  onStart: () => void;
};

export default function MatchIdle({
  authLoading = false,
  busy = false,
  contextLabel = null,
  error,
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
            <p className="font-bold text-white">Sign in to start matching.</p>
            <p className="mt-1 text-zinc-300">PartyUp Match is limited to signed-in users for this phase.</p>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-md border border-red-400/30 bg-red-950/30 p-4 text-sm font-bold text-red-100">
            {error}
          </div>
        )}

        <div className="mt-8 flex items-center gap-4">
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
              onClick={onSignIn}
              className="rounded-full bg-pink-500 px-6 py-3 font-black text-white hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading ? "Checking sign-in..." : "Sign in to Match"}
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
