"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { friendlyChatError } from "@/lib/chatModeration";

type ChatMessage = {
  id: string;
  room_id: string;
  user_id: string | null;
  message: string;
  created_at: string;
  display_name: string | null;
  removed_at?: string | null;
};

function messageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function avatarTone(seed: string) {
  const tones = [
    "from-[#7c3dff] to-[#9a62ff]",
    "from-[#f03291] to-[#ff6aa9]",
    "from-[#2bbd66] to-[#5fd083]",
    "from-[#d8a800] to-[#ffd233]",
    "from-[#19b8c9] to-[#39d8e7]",
  ];
  const total = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return tones[total % tones.length];
}

export default function RoomChat({
  roomId,
  onlineCount = 0,
  hostId,
}: {
  roomId: string;
  onlineCount?: number;
  hostId?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canRemoveMessages, setCanRemoveMessages] = useState(false);
  const [canMuteUsers, setCanMuteUsers] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;

    const scrollToLatest = () => {
      messageList.scrollTop = messageList.scrollHeight;
    };

    scrollToLatest();
    const animationFrame = window.requestAnimationFrame(scrollToLatest);
    const settledLayoutTimer = window.setTimeout(scrollToLatest, 100);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(settledLayoutTimer);
    };
  }, [messages]);

  useEffect(() => {
    const supabase = createSupabaseClient();

    async function loadMessages() {
      const { data } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(100);

      setMessages(
        ((data ?? []) as ChatMessage[])
          .filter((message) => !message.removed_at)
          .reverse(),
      );
    }

    async function loadModeratorState() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setCurrentUserId(user?.id ?? null);

      if (!user) return;
      const isHost = hostId === user.id;
      const { data: attendee } = await supabase
        .from("event_attendees")
        .select("room_role, status")
        .eq("event_room_id", roomId)
        .eq("user_id", user.id)
        .maybeSingle();
      const isBouncer = attendee?.status === "accepted" && ["bouncer", "admin"].includes(attendee.room_role || "");
      setCanRemoveMessages(isHost || isBouncer);
      setCanMuteUsers(isHost);
    }

    void loadMessages();
    void loadModeratorState();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => void loadMessages(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hostId, roomId]);

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

    const { error } = await supabase.rpc("send_room_message", {
      p_room_id: roomId,
      p_message: trimmed,
    });

    if (error) {
      alert(friendlyChatError(error.message));
      setSending(false);
      return;
    }

    setText("");
    setSending(false);
  }

  async function moderateMessage(message: ChatMessage, action: "remove" | "mute_5m") {
    const prompt = action === "remove"
      ? "Remove this message from the room?"
      : "Mute this person in this room for 5 minutes?";
    if (!window.confirm(prompt)) return;

    const supabase = createSupabaseClient();
    const { error } = await supabase.rpc("moderate_room_message", {
      p_message_id: message.id,
      p_action: action,
    });

    if (error) {
      alert(error.message);
      return;
    }

    if (action === "remove") {
      setMessages((current) => current.filter((item) => item.id !== message.id));
    }
  }

  return (
    <section className="flex h-[640px] min-h-[480px] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[10px] border border-white/10 bg-[linear-gradient(180deg,rgba(19,13,29,0.96),rgba(8,5,14,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="flex shrink-0 items-start justify-between px-6 py-6">
        <div>
          <h2 className="text-[22px] font-black leading-none text-white">Room Chat</h2>
          <div className="mt-3 flex items-center gap-2 text-sm text-[#aaa4b8]">
            <span className="h-2 w-2 rounded-full bg-[#19e68c]" />
            <span>{onlineCount} online</span>
          </div>
        </div>
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#a675ff]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>

      <div
        ref={messageListRef}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-4 pt-4"
      >
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-white/10 bg-black/15 p-6 text-center text-sm text-[#aaa4b8]">
            No messages yet.
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="grid grid-cols-[44px_1fr] gap-x-3 text-sm">
              <time className="pt-1 text-[11px] font-bold uppercase text-[#aaa4b8]">
                {messageTime(msg.created_at)}
              </time>
              <div className="flex min-w-0 gap-3">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarTone(msg.user_id || msg.display_name || msg.id)} text-sm font-black text-white`}>
                  {(msg.display_name || "Guest").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-black text-[#d4b6ff]">
                      {msg.display_name || "Guest"}
                    </span>
                    {hostId && msg.user_id === hostId && (
                      <span className="rounded-full bg-[#7f3dff]/20 px-2 py-0.5 text-[11px] font-black text-[#b587ff]">
                        Host
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-words text-[16px] leading-6 text-white">{msg.message}</p>
                  {canRemoveMessages && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void moderateMessage(msg, "remove")}
                        className="rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-black text-red-200 hover:bg-red-400/10"
                      >
                        Remove
                      </button>
                      {canMuteUsers && msg.user_id && msg.user_id !== currentUserId && msg.user_id !== hostId && (
                        <button
                          type="button"
                          onClick={() => void moderateMessage(msg, "mute_5m")}
                          className="rounded-full border border-purple-300/30 px-3 py-1 text-[11px] font-black text-purple-200 hover:bg-purple-400/10"
                        >
                          Mute 5m
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 p-4">
        <div className="rounded-[8px] border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") sendMessage();
              }}
              placeholder="Send a message..."
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-[#aaa4b8]"
            />
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/25 text-lg text-[#d9d3e7]">
              :)
            </span>
          </div>

          <div className="mt-2 flex justify-end">
            <button
              onClick={sendMessage}
              disabled={sending}
              className="rounded-[6px] bg-[#9146ff] px-5 py-2 text-sm font-black text-white hover:bg-[#7b31e8] disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
