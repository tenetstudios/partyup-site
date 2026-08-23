"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearActiveRoomContext, readActiveRoomContext } from "@/lib/activeRoomContext";
import { createSupabaseClient } from "@/lib/supabase";

type RoomClearNoticeRecord = {
  clear_event_id: string;
  room_id: string;
  message: string | null;
  created_at: string;
};

export default function RoomClearNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RoomClearNoticeRecord | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  const loadPendingNotice = useCallback(async (exitActiveRoom: boolean) => {
    const { data, error } = await supabase.rpc("get_pending_room_clear_notice");
    if (error || !data) return;

    const pendingNotice = data as RoomClearNoticeRecord;
    setNotice(pendingNotice);

    const activeContext = readActiveRoomContext();
    const activeContextMatches = activeContext?.roomId === pendingNotice.room_id;
    const encodedRoomId = encodeURIComponent(pendingNotice.room_id);
    const viewingClearedRoom =
      pathname === `/room/${encodedRoomId}` || pathname.startsWith(`/room/${encodedRoomId}/`);

    if (activeContextMatches) {
      clearActiveRoomContext();
    }

    if (exitActiveRoom || activeContextMatches || viewingClearedRoom) {
      router.replace("/");
    }
  }, [pathname, router, supabase]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setNotice(null);
      setUserId(session?.user.id ?? null);
    });

    return () => authListener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`room-clear-notice-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_clear_recipients",
          filter: `user_id=eq.${userId}`,
        },
        () => void loadPendingNotice(true),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadPendingNotice(false);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPendingNotice, supabase, userId]);

  async function acknowledge() {
    if (!notice || acknowledging) return;

    setAcknowledging(true);
    const { error } = await supabase.rpc("acknowledge_room_clear_notice", {
      p_clear_event_id: notice.clear_event_id,
    });

    if (!error) {
      setNotice(null);
      await loadPendingNotice(false);
    }
    setAcknowledging(false);
  }

  if (!notice) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 px-4 backdrop-blur-md">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-cleared-title"
        className="w-full max-w-lg rounded-[14px] border border-purple-300/30 bg-[#12051e] p-7 text-center text-white shadow-[0_30px_110px_rgba(0,0,0,0.7)]"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#9146ff]/20 text-2xl">
          ✦
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-[#b587ff]">
          Message from the host
        </p>
        <h2 id="room-cleared-title" className="mt-2 text-3xl font-black">
          The room has been cleared
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Your current room session has ended. The host can invite you back for a future event.
        </p>
        <div className="mt-5 rounded-[9px] border border-white/10 bg-black/25 p-4 text-left text-sm leading-6 text-zinc-100">
          {notice.message || "Thanks for joining. This room has been cleared for the next event."}
        </div>
        <button
          type="button"
          onClick={() => void acknowledge()}
          disabled={acknowledging}
          className="mt-6 min-h-11 rounded-md bg-[#9146ff] px-6 text-sm font-black hover:bg-[#7b31e8] disabled:opacity-50"
        >
          {acknowledging ? "Closing..." : "Got it"}
        </button>
      </section>
    </div>
  );
}
