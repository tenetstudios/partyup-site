"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getActiveRoomAnnouncement,
  isAnnouncementCurrentlyActive,
  isSafeAnnouncementUrl,
  type RoomAnnouncement,
} from "@/lib/roomAnnouncements";

function AnnouncementIcon() {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/20 text-[#ff4daa]">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
        <path d="M5 21 19 7M7 7l10 10M14 4l1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4ZM5 5l1.5 1.5M3 12h2M12 21v-2" />
      </svg>
    </div>
  );
}

function AnnouncementCta({ label, url }: { label: string; url: string }) {
  const className =
    "rounded-[6px] bg-[#9146ff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]";

  if (url.startsWith("/")) {
    return (
      <Link href={url} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <a href={url} className={className} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export default function RoomAnnouncementBanner({
  roomId,
  initialAnnouncement,
}: {
  roomId: string;
  initialAnnouncement: RoomAnnouncement | null;
}) {
  const [announcement, setAnnouncement] = useState<RoomAnnouncement | null>(initialAnnouncement);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [, setExpiryTick] = useState(0);
  const supabase = useMemo(() => createSupabaseClient(), []);

  const loadAnnouncement = useCallback(async () => {
    try {
      const nextAnnouncement = await getActiveRoomAnnouncement(supabase, roomId);
      setAnnouncement(nextAnnouncement);
    } catch (error) {
      console.error("Room announcement load failed:", error);
      setAnnouncement(null);
    }
  }, [roomId, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`room-announcements-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_announcements",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          loadAnnouncement();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAnnouncement, roomId, supabase]);

  useEffect(() => {
    if (!announcement?.expires_at) {
      return;
    }

    const msUntilExpiry = Date.parse(announcement.expires_at) - Date.now();

    if (msUntilExpiry <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setExpiryTick((current) => current + 1);
    }, msUntilExpiry);

    return () => {
      window.clearTimeout(timer);
    };
  }, [announcement?.expires_at]);

  if (
    !announcement ||
    !isAnnouncementCurrentlyActive(announcement) ||
    announcement.id === dismissedId
  ) {
    return null;
  }

  const hasCta =
    announcement.cta_label &&
    announcement.cta_url &&
    isSafeAnnouncementUrl(announcement.cta_url);

  return (
    <section className="flex items-center gap-5 rounded-[10px] border border-[#7f3dff]/45 bg-[linear-gradient(90deg,rgba(45,12,78,0.92),rgba(31,7,55,0.78))] px-6 py-5">
      <AnnouncementIcon />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[18px] font-black text-white">{announcement.title}</h2>
        {announcement.message && (
          <p className="mt-1 line-clamp-2 text-[16px] leading-6 text-[#d8d1e2]">
            {announcement.message}
          </p>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-5 sm:flex">
        {hasCta && (
          <AnnouncementCta label={announcement.cta_label ?? ""} url={announcement.cta_url ?? ""} />
        )}
        <button
          type="button"
          onClick={() => setDismissedId(announcement.id)}
          className="text-3xl leading-none text-[#d8d1e2] hover:text-white"
          aria-label="Dismiss announcement"
        >
          x
        </button>
      </div>
    </section>
  );
}
