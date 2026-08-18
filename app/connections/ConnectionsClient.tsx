"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
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
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader />

      <div className="mx-auto w-full max-w-5xl px-5 py-8">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
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
            className="inline-flex h-11 items-center justify-center rounded-md bg-pink-500 px-5 text-sm font-black text-white hover:bg-pink-600"
          >
            Find a Match
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md border px-4 py-2 text-sm font-black ${
                activeTab === tab.key
                  ? "border-[#c35dff] bg-[#c35dff]/18 text-white"
                  : "border-white/10 bg-white/[0.04] text-[#aaa4b8] hover:text-white"
              }`}
            >
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
          <section className="mt-8 rounded-lg border border-white/10 bg-[#10101a] p-6">
            <h2 className="text-xl font-black">Sign in to see your Connections.</h2>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-5 rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]"
            >
              Sign in
            </button>
          </section>
        ) : loading ? (
          <div className="mt-8 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Loading...
          </div>
        ) : activeTab === "connections" ? (
          <section className="mt-8">
            <label className="sr-only" htmlFor="connection-search">
              Search Connections
            </label>
            <input
              id="connection-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Connections"
              className="h-11 w-full rounded-md border border-white/10 bg-black/25 px-4 text-sm font-bold text-white outline-none placeholder:text-[#777384] focus:border-[#c35dff]"
            />

            {filteredConnections.length === 0 ? (
              <div className="mt-5 rounded-lg border border-dashed border-purple-300/20 bg-black/20 p-8 text-center">
                <h2 className="text-xl font-black">No connections yet.</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
                  When you and someone you meet through Match both choose Keep in Touch, they&apos;ll appear here.
                </p>
                <Link
                  href="/match"
                  className="mt-6 inline-flex h-11 items-center rounded-md bg-pink-500 px-5 text-sm font-black text-white hover:bg-pink-600"
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
    </main>
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
    <article className="grid gap-4 rounded-lg border border-white/10 bg-[#10101a] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
            className="rounded-md border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10"
          >
            View Profile
          </Link>
        )}
        <button
          type="button"
          disabled={removing}
          onClick={() => onRemove(connection)}
          className="rounded-md border border-red-400/30 px-3 py-2 text-xs font-black text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
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
      <section className="mt-8 rounded-lg border border-dashed border-purple-300/20 bg-black/20 p-8 text-center text-[#aaa4b8]">
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
            className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-[#10101a] p-4"
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
              className="rounded-md border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10"
            >
              View Profile
            </Link>
          </article>
        );
      })}
    </section>
  );
}
