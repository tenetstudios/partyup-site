"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

export default function AfterEventMessageManager({ roomId, roomEnded }: { roomId: string; roomEnded: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from("room_recap_messages").select("message").eq("room_id", roomId).maybeSingle().then(({ data }) => setMessage(data?.message || ""));
  }, [roomId, supabase]);

  async function save(successMessage = true) {
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc("set_room_recap_message", { p_room_id: roomId, p_message: message });
    setSaving(false);
    if (error) {
      setStatus(error.message);
      return false;
    }
    if (successMessage) {
      setStatus(message.trim() ? "After-event message saved." : "After-event message removed.");
    }
    return true;
  }

  async function endEvent() {
    if (ending || saving) return;

    const confirmed = window.confirm(
      "Save this after-event message and end the event? The room will become read-only while Memories, recaps, attendance, and Event Series history are kept.",
    );
    if (!confirmed) return;

    setEnding(true);
    const saved = await save(false);
    if (!saved) {
      setEnding(false);
      return;
    }

    await supabase.functions.invoke("delete-ingress", { body: { roomName: roomId } }).catch(() => undefined);
    const { error } = await supabase.functions.invoke("end-event-room", { body: { roomId } });
    if (error) {
      setStatus(error.message);
      setEnding(false);
      return;
    }

    router.push(`/room/${roomId}`);
    router.refresh();
  }

  return (
    <section id="event-closeout" className="mt-10 rounded-xl border border-purple-300/25 bg-purple-950/20 p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">Final step</p>
      <h2 className="mt-2 text-2xl font-black">Event closeout</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        Leave guests a note in their recap, then end the event when the room is finished.
      </p>

      <label className="mt-5 block text-sm font-black text-purple-200" htmlFor="after-event-message">
        After-event message <span className="font-semibold text-zinc-500">(optional)</span>
      </label>
      <textarea
        id="after-event-message"
        value={message}
        maxLength={500}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Thanks for coming. See you next time."
        className="mt-2 min-h-28 w-full resize-y rounded-lg border border-white/10 bg-black/30 p-4 text-sm font-semibold text-white outline-none focus:border-[#9146ff]"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <span className="text-xs font-bold text-zinc-500">{message.length}/500</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || ending}
            onClick={() => void save()}
            className="rounded-full border border-purple-300/40 px-5 py-2.5 text-sm font-black text-purple-100 hover:bg-purple-400/10 disabled:opacity-60"
          >
            {saving && !ending ? "Saving..." : roomEnded ? "Save message" : "Save draft"}
          </button>
          {!roomEnded && (
            <button
              type="button"
              disabled={saving || ending}
              onClick={() => void endEvent()}
              className="rounded-full bg-[#7c3aed] px-5 py-2.5 text-sm font-black text-white shadow-[0_8px_24px_rgba(124,58,237,0.38)] hover:bg-[#9146ff] disabled:opacity-60"
            >
              {ending ? "Saving & ending..." : message.trim() ? "Save message & end event" : "End event"}
            </button>
          )}
        </div>
      </div>
      {roomEnded && <p className="mt-4 text-sm font-bold text-emerald-200">This event has ended. You can still update its recap message.</p>}
      {status && <p className="mt-3 text-sm font-bold text-[#c4b5fd]">{status}</p>}
    </section>
  );
}
