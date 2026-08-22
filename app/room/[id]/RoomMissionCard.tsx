"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  completeRoomMission,
  getActiveRoomMission,
  getMissionTimeRemaining,
  type RoomMission,
} from "@/lib/roomMissions";

export default function RoomMissionCard({
  roomId,
  initialMission,
}: {
  roomId: string;
  initialMission: RoomMission | null;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [mission, setMission] = useState(initialMission);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const loadMission = useCallback(async () => {
    const nextMission = await getActiveRoomMission(supabase, roomId);
    setMission(nextMission);
    setError(null);

    if (!nextMission) {
      setExpanded(false);
    }
  }, [roomId, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setNow(Date.now());
      loadMission().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not load the Mission.");
      });
    });

    const channel = supabase
      .channel(`room-missions-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
        () => void loadMission(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mission_completions" },
        () => void loadMission(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadMission, roomId, supabase]);

  useEffect(() => {
    if (!mission?.ends_at) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    const timeout = window.setTimeout(
      () => void loadMission(),
      Math.max(0, Date.parse(mission.ends_at) - Date.now()) + 250,
    );

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [loadMission, mission?.ends_at]);

  if (!mission) {
    return null;
  }

  const remaining = now ? getMissionTimeRemaining(mission.ends_at, now) : null;

  async function markComplete() {
    const missionToComplete = mission;

    if (busy || !missionToComplete || missionToComplete.viewer_completed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await completeRoomMission(supabase, missionToComplete.id);
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not complete the Mission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[10px] border border-pink-300/25 bg-[#171020] px-5 py-4 shadow-[0_14px_38px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#ef2f82] px-2 py-1 text-[11px] font-black uppercase text-white">
              New Mission
            </span>
            {remaining && (
              <span className="text-xs font-black text-pink-200">
                {remaining.expired ? "Ending..." : `${remaining.label} remaining`}
              </span>
            )}
            {mission.viewer_completed && (
              <span className="text-xs font-black uppercase text-emerald-300">Completed</span>
            )}
          </div>
          <h2 className="mt-2 text-xl font-black text-white">{mission.title}</h2>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="min-h-11 shrink-0 rounded-md border border-white/15 px-4 text-sm font-black text-white hover:bg-white/10"
        >
          {expanded ? "Close" : "View Mission"}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {mission.description && (
            <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {mission.description}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={markComplete}
              disabled={busy || mission.viewer_completed || Boolean(remaining?.expired)}
              className={`min-h-11 rounded-md px-5 text-sm font-black text-white disabled:cursor-not-allowed ${
                mission.viewer_completed ? "bg-emerald-700" : "bg-[#ef2f82] hover:bg-[#d92773] disabled:opacity-50"
              }`}
            >
              {mission.viewer_completed ? "Completed" : busy ? "Completing..." : "Mark Complete"}
            </button>
            {mission.can_manage && (
              <span className="text-sm font-bold text-zinc-400">
                {mission.completion_count} completed
              </span>
            )}
          </div>

          {error && <p className="mt-3 text-sm font-bold text-red-300">{error}</p>}
        </div>
      )}
    </section>
  );
}
