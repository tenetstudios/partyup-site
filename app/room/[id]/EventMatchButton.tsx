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
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError) {
        throw new Error(userError.message);
      }

      if (!userData.user) {
        throw new Error("Sign in to Match with people here.");
      }

      const pool = await getOrCreateEventMatchPool(supabase, roomId);
      router.push(`/match?pool=${encodeURIComponent(pool.poolId)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start event Match.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black">Match with people here</h2>
          <p className="mt-1 text-sm text-zinc-400">Meet someone else in this event.</p>
        </div>

        <button
          disabled={loading}
          onClick={startEventMatch}
          className="rounded-md bg-pink-500 px-5 py-3 text-sm font-black text-white hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Opening Match..." : "Match with people here"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-400/30 bg-red-950/30 p-3 text-sm font-bold text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
