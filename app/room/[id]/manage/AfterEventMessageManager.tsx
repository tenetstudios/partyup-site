"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

export default function AfterEventMessageManager({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from("room_recap_messages").select("message").eq("room_id", roomId).maybeSingle().then(({ data }) => setMessage(data?.message || ""));
  }, [roomId, supabase]);

  async function save() {
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_room_recap_message", { p_room_id: roomId, p_message: message });
    setStatus(error ? error.message : message.trim() ? "After-event message saved." : "After-event message removed.");
    setSaving(false);
  }

  return <section className="mt-8 border-t border-white/10 pt-8"><h2 className="text-2xl font-black">After-event message</h2><p className="mt-2 text-sm leading-6 text-zinc-400">A short note that appears in this room&apos;s recap after the event ends.</p><textarea value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="Thanks for coming. See you next time." className="mt-5 min-h-28 w-full resize-y rounded-md border border-white/10 bg-black/30 p-4 text-sm font-semibold text-white outline-none focus:border-[#9146ff]"/><div className="mt-3 flex items-center justify-between gap-4"><span className="text-xs font-bold text-zinc-500">{message.length}/500</span><button type="button" disabled={saving} onClick={() => void save()} className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black disabled:opacity-60">{saving ? "Saving..." : "Save message"}</button></div>{status && <p className="mt-3 text-sm font-bold text-[#c4b5fd]">{status}</p>}</section>;
}
