"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  chatReportReasonLabel,
  getRoomMessageReports,
  reviewRoomMessageReport,
  type ChatReportReviewAction,
  type RoomMessageReport,
} from "@/lib/chatReports";
import { createSupabaseClient } from "@/lib/supabase";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function resolutionLabel(report: RoomMessageReport) {
  switch (report.resolution) {
    case "dismissed": return "Dismissed";
    case "message_removed": return "Message removed";
    case "message_already_removed": return "Message was already removed";
    case "user_muted_5m": return "User muted for 5 minutes";
    default: return "Reviewed";
  }
}

export default function ChatReportInbox({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [isHost, setIsHost] = useState(false);
  const [reports, setReports] = useState<RoomMessageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: hostResult, error: hostError } = await supabase.rpc("is_room_host", {
      p_room_id: roomId,
    });

    if (hostError || !hostResult) {
      setIsHost(false);
      setLoading(false);
      return;
    }

    setIsHost(true);
    setReports(await getRoomMessageReports(supabase, roomId));
    setLoading(false);
  }, [roomId, supabase]);

  useEffect(() => {
    void Promise.resolve().then(load).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Could not load chat reports.");
      setLoading(false);
    });
  }, [load]);

  async function review(report: RoomMessageReport, action: ChatReportReviewAction) {
    const prompts: Record<ChatReportReviewAction, string> = {
      dismiss: "Dismiss this report without taking action?",
      remove_message: "Remove the reported message from the room?",
      mute_5m: "Mute the reported account in this room for 5 minutes?",
    };
    if (!window.confirm(prompts[action])) return;

    setProcessingId(report.id);
    setError(null);
    try {
      await reviewRoomMessageReport(supabase, report.id, action);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not review this report.");
    } finally {
      setProcessingId(null);
    }
  }

  if (!loading && !isHost) return null;

  const openCount = reports.filter((report) => report.status === "open").length;

  return (
    <section id="chat-reports" className="mt-8 border-y border-white/10 bg-[#0d0914] py-6">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">Host inbox</p>
          <h2 className="mt-1 text-xl font-black">Message Reports</h2>
          <p className="mt-2 text-sm text-zinc-400">
            {openCount === 1 ? "1 report needs review." : `${openCount} reports need review.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(processingId)}
          className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-white/10 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="mt-5 space-y-3 px-4">
        {loading ? (
          <p className="text-sm font-bold text-zinc-400">Loading reports...</p>
        ) : reports.length === 0 ? (
          <p className="border-t border-white/10 py-5 text-sm text-zinc-400">No message reports for this room.</p>
        ) : (
          reports.map((report) => (
            <article key={report.id} className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs font-black uppercase tracking-[0.12em] ${report.status === "open" ? "text-amber-300" : "text-zinc-500"}`}>
                  {report.status === "open" ? "Open" : resolutionLabel(report)}
                </span>
                <time className="text-xs text-zinc-500">Reported {formatDate(report.created_at)}</time>
              </div>
              <p className="mt-3 text-sm font-black text-purple-200">
                {chatReportReasonLabel(report.reason)}
              </p>
              <blockquote className="mt-3 border-l-2 border-purple-400/50 pl-3 text-sm leading-6 text-white">
                <span className="block text-xs font-black text-zinc-400">
                  {report.display_name_snapshot || "PartyUp user"} · {formatDate(report.message_created_at)}
                </span>
                <span className="mt-1 block break-words">{report.message_snapshot}</span>
              </blockquote>
              {report.details && (
                <p className="mt-3 rounded-md bg-white/[0.04] px-3 py-2 text-sm leading-6 text-zinc-300">
                  {report.details}
                </p>
              )}
              {report.status === "open" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void review(report, "remove_message")} disabled={processingId === report.id} className="rounded-md bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-500 disabled:opacity-50">
                    Remove message
                  </button>
                  <button type="button" onClick={() => void review(report, "mute_5m")} disabled={processingId === report.id || !report.reported_user_id} className="rounded-md border border-purple-300/30 px-3 py-2 text-xs font-black text-purple-200 hover:bg-purple-400/10 disabled:opacity-50">
                    Mute 5m
                  </button>
                  <button type="button" onClick={() => void review(report, "dismiss")} disabled={processingId === report.id} className="rounded-md border border-white/15 px-3 py-2 text-xs font-black text-zinc-300 hover:bg-white/10 disabled:opacity-50">
                    Dismiss
                  </button>
                </div>
              )}
            </article>
          ))
        )}
        {error && <p className="text-sm font-bold text-red-200">{error}</p>}
      </div>
    </section>
  );
}
