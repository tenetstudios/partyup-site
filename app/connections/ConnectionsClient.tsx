"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import {
  formatConnectionDate,
  getConnectionContextText,
  getConnectionInitial,
  getConnectionName,
  getMyConnections,
  removePartyUpConnection,
  type PartyUpConnection,
} from "@/lib/connections";
import { claimGuestIdentity, readStoredGuestSession } from "@/lib/matchmaking";
import { createSupabaseClient } from "@/lib/supabase";

type SocialTab = "connections" | "following" | "followers";

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type FollowRow = {
  follower_id: string;
  following_id: string;
};

const tabs: { key: SocialTab; label: string }[] = [
  { key: "connections", label: "Connections" },
  { key: "following", label: "Following" },
  { key: "followers", label: "Followers" },
];

function getProfileName(profile: ProfileRow) {
  return profile.username?.trim() || `Guest ${profile.id.slice(0, 4)}`;
}

function getInitial(name: string) {
  return name.slice(0, 1).toUpperCase();
}

function PeopleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15.5 10a3 3 0 1 0 0-6M2.5 20v-1.5a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5V20M15 13.5h1a5 5 0 0 1 5 5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ConnectionsClient() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [activeTab, setActiveTab] = useState<SocialTab>("connections");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connections, setConnections] = useState<PartyUpConnection[]>([]);
  const [following, setFollowing] = useState<ProfileRow[]>([]);
  const [followers, setFollowers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadSocialData = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setCurrentUserId(user?.id ?? null);

      if (!user) {
        setConnections([]);
        setFollowers([]);
        setFollowing([]);
        return;
      }

      const storedGuest = readStoredGuestSession();
      if (storedGuest?.guestToken) {
        const claim = await claimGuestIdentity(supabase, storedGuest.guestToken).catch(() => null);
        if (claim?.claimed) {
          setMessage("Your guest Match history is saved to this Google account.");
        }
      }

      const [connectionRows, followingRows, followerRows] = await Promise.all([
        getMyConnections(supabase),
        supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id)
          .returns<FollowRow[]>(),
        supabase
          .from("follows")
          .select("follower_id")
          .eq("following_id", user.id)
          .returns<FollowRow[]>(),
      ]);

      if (followingRows.error) {
        throw new Error(followingRows.error.message);
      }

      if (followerRows.error) {
        throw new Error(followerRows.error.message);
      }

      const followingIds = (followingRows.data ?? [])
        .map((row) => row.following_id)
        .filter(Boolean);
      const followerIds = (followerRows.data ?? [])
        .map((row) => row.follower_id)
        .filter(Boolean);
      const profileIds = Array.from(new Set([...followingIds, ...followerIds]));
      const profileMap = new Map<string, ProfileRow>();

      if (profileIds.length > 0) {
        const { data: profiles, error } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", profileIds)
          .returns<ProfileRow[]>();

        if (error) {
          throw new Error(error.message);
        }

        for (const profile of profiles ?? []) {
          profileMap.set(profile.id, profile);
        }
      }

      setConnections(connectionRows);
      setFollowing(
        followingIds
          .map((id) => profileMap.get(id))
          .filter((profile): profile is ProfileRow => Boolean(profile)),
      );
      setFollowers(
        followerIds
          .map((id) => profileMap.get(id))
          .filter((profile): profile is ProfileRow => Boolean(profile)),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your social history.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSocialData();
    }, 0);

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void loadSocialData();
    });

    return () => {
      window.clearTimeout(timeoutId);
      listener.subscription.unsubscribe();
    };
  }, [loadSocialData, supabase]);

  const filteredConnections = connections.filter((connection) => {
    const term = query.trim().toLowerCase();

    if (!term) {
      return true;
    }

    return (
      getConnectionName(connection).toLowerCase().includes(term) ||
      getConnectionContextText(connection).toLowerCase().includes(term)
    );
  });

  async function removeConnection(connection: PartyUpConnection) {
    const confirmed = window.confirm(
      `Remove ${getConnectionName(connection)} from your Connections? Following will not change.`,
    );

    if (!confirmed) {
      return;
    }

    setRemovingId(connection.id);
    setMessage(null);

    try {
      await removePartyUpConnection(supabase, connection.id);
      setConnections((current) => current.filter((row) => row.id !== connection.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this Connection.");
    } finally {
      setRemovingId(null);
    }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/connections`,
      },
    });
  }

  return (
    <PartyUpPageShell intensity="immersive" crowd>
      <HomeHeader />

      <div className="relative mx-auto w-full max-w-[1280px] px-5 py-10 md:py-12">
        <div className="flex flex-col gap-6 border-b border-purple-200/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c35dff]">
              Your People
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">
              Connections
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-[#aaa4b8]">
              Connections are mutual Keep in Touch moments from Match. Following stays separate.
            </p>
          </div>

          <Link
            href="/match"
            className={`${partyUpTheme.primaryButton} h-12 gap-2 px-6 text-sm`}
          >
            <PeopleIcon className="h-[18px] w-[18px]" />
            Find a Match
          </Link>
        </div>

        <div className="mt-7 xl:grid xl:grid-cols-[minmax(0,1fr)_260px] xl:gap-8">
          <div className="min-w-0">
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`${partyUpTheme.tabBase} gap-2 px-2 py-2 text-xs sm:px-5 sm:text-sm ${
                activeTab === tab.key
                  ? partyUpTheme.tabActive
                  : partyUpTheme.tabInactive
              }`}
            >
              <PeopleIcon />
              {tab.label}
            </button>
          ))}
        </div>

        {message && (
          <div className="mt-6 rounded-md border border-amber-300/20 bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-100">
            {message}
          </div>
        )}

        {!currentUserId && !loading ? (
          <section className={`${partyUpTheme.glassElevated} mt-8 p-6`}>
            <h2 className="text-xl font-black">Sign in to see your Connections.</h2>
            <button
              type="button"
              onClick={signInWithGoogle}
              className={`${partyUpTheme.primaryButton} mt-5 px-5 py-3 text-sm`}
            >
              Sign in
            </button>
          </section>
        ) : loading ? (
          <div className={`${partyUpTheme.glassElevated} mt-8 p-6 text-[#aaa4b8]`}>
            Loading...
          </div>
        ) : activeTab === "connections" ? (
          <section className="mt-8">
            <label className="sr-only" htmlFor="connection-search">
              Search Connections
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[#a9a1bb]"><SearchIcon /></span>
            <input
              id="connection-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Connections"
              className={`${partyUpTheme.input} h-12 w-full pl-12 pr-4 text-sm`}
            />
            </div>

            {filteredConnections.length === 0 ? (
              <div className={`${partyUpTheme.emptyState} mt-5 p-8`}>
                <h2 className="text-xl font-black">No connections yet.</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
                  When you and someone you meet through Match both choose Keep in Touch, they&apos;ll appear here.
                </p>
                <Link
                  href="/match"
                  className={`${partyUpTheme.primaryButton} mt-6 px-5 text-sm`}
                >
                  Find a Match
                </Link>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {filteredConnections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    removing={removingId === connection.id}
                    onRemove={removeConnection}
                  />
                ))}
              </div>
            )}
          </section>
        ) : activeTab === "following" ? (
          <ProfileList
            empty="You are not following anyone yet."
            profiles={following}
          />
        ) : (
          <ProfileList
            empty="No followers yet."
            profiles={followers}
          />
        )}
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-28 rounded-lg border border-fuchsia-300/20 bg-[linear-gradient(155deg,rgba(43,16,66,0.58),rgba(21,12,45,0.66))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_55px_rgba(19,4,43,0.28)] backdrop-blur-xl">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#e1c9ff]">Your Connections</p>
              <p className="mt-4 text-sm font-semibold leading-6 text-[#c3bcd0]">These are people you both chose to Keep in Touch with.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#a9a1b6]">You can always remove connections or reach out later.</p>
              <div className="my-6 h-px bg-gradient-to-r from-purple-300/20 via-fuchsia-300/15 to-transparent" />
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff7cba]">Keep It Real</p>
              <p className="mt-3 text-sm font-semibold text-[#b8b0c4]">Quality over quantity.</p>
            </div>
          </aside>
        </div>
      </div>
    </PartyUpPageShell>
  );
}

function ConnectionCard({
  connection,
  removing,
  onRemove,
}: {
  connection: PartyUpConnection;
  removing: boolean;
  onRemove: (connection: PartyUpConnection) => void;
}) {
  const name = getConnectionName(connection);
  const href = connection.person.profile_user_id
    ? `/user/${connection.person.profile_user_id}`
    : null;

  return (
    <article className={`${partyUpTheme.glassInteractive} grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`}>
      <div className="flex min-w-0 items-center gap-4">
        {connection.person.avatar_url ? (
          <img
            src={connection.person.avatar_url}
            alt=""
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#8b3dff] text-lg font-black">
            {getConnectionInitial(connection)}
          </div>
        )}

        <div className="min-w-0">
          <h2 className="truncate text-lg font-black">{name}</h2>
          <p className="mt-1 truncate text-sm font-bold text-[#c9c2d7]">
            {getConnectionContextText(connection)}
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-[#777384]">
            {formatConnectionDate(connection.connected_at)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 sm:justify-end">
        {href && (
          <Link
            href={href}
            className={`${partyUpTheme.ghostButton} px-3 py-2 text-xs`}
          >
            View Profile
          </Link>
        )}
        <button
          type="button"
          disabled={removing}
          onClick={() => onRemove(connection)}
          className={`${partyUpTheme.destructiveButton} px-3 py-2 text-xs`}
        >
          {removing ? "Removing..." : "Remove Connection"}
        </button>
      </div>
    </article>
  );
}

function ProfileList({ empty, profiles }: { empty: string; profiles: ProfileRow[] }) {
  if (profiles.length === 0) {
    return (
      <section className={`${partyUpTheme.emptyState} mt-8 p-8 text-[#aaa4b8]`}>
        {empty}
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-3">
      {profiles.map((profile) => {
        const name = getProfileName(profile);

        return (
          <article
            key={profile.id}
            className={`${partyUpTheme.glassInteractive} flex items-center justify-between gap-4 p-4`}
          >
            <div className="flex min-w-0 items-center gap-4">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#8b3dff] font-black">
                  {getInitial(name)}
                </div>
              )}
              <p className="truncate font-black">{name}</p>
            </div>

            <Link
              href={`/user/${profile.id}`}
              className={`${partyUpTheme.ghostButton} px-3 py-2 text-xs`}
            >
              View Profile
            </Link>
          </article>
        );
      })}
    </section>
  );
}
