"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type ClearRoomResult = {
  removed_count?: number;
};

const confirmationText = "CLEAR";
const messageLimit = 500;

export default function ClearRoomPanel({
  roomId,
  hostId,
}: {
  roomId: string;
  hostId: string;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [participantCount, setParticipantCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadParticipantCount = useCallback(async () => {
    const { count, error: countError } = await supabase
      .from("event_attendees")
      .select("user_id", { count: "exact", head: true })
      .eq("event_room_id", roomId)
      .neq("user_id", hostId);

    if (!countError) setParticipantCount(count ?? 0);
  }, [hostId, roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void loadParticipantCount());

    const channel = supabase
      .channel(`clear-room-count-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_attendees",
          filter: `event_room_id=eq.${roomId}`,
        },
        () => void loadParticipantCount(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadParticipantCount, roomId, supabase]);

  function closeDialog() {
    if (clearing) return;
    setOpen(false);
    setConfirmation("");
    setError(null);
  }

  async function clearRoom() {
    if (clearing || confirmation !== confirmationText) return;

    setClearing(true);
    setError(null);
    setSuccess(null);

    const { data, error: clearError } = await supabase.rpc("clear_event_room", {
      p_room_id: roomId,
      p_message: message.trim() || null,
    });

    if (clearError) {
      setError(clearError.message);
      setClearing(false);
      return;
    }

    const result = data as ClearRoomResult | null;
    const removedCount = result?.removed_count ?? 0;
    setParticipantCount(0);
    setOpen(false);
    setMessage("");
    setConfirmation("");
    setClearing(false);
    setSuccess(
      removedCount === 1
        ? "Room cleared — 1 participant removed."
        : `Room cleared — ${removedCount} participants removed.`,
    );
  }

  return (
    <section className="mt-10 border-t border-amber-300/20 pt-6">
      <h2 className="text-lg font-black text-amber-100">Clear participants</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        Remove everyone except the host while keeping this room, its settings, chat, Missions,
        announcements, and Memories. Waiting participants are removed too.
      </p>
      <p className="mt-2 text-sm font-bold text-zinc-300">
        {participantCount === 1
          ? "1 participant is currently eligible for removal."
          : `${participantCount} participants are currently eligible for removal.`}
      </p>

      {success && (
        <p role="status" className="mt-4 rounded-md border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-100">
          {success}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setSuccess(null);
          setOpen(true);
        }}
        className="mt-4 rounded-md border border-amber-300/40 px-6 py-3 font-black text-amber-100 hover:bg-amber-400/10"
      >
        Clear participants
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-room-title"
            className="w-full max-w-xl rounded-[12px] border border-amber-300/30 bg-[#12051e] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.65)]"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
              This cannot be undone
            </p>
            <h3 id="clear-room-title" className="mt-2 text-2xl font-black text-white">
              Clear {participantCount} {participantCount === 1 ? "participant" : "participants"}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Everyone except you will lose room access and be disconnected from active streams
              and event matching. The room itself and its content will remain.
            </p>

            <label className="mt-5 block text-sm font-black text-white" htmlFor="clear-room-message">
              Message to participants <span className="font-medium text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="clear-room-message"
              value={message}
              maxLength={messageLimit}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Thanks for joining! We’ll share details for the next event soon."
              rows={4}
              className="mt-2 w-full resize-y rounded-md border border-white/15 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-300/60"
            />
            <p className="mt-1 text-right text-xs text-zinc-500">
              {message.length}/{messageLimit}
            </p>

            <label className="mt-4 block text-sm font-black text-white" htmlFor="clear-room-confirmation">
              Type <span className="text-amber-300">{confirmationText}</span> to confirm
            </label>
            <input
              id="clear-room-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-white/15 bg-black/30 px-3 py-3 text-sm font-black text-white outline-none focus:border-amber-300/60"
            />

            {error && (
              <p role="alert" className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm font-bold text-red-100">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={clearing}
                className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void clearRoom()}
                disabled={clearing || confirmation !== confirmationText}
                className="rounded-md bg-amber-400 px-4 py-2 text-sm font-black text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {clearing ? "Clearing room..." : "Clear participants"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
