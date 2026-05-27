"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type ChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  message: string;
  created_at: string;
  display_name: string | null;
};

export default function RoomChat({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseClient();

    async function loadMessages() {
      const { data } = await supabase
        .from("room_messages")
        .select("id, room_id, user_id, message, created_at, display_name")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(100);

      setMessages((data ?? []) as ChatMessage[]);
    }

    loadMessages();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setMessages((current) => [
            ...current,
            payload.new as ChatMessage,
          ]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  async function sendMessage() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);

    const supabase = createSupabaseClient();

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      alert("Sign in to chat.");
      setSending(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    const { error } = await supabase.from("room_messages").insert({
      room_id: roomId,
      user_id: user.id,
      message: trimmed,
      display_name: profile?.username || "Guest",
    });

    if (error) {
      alert(error.message);
      setSending(false);
      return;
    }

    setText("");
    setSending(false);
  }

  return (
    <section className="mt-6 rounded-xl border border-white/10 bg-[#0b0213]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="font-black">Live Chat</h2>
      </div>

      <div className="flex h-72 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">No messages yet.</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="text-sm">
              <span className="font-black text-purple-300">
                {msg.display_name || "Guest"}:
              </span>{" "}
              <span className="text-zinc-200">{msg.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 border-t border-white/10 p-3">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") sendMessage();
          }}
          placeholder="Send a message..."
          className="min-w-0 flex-1 rounded-md bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
        />

        <button
          onClick={sendMessage}
          disabled={sending}
          className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black hover:bg-[#7b31e8] disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </section>
  );
}