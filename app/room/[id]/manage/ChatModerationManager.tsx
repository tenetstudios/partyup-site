"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getRoomModerationSettings,
  setRoomModerationSettings,
  type ChatLinksMode,
  type ChatModerationPreset,
  type RoomModerationSettings,
} from "@/lib/chatModeration";

const presetOptions: Array<{
  value: ChatModerationPreset;
  label: string;
  description: string;
}> = [
  { value: "relaxed", label: "Relaxed", description: "Normal conversation with duplicate-spam protection." },
  { value: "social", label: "Social", description: "Adds a 5-second slow mode for busier rooms." },
  { value: "host_only", label: "Host Only", description: "Only hosts and bouncers can post." },
];

const linkOptions: Array<{ value: ChatLinksMode; label: string }> = [
  { value: "everyone", label: "Everyone" },
  { value: "hosts_only", label: "Hosts & bouncers only" },
];

export default function ChatModerationManager({ roomId }: { roomId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [isHost, setIsHost] = useState(false);
  const [settings, setSettings] = useState<RoomModerationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [{ data: hostResult }, nextSettings] = await Promise.all([
      supabase.rpc("is_room_host", { p_room_id: roomId }),
      getRoomModerationSettings(supabase, roomId),
    ]);
    setIsHost(Boolean(hostResult));
    setSettings(nextSettings);
  }, [roomId, supabase]);

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not load chat moderation settings.");
      });
  }, [load]);

  async function save(preset: ChatModerationPreset, linksMode: ChatLinksMode) {
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      setSettings(await setRoomModerationSettings(supabase, roomId, preset, linksMode));
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save chat moderation settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!isHost || !settings) return null;

  return (
    <section id="chat-moderation" className="mt-8 rounded-xl border border-purple-300/25 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-purple-300">Host control</p>
        <h2 className="mt-1 text-xl font-black">Chat Moderation</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Ordinary profanity is allowed. These controls focus on spam and room management.
        </p>
      </div>

      <div className="space-y-6 p-4">
        <fieldset disabled={saving}>
          <legend className="text-sm font-black text-purple-200">Preset</legend>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {presetOptions.map((option) => {
              const selected = settings.preset === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void save(option.value, settings.links_mode)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-purple-300 bg-[#7c3aed] text-white shadow-[0_8px_24px_rgba(124,58,237,0.32)]"
                      : "border-white/10 bg-black/25 text-zinc-200 hover:border-purple-300/50 hover:bg-purple-400/10"
                  }`}
                >
                  <span className="block font-black">{option.label}</span>
                  <span className={`mt-1 block text-xs leading-5 ${selected ? "text-purple-100" : "text-zinc-400"}`}>
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset disabled={saving}>
          <legend className="text-sm font-black text-purple-200">Links</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {linkOptions.map((option) => {
              const selected = settings.links_mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void save(settings.preset, option.value)}
                  className={`rounded-full border px-5 py-2.5 text-sm font-black transition ${
                    selected
                      ? "border-purple-300 bg-[#7c3aed] text-white"
                      : "border-white/15 text-zinc-300 hover:border-purple-300/50 hover:bg-purple-400/10"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {saving && <p className="text-sm font-bold text-purple-200">Saving moderation settings...</p>}
        {saved && !saving && <p className="text-sm font-bold text-emerald-200">Chat moderation updated.</p>}
        {error && <p className="text-sm font-bold text-red-200">{error}</p>}
      </div>
    </section>
  );
}
