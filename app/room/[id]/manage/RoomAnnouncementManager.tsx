"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  endRoomAnnouncement,
  getActiveRoomAnnouncement,
  publishRoomAnnouncement,
  updateRoomAnnouncement,
  type RoomAnnouncement,
} from "@/lib/roomAnnouncements";

type FormState = {
  title: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
  expiresAt: string;
};

const emptyForm: FormState = {
  title: "",
  message: "",
  ctaLabel: "",
  ctaUrl: "",
  expiresAt: "",
};

function toDatetimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function formFromAnnouncement(announcement: RoomAnnouncement): FormState {
  return {
    title: announcement.title,
    message: announcement.message ?? "",
    ctaLabel: announcement.cta_label ?? "",
    ctaUrl: announcement.cta_url ?? "",
    expiresAt: toDatetimeLocal(announcement.expires_at),
  };
}

function StatusMessage({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) {
    return null;
  }

  return (
    <div
      className={`rounded-md border p-3 text-sm font-bold ${
        error
          ? "border-red-400/30 bg-red-950/30 text-red-100"
          : "border-green-400/30 bg-green-950/30 text-green-100"
      }`}
    >
      {error ?? success}
    </div>
  );
}

export default function RoomAnnouncementManager({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [announcement, setAnnouncement] = useState<RoomAnnouncement | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAnnouncement = useCallback(async () => {
    const nextAnnouncement = await getActiveRoomAnnouncement(supabase, roomId);
    setAnnouncement(nextAnnouncement);
  }, [roomId, supabase]);

  const loadHostState = useCallback(async () => {
    const { data, error: hostError } = await supabase.rpc("is_room_host", {
      p_room_id: roomId,
    });

    if (hostError) {
      setIsHost(false);
      return;
    }

    setIsHost(Boolean(data));
  }, [roomId, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => {
      loadHostState();
      loadAnnouncement().catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not load announcement.");
      });
    });

    const channel = supabase
      .channel(`manage-room-announcements-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_announcements",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          loadAnnouncement().catch((reason) => {
            setError(reason instanceof Error ? reason.message : "Could not load announcement.");
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAnnouncement, loadHostState, roomId, supabase]);

  if (!isHost) {
    return null;
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setSuccess(null);
  }

  function startCreate() {
    setMode("create");
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
  }

  function startEdit() {
    if (!announcement) {
      return;
    }

    setMode("edit");
    setForm(formFromAnnouncement(announcement));
    setError(null);
    setSuccess(null);
  }

  function cancelForm() {
    setMode("idle");
    setForm(emptyForm);
    setError(null);
  }

  async function saveAnnouncement() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const input = {
        title: form.title,
        message: form.message,
        ctaLabel: form.ctaLabel,
        ctaUrl: form.ctaUrl,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : "",
      };

      const saved =
        mode === "edit" && announcement
          ? await updateRoomAnnouncement(supabase, announcement.id, input)
          : await publishRoomAnnouncement(supabase, roomId, input);

      setAnnouncement(saved);
      setMode("idle");
      setForm(emptyForm);
      setSuccess(mode === "edit" ? "Announcement updated." : "Announcement published.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function endAnnouncement() {
    if (!announcement || busy) {
      return;
    }

    const confirmed = window.confirm("End this announcement?");

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await endRoomAnnouncement(supabase, announcement.id);
      setAnnouncement(null);
      setMode("idle");
      setSuccess("Announcement ended.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end announcement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="announcements" className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Announcements</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Share timely room updates with everyone currently viewing this room.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <StatusMessage error={error} success={success} />

        {mode === "idle" && !announcement && (
          <div className="flex flex-col gap-4 rounded-lg bg-black/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold text-zinc-400">No active announcement</p>
            <button
              type="button"
              onClick={startCreate}
              className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8]"
            >
              Create Announcement
            </button>
          </div>
        )}

        {mode === "idle" && announcement && (
          <div className="rounded-lg bg-black/30 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="rounded bg-green-600 px-2 py-1 text-xs font-black uppercase text-white">
                Active
              </span>
              {announcement.expires_at && (
                <span className="text-xs font-bold text-zinc-400">
                  Expires {new Date(announcement.expires_at).toLocaleString()}
                </span>
              )}
            </div>

            <h3 className="text-xl font-black">{announcement.title}</h3>
            {announcement.message && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                {announcement.message}
              </p>
            )}
            {announcement.cta_label && announcement.cta_url && (
              <p className="mt-3 text-sm font-bold text-purple-300">
                CTA: {announcement.cta_label} -&gt; {announcement.cta_url}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startEdit}
                className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={endAnnouncement}
                disabled={busy}
                className="rounded-md border border-red-500/40 px-4 py-2 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:opacity-50"
              >
                End Announcement
              </button>
            </div>
          </div>
        )}

        {mode !== "idle" && (
          <div className="space-y-3 rounded-lg bg-black/30 p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Title *</span>
              <input
                value={form.title}
                maxLength={120}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="DJ starts in 10 minutes"
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Message</span>
              <textarea
                value={form.message}
                maxLength={500}
                rows={4}
                onChange={(event) => updateField("message", event.target.value)}
                placeholder="Main stage - stay close."
                className="w-full resize-none rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-black text-purple-300">CTA label</span>
                <input
                  value={form.ctaLabel}
                  maxLength={40}
                  onChange={(event) => updateField("ctaLabel", event.target.value)}
                  placeholder="Learn More"
                  className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-black text-purple-300">CTA URL</span>
                <input
                  value={form.ctaUrl}
                  maxLength={500}
                  onChange={(event) => updateField("ctaUrl", event.target.value)}
                  placeholder="https://partyup.example"
                  className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-black text-purple-300">Expires at</span>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) => updateField("expiresAt", event.target.value)}
                className="w-full rounded-md bg-black px-3 py-3 text-sm text-white outline-none"
              />
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={saveAnnouncement}
                disabled={busy}
                className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8] disabled:opacity-50"
              >
                {busy
                  ? "Saving..."
                  : mode === "edit"
                    ? "Save Announcement"
                    : "Publish Announcement"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                disabled={busy}
                className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
