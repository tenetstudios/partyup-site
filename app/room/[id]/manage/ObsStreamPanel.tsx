"use client";

import { useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type ObsKey = {
  ingressId: string;
  rtmpUrl: string;
  streamKey: string;
};

export default function ObsStreamPanel({ roomId }: { roomId: string }) {
  const [obsKey, setObsKey] = useState<ObsKey | null>(null);
  const [loading, setLoading] = useState(false);

  async function generateObsKey() {
    if (loading) return;

    setLoading(true);

    const supabase = createSupabaseClient();

    const { data, error } = await supabase.functions.invoke(
      "create-obs-stream",
      {
        body: {
          roomName: roomId,
          participantName: "OBS Stream",
        },
      },
    );

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    setObsKey(data as ObsKey);
    setLoading(false);
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    alert("Copied");
  }

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">OBS Streaming</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Stream from OBS directly into this PartyUp room.
        </p>
      </div>

      <div className="space-y-4 p-4">
        {!obsKey ? (
          <button
            onClick={generateObsKey}
            disabled={loading}
            className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8] disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate OBS Key"}
          </button>
        ) : (
          <>
            <div>
              <p className="mb-1 text-xs font-black uppercase text-zinc-500">
                RTMP URL
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={obsKey.rtmpUrl}
                  className="min-w-0 flex-1 rounded-md bg-black px-3 py-2 text-sm text-white"
                />
                <button
                  onClick={() => copyText(obsKey.rtmpUrl)}
                  className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-black uppercase text-zinc-500">
                Stream Key
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={obsKey.streamKey}
                  className="min-w-0 flex-1 rounded-md bg-black px-3 py-2 text-sm text-white"
                />
                <button
                  onClick={() => copyText(obsKey.streamKey)}
                  className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10"
                >
                  Copy
                </button>
              </div>
            </div>

            <p className="text-xs text-zinc-500">
              In OBS: Settings → Stream → Service: Custom → paste the RTMP URL
              and Stream Key.
            </p>
          </>
        )}
      </div>
    </section>
  );
}