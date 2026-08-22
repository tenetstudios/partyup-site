"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  endRoomMission,
  getActiveRoomMission,
  getRoomMissionHistory,
  publishRoomMission,
  type RoomMission,
  type RoomMissionHistoryItem,
} from "@/lib/roomMissions";

const durations = [
  { label: "No automatic expiry", value: "" },
  { label: "5 minutes", value: "5" },
  { label: "10 minutes", value: "10" },
  { label: "15 minutes", value: "15" },
  { label: "30 minutes", value: "30" },
];

function historyLabel(reason: RoomMissionHistoryItem["ended_reason"]) {
  if (reason === "expired") return "Expired";
  if (reason === "room_ended") return "Room ended";
  if (reason === "replaced") return "Replaced";
  return "Ended";
}

export default function RoomMissionManager({
  roomId,
  roomEnded = false,
}: {
  roomId: string;
  roomEnded?: boolean;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [isHost, setIsHost] = useState(false);
  const [mission, setMission] = useState<RoomMission | null>(null);
  const [history, setHistory] = useState<RoomMissionHistoryItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [nextMission, nextHistory] = await Promise.all([
      getActiveRoomMission(supabase, roomId),
      getRoomMissionHistory(supabase, roomId, 6),
    ]);
    setMission(nextMission);
    setHistory(nextHistory);
  }, [roomId, supabase]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const { data, error: hostError } = await supabase.rpc("is_room_host", {
        p_room_id: roomId,
      });

      if (!active || hostError || !data) {
        return;
      }

      setIsHost(true);
      await loadData();
    }

    initialize().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Could not load Missions.");
    });

    const channel = supabase
      .channel(`manage-room-missions-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mission_completions" },
        () => void loadData(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [loadData, roomId, supabase]);

  useEffect(() => {
    if (!mission?.ends_at) return;

    const timeout = window.setTimeout(
      () => void loadData(),
      Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250,
    );

    return () => window.clearTimeout(timeout);
  }, [loadData, mission?.ends_at]);

  if (!isHost) {
    return null;
  }

  async function publish() {
    if (busy) return;

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await publishRoomMission(supabase, roomId, {
        title,
        description,
        durationMinutes: duration ? Number(duration) : null,
      });
      setTitle("");
      setDescription("");
      setDuration("10");
      setCreating(false);
      setSuccess(mission ? "The previous Mission ended and the new Mission is active." : "Mission published.");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish the Mission.");
    } finally {
      setBusy(false);
    }
  }

  async function endActiveMission() {
    if (!mission || busy || !window.confirm("End this Mission for everyone in the room?")) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await endRoomMission(supabase, mission.id);
      setSuccess("Mission ended.");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end the Mission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="missions" className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Missions</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Give the room one clear real-world action. Publishing a new Mission ends the current one.
        </p>
      </div>

      <div className="space-y-4 p-4">
        {(error || success) && (
          <div className={`rounded-md border p-3 text-sm font-bold ${error ? "border-red-400/30 bg-red-950/30 text-red-100" : "border-green-400/30 bg-green-950/30 text-green-100"}`}>
            {error ?? success}
          </div>
        )}

        {mission && (
          <div className="rounded-lg bg-black/30 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded bg-emerald-700 px-2 py-1 text-xs font-black uppercase text-white">Active</span>
              <span className="text-sm font-black text-pink-200">{mission.completion_count} completed</span>
              {mission.ends_at && (
                <span className="text-xs font-bold text-zinc-400">Ends {new Date(mission.ends_at).toLocaleString()}</span>
              )}
            </div>
            <h3 className="mt-3 text-xl font-black">{mission.title}</h3>
            {mission.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mission.description}</p>}
            <button
              type="button"
              onClick={endActiveMission}
              disabled={busy}
              className="mt-4 rounded-md border border-red-500/40 px-4 py-2 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:opacity-50"
            >
              End Mission
            </button>
          </div>
        )}

        {!roomEnded && !creating ? (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setError(null);
              setSuccess(null);
            }}
            className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8]"
          >
            {mission ? "Create Replacement Mission" : "Create Mission"}
          </button>
        ) : !roomEnded ? (
          <div className="space-y-3 rounded-lg bg-black/30 p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Mission title *</span>
              <input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Meet someone new"
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Description</span>
              <textarea
                value={description}
                maxLength={1000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Introduce yourself to someone you haven't met yet."
                className="w-full resize-none rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Duration</span>
              <select
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none"
              >
                {durations.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={publish}
                disabled={busy}
                className="rounded-md bg-[#ef2f82] px-4 py-2 text-sm font-black text-white hover:bg-[#d92773] disabled:opacity-50"
              >
                {busy ? "Publishing..." : "Publish Mission"}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={busy}
                className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {history.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <h3 className="text-sm font-black uppercase text-zinc-400">Past Missions</h3>
            <div className="mt-3 space-y-2">
              {history.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/25 px-3 py-3">
                  <div>
                    <p className="font-black text-white">{item.title}</p>
                    <p className="mt-1 text-xs font-bold text-zinc-500">{historyLabel(item.ended_reason)}</p>
                  </div>
                  <span className="text-sm font-black text-zinc-300">{item.completion_count} completed</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
