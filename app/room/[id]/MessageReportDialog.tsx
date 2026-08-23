"use client";

import { useEffect, useMemo, useState } from "react";
import {
  chatReportReasons,
  submitRoomMessageReport,
  type ChatReportReason,
} from "@/lib/chatReports";
import { createSupabaseClient } from "@/lib/supabase";

type ReportableMessage = {
  id: string;
  display_name: string | null;
  message: string;
};

export default function MessageReportDialog({
  message,
  onClose,
  onReported,
}: {
  message: ReportableMessage;
  onClose: () => void;
  onReported: (messageId: string) => void;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [reason, setReason] = useState<ChatReportReason | "">("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [message, onClose, submitting]);

  async function submit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await submitRoomMessageReport(supabase, message.id, reason, details);
      onReported(message.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit this report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="message-report-title" className="w-full max-w-lg rounded-lg border border-white/15 bg-[#120c1c] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-300">Room safety</p>
            <h3 id="message-report-title" className="mt-1 text-xl font-black text-white">Report message</h3>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close report dialog" title="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/15 text-xl text-zinc-300 hover:bg-white/10 disabled:opacity-50">
            ×
          </button>
        </div>

        <blockquote className="mt-4 border-l-2 border-purple-400/50 pl-3 text-sm leading-6 text-zinc-200">
          <span className="block text-xs font-black text-zinc-500">{message.display_name || "PartyUp user"}</span>
          <span className="mt-1 block max-h-24 overflow-y-auto break-words">{message.message}</span>
        </blockquote>

        <label className="mt-5 block text-sm font-black text-white" htmlFor="message-report-reason">
          Reason
        </label>
        <select
          id="message-report-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as ChatReportReason | "")}
          autoFocus
          className="mt-2 w-full rounded-md border border-white/15 bg-[#09060e] px-3 py-3 text-sm text-white outline-none focus:border-purple-300"
        >
          <option value="">Choose a reason</option>
          {chatReportReasons.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-black text-white" htmlFor="message-report-details">
          Additional details <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="message-report-details"
          value={details}
          onChange={(event) => setDetails(event.target.value.slice(0, 500))}
          rows={4}
          maxLength={500}
          className="mt-2 w-full resize-y rounded-md border border-white/15 bg-[#09060e] px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-purple-300"
          placeholder="Add context for the room host"
        />
        <p className="mt-1 text-right text-xs text-zinc-600">{details.length}/500</p>

        {error && <p className="mt-3 text-sm font-bold text-red-200">{error}</p>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-white/15 px-4 py-2.5 text-sm font-black text-zinc-300 hover:bg-white/10 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={!reason || submitting} className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">
            {submitting ? "Submitting..." : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
