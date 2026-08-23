"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  endRoomMission,
  getActiveRoomMission,
  getMissionCompletedParticipants,
  getMissionOperationsDashboard,
  getRoomMissionHistory,
  publishRoomMission,
  publishAnimalPackMission,
  publishConnectionMission,
  type MissionCompletedParticipants,
  type MissionOperationsDashboard as MissionOperationsData,
  type RoomMission,
  type RoomMissionHistoryItem,
} from "@/lib/roomMissions";
import MissionOperationsDashboard from "./MissionOperationsDashboard";

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
  const [missionType, setMissionType] = useState<"generic" | "animal_pack" | "connection">("generic");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("10");
  const [animalCount, setAnimalCount] = useState("6");
  const [targetEncounters, setTargetEncounters] = useState("3");
  const [targetConnections, setTargetConnections] = useState("3");
  const [hostResults, setHostResults] = useState<MissionCompletedParticipants | null>(null);
  const [operations, setOperations] = useState<MissionOperationsData | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [historyResultsMissionId, setHistoryResultsMissionId] = useState<string | null>(null);
  const [historyResults, setHistoryResults] = useState<MissionCompletedParticipants | null>(null);
  const [historyOperationsMissionId, setHistoryOperationsMissionId] = useState<string | null>(null);
  const [historyOperations, setHistoryOperations] = useState<MissionOperationsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const recommendedParticipants = Number(animalCount) * (Number(targetEncounters) + 1);
  const refreshTimeoutRef = useRef<number | null>(null);
  const missionIdRef = useRef<string | null>(null);

  useEffect(() => {
    missionIdRef.current = mission?.id ?? null;
  }, [mission?.id]);

  const loadData = useCallback(async () => {
    const [nextMission, nextHistory] = await Promise.all([
      getActiveRoomMission(supabase, roomId),
      getRoomMissionHistory(supabase, roomId, 6),
    ]);
    setMission(nextMission);
    setHistory(nextHistory);
    setOperations(
      nextMission && nextMission.mission_type !== "connection"
        ? await getMissionOperationsDashboard(supabase, nextMission.id)
        : null,
    );
  }, [roomId, supabase]);

  const scheduleLoadData = useCallback(() => {
    if (refreshTimeoutRef.current !== null) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void loadData().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not refresh Mission operations.");
      });
    }, 750);
  }, [loadData]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

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

    const refreshCurrentMission = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const changedMissionId = payload.new?.mission_id ?? payload.old?.mission_id;
      if (!changedMissionId || changedMissionId === missionIdRef.current) scheduleLoadData();
    };

    const subscribe = async () => {
      const channelName = `manage-room-missions-${roomId}`;
      const existingChannel = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (existingChannel) await supabase.removeChannel(existingChannel);
      if (!active) return;

      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_missions", filter: `room_id=eq.${roomId}` },
          scheduleLoadData,
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_participant_assignments" }, refreshCurrentMission)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_encounters" }, refreshCurrentMission)
        .on("postgres_changes", { event: "*", schema: "public", table: "mission_completions" }, refreshCurrentMission)
        .subscribe();
    };

    void subscribe().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not subscribe to Mission updates.");
    });

    return () => {
      active = false;
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadData, roomId, scheduleLoadData, supabase]);

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
      if (missionType === "animal_pack") {
        await publishAnimalPackMission(supabase, roomId, {
          animalCount: Number(animalCount),
          targetEncounters: Number(targetEncounters),
          durationMinutes: Number(duration),
        });
      } else if (missionType === "connection") {
        await publishConnectionMission(supabase, roomId, {
          targetConnections: Number(targetConnections),
          durationMinutes: Number(duration || 10),
        });
      } else {
        await publishRoomMission(supabase, roomId, {
          title,
          description,
          durationMinutes: duration ? Number(duration) : null,
        });
      }
      setTitle("");
      setDescription("");
      setDuration("10");
      setTargetConnections("3");
      setMissionType("generic");
      setCreating(false);
      setShowCompleted(false);
      setHostResults(null);
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
      setShowCompleted(false);
      setHostResults(null);
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end the Mission.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistoryResults(missionId: string) {
    if (historyResultsMissionId === missionId) {
      setHistoryResultsMissionId(null);
      setHistoryResults(null);
      return;
    }
    setError(null);
    try {
      setHistoryResults(await getMissionCompletedParticipants(supabase, missionId));
      setHistoryResultsMissionId(missionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load completed participants.");
    }
  }

  async function toggleCompletedResults() {
    if (!mission) return;
    if (showCompleted) {
      setShowCompleted(false);
      return;
    }
    setError(null);
    try {
      setHostResults(await getMissionCompletedParticipants(supabase, mission.id));
      setShowCompleted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load completed participants.");
    }
  }

  async function toggleHistoryOperations(missionId: string) {
    if (historyOperationsMissionId === missionId) {
      setHistoryOperationsMissionId(null);
      setHistoryOperations(null);
      return;
    }
    setError(null);
    try {
      setHistoryOperations(await getMissionOperationsDashboard(supabase, missionId));
      setHistoryOperationsMissionId(missionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load Mission operations.");
    }
  }

  async function loadMoreCompletedResults() {
    if (!mission || !hostResults?.has_more) return;
    const next = await getMissionCompletedParticipants(supabase, mission.id, 100, hostResults.participants.length);
    setHostResults({ ...next, participants: [...hostResults.participants, ...next.participants] });
  }

  async function loadMoreHistoryResults() {
    if (!historyResultsMissionId || !historyResults?.has_more) return;
    const next = await getMissionCompletedParticipants(supabase, historyResultsMissionId, 100, historyResults.participants.length);
    setHistoryResults({ ...next, participants: [...historyResults.participants, ...next.participants] });
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
              {mission.mission_type === "animal_pack" && (
                <span className="text-sm font-black text-purple-200">
                  {operations?.summary.participant_count ?? mission.participant_count} participating
                </span>
              )}
              <span className="text-sm font-black text-pink-200">{operations?.summary.completed_count ?? mission.completion_count} completed</span>
              {mission.ends_at && (
                <span className="text-xs font-bold text-zinc-400">Ends {new Date(mission.ends_at).toLocaleString()}</span>
              )}
            </div>
            <h3 className="mt-3 text-xl font-black">{mission.title}</h3>
            {mission.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mission.description}</p>}
            {operations && <MissionOperationsDashboard dashboard={operations} />}
            {(
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void toggleCompletedResults()}
                  className="rounded-md border border-purple-300/30 px-4 py-2 text-sm font-black text-purple-100 hover:bg-purple-400/10"
                >
                  {showCompleted ? "Hide Completed" : "View Completed"}
                </button>
                {showCompleted && (
                  <div className="mt-3 space-y-2">
                    {(hostResults?.participants ?? []).length === 0 ? (
                      <p className="text-sm text-zinc-400">No completed participants yet.</p>
                    ) : hostResults?.participants.map((person) => (
                      <div key={person.identity_id} className="flex items-center gap-3 rounded-md bg-white/5 p-3">
                        {person.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={person.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-purple-900 font-black">
                            {person.display_name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-black text-white">{person.display_name}</p>
                          <p className="text-xs text-zinc-400">{person.assignment_key ? `${person.assignment_key} | ` : ""}Completed {new Date(person.completed_at).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                    {hostResults?.has_more && <button type="button" onClick={() => void loadMoreCompletedResults()} className="w-full rounded-md border border-white/15 px-3 py-2 text-sm font-black text-zinc-200">Load More ({hostResults.participants.length} of {hostResults.total_count})</button>}
                  </div>
                )}
              </div>
            )}
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
              <span className="mb-1 block text-sm font-black text-purple-300">Mission Type</span>
              <select
                value={missionType}
                onChange={(event) => {
                  const value = event.target.value as "generic" | "animal_pack" | "connection";
                  setMissionType(value);
                  if (value !== "generic" && !duration) setDuration("10");
                }}
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none"
              >
                <option value="generic">Standard Mission</option>
                <option value="animal_pack">Find Your Pack</option>
                <option value="connection">Meet New People</option>
              </select>
            </label>
            {missionType === "generic" ? (
              <>
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
              </>
            ) : missionType === "animal_pack" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-sm font-black text-purple-300">Number of animal groups</span>
                  <select value={animalCount} onChange={(event) => setAnimalCount(event.target.value)} className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none">
                    {[4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-black text-purple-300">People each participant must find</span>
                  <select value={targetEncounters} onChange={(event) => setTargetEncounters(event.target.value)} className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none">
                    {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <div className="rounded-md border border-amber-300/25 bg-amber-950/20 p-3 text-sm leading-5 text-amber-100">
                  For every participant to have enough possible pack members, plan for at least{" "}
                  <strong>{recommendedParticipants} participants</strong>.
                </div>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block text-sm font-black text-purple-300">New people each participant must meet</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    value={targetConnections}
                    onChange={(event) => setTargetConnections(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none"
                  />
                </label>
                <div className="rounded-md border border-purple-300/25 bg-purple-950/20 p-3 text-sm leading-5 text-purple-100">
                  Counts distinct, first-time PartyUp Tap connections made in this room before the timer ends. Choose 1 to 20 people.
                </div>
              </>
            )}
            {missionType === "generic" && <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Description</span>
              <textarea
                value={description}
                maxLength={1000}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Introduce yourself to someone you haven't met yet."
                className="w-full resize-none rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>}
            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Duration</span>
              <select
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none"
              >
                {durations.filter((option) => missionType === "generic" || option.value !== "").map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
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
                <div key={item.id} className="rounded-md bg-black/25 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-white">{item.title}</p>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{historyLabel(item.ended_reason)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black text-zinc-300">{item.completion_count} completed</span>
                      {item.mission_type !== "connection" && <button type="button" onClick={() => void toggleHistoryOperations(item.id)} className="rounded border border-white/15 px-2 py-1 text-xs font-black text-zinc-200">{historyOperationsMissionId === item.id ? "Hide Operations" : "View Operations"}</button>}
                      <button type="button" onClick={() => void toggleHistoryResults(item.id)} className="rounded border border-white/15 px-2 py-1 text-xs font-black text-purple-200">{historyResultsMissionId === item.id ? "Hide" : "View Completed"}</button>
                    </div>
                  </div>
                  {historyOperationsMissionId === item.id && historyOperations && <MissionOperationsDashboard dashboard={historyOperations} />}
                  {historyResultsMissionId === item.id && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      {(historyResults?.participants ?? []).length === 0 ? <p className="text-sm text-zinc-400">No completed participants.</p> : historyResults?.participants.map((person) => (
                        <div key={person.identity_id} className="mt-2 flex justify-between gap-3 text-sm"><span className="font-bold text-white">{person.display_name}{person.assignment_key ? ` | ${person.assignment_key}` : ""}</span><span className="text-zinc-400">{new Date(person.completed_at).toLocaleString()}</span></div>
                      ))}
                      {historyResults?.has_more && <button type="button" onClick={() => void loadMoreHistoryResults()} className="mt-3 w-full rounded-md border border-white/15 px-3 py-2 text-sm font-black text-zinc-200">Load More ({historyResults.participants.length} of {historyResults.total_count})</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
