"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateEventMatchPool } from "@/lib/matchmaking";
import { createSupabaseClient } from "@/lib/supabase";

export default function EventMatchButton({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startEventMatch() {
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createSupabaseClient();
      const pool = await getOrCreateEventMatchPool(supabase, roomId);
      router.push(`/match?pool=${encodeURIComponent(pool.poolId)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start event Match.");
      setLoading(false);
    }
  }

  return (
    <aside className="flex h-full flex-col rounded-[10px] border border-[#ff2f9b]/55 bg-[radial-gradient(circle_at_50%_12%,rgba(255,47,155,0.14),transparent_28%),linear-gradient(180deg,rgba(18,6,29,0.96),rgba(8,2,14,0.98))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-[#ff2f9b]/35 bg-black/30 text-[#ff4daa]">
        <svg viewBox="0 0 32 32" className="h-10 w-10" fill="currentColor" aria-hidden="true">
          <path d="M15.1 4.9c.3-.9 1.5-.9 1.8 0l1.3 4.1c.1.3.4.6.7.7l4.1 1.3c.9.3.9 1.5 0 1.8l-4.1 1.3c-.3.1-.6.4-.7.7l-1.3 4.1c-.3.9-1.5.9-1.8 0l-1.3-4.1c-.1-.3-.4-.6-.7-.7L9 12.8c-.9-.3-.9-1.5 0-1.8l4.1-1.3c.3-.1.6-.4.7-.7l1.3-4.1Z" />
          <path d="M7.2 16.7c.2-.6 1-.6 1.2 0l.6 1.9c.1.2.2.3.4.4l1.9.6c.6.2.6 1 0 1.2l-1.9.6c-.2.1-.3.2-.4.4l-.6 1.9c-.2.6-1 .6-1.2 0l-.6-1.9c-.1-.2-.2-.3-.4-.4l-1.9-.6c-.6-.2-.6-1 0-1.2l1.9-.6c.2-.1.3-.2.4-.4l.6-1.9ZM24.1 17.9c.2-.5.9-.5 1.1 0l.5 1.5c.1.2.2.3.4.4l1.5.5c.5.2.5.9 0 1.1l-1.5.5c-.2.1-.3.2-.4.4l-.5 1.5c-.2.5-.9.5-1.1 0l-.5-1.5c-.1-.2-.2-.3-.4-.4l-1.5-.5c-.5-.2-.5-.9 0-1.1l1.5-.5c.2-.1.3-.2.4-.4l.5-1.5Z" />
        </svg>
      </div>

      <div className="mt-6 text-center md:text-left">
        <h2 className="text-[28px] font-black leading-[1.08] text-white">
          Match with
          <span className="block">people here</span>
        </h2>
        <p className="mx-auto mt-4 max-w-[190px] text-[17px] leading-6 text-[#c8c0d4] md:mx-0">
          Meet someone else in this event.
        </p>
      </div>

      <button
        disabled={loading}
        onClick={startEventMatch}
        className="mt-8 flex min-h-16 items-center justify-between rounded-[8px] bg-[#ef2f91] px-5 text-left text-[20px] font-black leading-tight text-white shadow-[0_14px_34px_rgba(239,47,145,0.25)] transition hover:bg-[#ff3aa0] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{loading ? "Opening Match..." : "Match with people here"}</span>
        <span className="text-2xl leading-none">&gt;</span>
      </button>

      <div className="my-7 h-px bg-white/10" />

      <div>
        <h3 className="text-[15px] font-black text-[#b587ff]">How it works</h3>
        <ol className="mt-5 space-y-5 text-[16px] leading-6 text-[#d7d0df]">
          {[
            "Click the button to get matched",
            "We find someone available",
            "Hop into a private 1:1 chat",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#7f3dff] text-xs font-black text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-7 text-[16px] leading-6 text-[#d7d0df]">It&apos;s quick, safe, and fun.</p>
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-red-400/30 bg-red-950/30 p-3 text-sm font-bold text-red-100">
          {error}
        </div>
      )}
    </aside>
  );
}
