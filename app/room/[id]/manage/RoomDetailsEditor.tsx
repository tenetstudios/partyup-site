"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

export default function RoomDetailsEditor({ roomId }: { roomId: string }) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadRoom() {
      const supabase = createSupabaseClient();

      const { data } = await supabase
        .from("event_rooms")
        .select("description")
        .eq("id", roomId)
        .single();

      setDescription(data?.description || "");
    }

    loadRoom();
  }, [roomId]);

  async function saveDescription() {
    setSaving(true);

    const supabase = createSupabaseClient();

    const { error } = await supabase
      .from("event_rooms")
      .update({
        description: description.trim() || null,
      })
      .eq("id", roomId);

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Room description saved.");
  }

  return (
    <section id="room-details" className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Room Details</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Edit the description shown on the room page and homepage cards.
        </p>
      </div>

      <div className="space-y-3 p-4">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the room..."
          rows={5}
          className="w-full resize-none rounded-md bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
        />

        <button
          onClick={saveDescription}
          disabled={saving}
          className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Description"}
        </button>
      </div>
    </section>
  );
}
