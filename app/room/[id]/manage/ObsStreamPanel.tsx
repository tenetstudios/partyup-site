"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type ObsKey = {
  ingress_id: string;
  rtmp_url: string;
  stream_key: string;
};

export default function ObsStreamPanel({ roomId }: { roomId: string }) {
  const [obsKey, setObsKey] = useState<ObsKey | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadExistingKey() {
      const supabase = createSupabaseClient();

      const { data } = await supabase
        .from("room_stream_keys")
        .select("ingress_id, rtmp_url, stream_key")
        .eq("room_id", roomId)
        .maybeSingle();

      setObsKey(data);
    }

    loadExistingKey();
  }, [roomId]);

  async function generateObsKey() {
    if (loading) return;

    setLoading(true);

    const supabase = createSupabaseClient();

    const { data: existingKey } = await supabase
      .from("room_stream_keys")
      .select("ingress_id, rtmp_url, stream_key")
      .eq("room_id", roomId)
      .maybeSingle();

    if (existingKey) {
      setObsKey(existingKey);
      setLoading(false);
      return;
    }

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

    const newKey = {
      room_id: roomId,
      ingress_id: data.ingressId,
      rtmp_url: data.rtmpUrl,
      stream_key: data.streamKey,
    };

    const { error: saveError } = await supabase
      .from("room_stream_keys")
      .upsert(newKey, { onConflict: "room_id" });

    if (saveError) {
      alert(saveError.message);
      setLoading(false);
      return;
    }

    setObsKey({
      ingress_id: newKey.ingress_id,
      rtmp_url: newKey.rtmp_url,
      stream_key: newKey.stream_key,
    });

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
                  value={obsKey.rtmp_url}
                  className="min-w-0 flex-1 rounded-md bg-black px-3 py-2 text-sm text-white"
                />
                <button
                  onClick={() => copyText(obsKey.rtmp_url)}
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
                  value={obsKey.stream_key}
                  className="min-w-0 flex-1 rounded-md bg-black px-3 py-2 text-sm text-white"
                />
                <button
                  onClick={() => copyText(obsKey.stream_key)}
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