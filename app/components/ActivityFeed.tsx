"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMyConnections } from "@/lib/connections";
import { asNumber, asText, HostProfile, LiveRoom, getActivity, getRoomTitle, getHostName } from "@/lib/homeHelpers";
import { rankActivityFeedRooms, type ActivityFeedSignals, type RankedActivityRoom } from "@/lib/activityFeedRanking";
import { createSupabaseClient } from "@/lib/supabase";

const emptySignals: ActivityFeedSignals = {
  currentUserId: null,
  notificationRoomIds: [],
  notificationActorIds: [],
  connectedUserIds: new Set(),
  followedUserIds: new Set(),
  viewerCoordinates: null,
  viewerLocation: null,
};

const reasonLabels: Record<RankedActivityRoom["reason"], string> = {
  activity: "From your activity",
  connection: "Connection",
  discovery: "Discover",
  following: "Following",
  nearby: "Nearby",
  yours: "Your room",
};

function getTimestamp(room: LiveRoom) {
  const raw =
    typeof room.last_active_at === "string"
      ? room.last_active_at
      : typeof room.updated_at === "string"
        ? room.updated_at
        : typeof room.created_at === "string"
          ? room.created_at
          : null;

  if (!raw) {
    return "Recently";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

function FeedIcon({ index }: { index: number }) {
  const icons = [
    { bg: "bg-purple-500/20", fg: "text-[#9b4dff]", path: "M6 8h8a3 3 0 0 1 3 3v6H9a3 3 0 0 1-3-3V8Zm11 4 5-3v10l-5-3v-4Z" },
    { bg: "bg-green-500/16", fg: "text-[#68e58b]", path: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0H5Zm15-8v6m-3-3h6" },
    { bg: "bg-pink-500/18", fg: "text-[#ff4aa2]", path: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" },
    { bg: "bg-violet-500/18", fg: "text-[#bf7cff]", path: "M7 4v3m10-3v3M5 9h14v11H5V9Zm4 5h3m3 0h1m-7 3h1m4 0h3" },
  ];
  const icon = icons[index % icons.length];

  return (
    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${icon.bg} ${icon.fg}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d={icon.path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    </div>
  );
}

async function getGrantedBrowserCoordinates() {
  if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) return null;

  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    if (permission.state !== "granted") return null;

    return await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 4000 },
      );
    });
  } catch {
    return null;
  }
}

export default function ActivityFeed({
  rooms,
  profiles,
  loadError,
}: {
  rooms: LiveRoom[];
  profiles: HostProfile[];
  loadError?: string | null;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [String(profile.id), profile])),
    [profiles],
  );
  const [activityRooms, setActivityRooms] = useState<RankedActivityRoom[]>(() =>
    rankActivityFeedRooms(rooms, emptySignals, 5, () => 0),
  );

  const personalize = useCallback(async () => {
    const browserCoordinates = await getGrantedBrowserCoordinates();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setActivityRooms(rankActivityFeedRooms(rooms, { ...emptySignals, viewerCoordinates: browserCoordinates }));
      return;
    }

    const [notificationsResult, followsResult, connections, profileResult, seriesResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("room_id,actor_id,created_at")
        .eq("user_id", user.id)
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("follows").select("following_id").eq("follower_id", user.id),
      getMyConnections(supabase).catch(() => []),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.rpc("get_my_followed_series_events"),
    ]);
    const profile = (profileResult.data ?? {}) as Record<string, unknown>;
    const profileLatitude = asNumber(profile.latitude);
    const profileLongitude = asNumber(profile.longitude);
    const profileCoordinates =
      profileLatitude != null &&
      profileLongitude != null &&
      profileLatitude >= -90 &&
      profileLatitude <= 90 &&
      profileLongitude >= -180 &&
      profileLongitude <= 180
        ? { latitude: profileLatitude, longitude: profileLongitude }
        : null;
    const seriesRoomIds = Array.isArray(seriesResult.data)
      ? seriesResult.data.map((event) => String((event as Record<string, unknown>).id ?? "")).filter(Boolean)
      : [];
    const notificationRows = notificationsResult.data ?? [];
    const signals: ActivityFeedSignals = {
      currentUserId: user.id,
      notificationRoomIds: [
        ...notificationRows.map((notification) => notification.room_id).filter((id): id is string => Boolean(id)),
        ...seriesRoomIds,
      ],
      notificationActorIds: notificationRows.map((notification) => notification.actor_id).filter((id): id is string => Boolean(id)),
      connectedUserIds: new Set(connections.map((connection) => connection.person.profile_user_id).filter((id): id is string => Boolean(id))),
      followedUserIds: new Set((followsResult.data ?? []).map((follow) => String(follow.following_id)).filter(Boolean)),
      viewerCoordinates: profileCoordinates ?? browserCoordinates,
      viewerLocation: asText(profile.location) ?? asText(profile.city) ?? asText(profile.region),
    };

    setActivityRooms(rankActivityFeedRooms(rooms, signals));
  }, [rooms, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void personalize(); }, 0);
    const { data: authListener } = supabase.auth.onAuthStateChange(() => { void personalize(); });
    return () => {
      window.clearTimeout(timeoutId);
      authListener.subscription.unsubscribe();
    };
  }, [personalize, supabase]);

  return (
    <aside className="min-h-[535px] rounded-[10px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(17,17,27,0.94),rgba(11,11,19,0.96))] p-6 shadow-[0_18px_44px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between">
        <h4 className="text-[18px] font-black text-white">Activity Feed</h4>
        <Link className="text-[15px] text-[#c35dff] hover:text-white" href="/activity">View all</Link>
      </div>

      <div className="mt-5">
        {activityRooms.length > 0 ? (
          <ul>
            {activityRooms.map(({ room, reason }, index) => {
              const host = room.host_id != null ? profilesById.get(String(room.host_id)) : undefined;
              const hostId = room.host_id == null ? null : String(room.host_id);
              const isLive = room.status === "live";
              const count = getActivity(room);

              return (
                <li key={String(room.id)} className="flex min-h-[84px] items-center gap-4 border-b border-white/[0.06] py-3 last:border-b-0">
                  {hostId ? (
                    <Link href={`/user/${hostId}`} aria-label={`View ${getHostName(host)}'s profile`} className="shrink-0 rounded-full transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c35dff]">
                      {asText(host?.avatar_url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asText(host?.avatar_url) ?? ""} alt="" className="h-11 w-11 rounded-full border border-purple-200/20 object-cover" />
                      ) : <FeedIcon index={index} />}
                    </Link>
                  ) : <FeedIcon index={index} />}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[15px] leading-6 text-white">
                      {hostId ? (
                        <Link href={`/user/${hostId}`} className="relative font-semibold hover:text-[#d7b2ff] hover:underline">{getHostName(host)}</Link>
                      ) : <span className="font-semibold">{getHostName(host)}</span>}{" "}
                      {isLive ? "is streaming in" : "scheduled"}{" "}
                      <Link href={`/room/${room.id}`} className="font-semibold hover:text-[#d7b2ff] hover:underline">{getRoomTitle(room)}</Link>
                      {isLive && count > 0 ? ` with ${count} watching` : ""}
                    </p>
                    <Link href={`/room/${room.id}`} className="mt-1 flex items-center gap-2 text-[13px] text-[#8f899b] hover:text-white">
                      <span>{getTimestamp(room)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${reason === "discovery" ? "bg-pink-500/15 text-[#ff83b8]" : "bg-purple-500/15 text-[#c9a6ff]"}`}>{reasonLabels[reason]}</span>
                    </Link>
                  </div>
                  {room.cover_image && (
                    <Link
                      href={`/room/${room.id}`}
                      aria-label={`Open ${getRoomTitle(room)}`}
                      className="h-[62px] w-[73px] shrink-0 rounded-md bg-cover bg-center transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c35dff]"
                      style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.1),rgba(0,0,0,0.25)),url(${room.cover_image})` }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid min-h-[424px] place-items-center rounded-[10px] border border-dashed border-purple-300/20 bg-black/10 p-6 text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-purple-500/15 text-[#a855f7]">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true"><path d="M12 5v7l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
              </div>
              <p className="mt-4 font-semibold text-white">{loadError ? "Activity unavailable" : "No recent activity"}</p>
              <p className="mt-2 text-sm leading-6 text-[#aaa4b8]">{loadError ?? "Live room updates will appear here when PartyUp activity starts."}</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
