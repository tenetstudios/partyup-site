"use client";
import React from "react";

export default function MatchSearching({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl bg-gradient-to-br from-[#0b0410]/80 via-[#12051e]/60 to-[#0b0410]/80 p-8 text-center">
        <div className="flex items-center justify-center">
          <div className="h-14 w-14 animate-pulse rounded-full bg-pink-500/60" />
        </div>
        <h2 className="mt-6 text-2xl font-bold">Finding someone...</h2>
        <p className="mt-2 text-sm text-zinc-300">Looking for someone who's ready to talk.</p>
        <div className="mt-6">
          <button onClick={onCancel} className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-bold">Cancel</button>
        </div>
      </div>
    </div>
  );
}
