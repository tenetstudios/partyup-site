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
    <main className="relative isolate min-h-screen overflow-x-hidden bg-[#0d0a20] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(155deg,#080b1a_0%,#100b27_42%,#180b31_100%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[min(960px,100svh)] bg-cover bg-[position:62%_top] opacity-30 mix-blend-screen sm:opacity-36 lg:bg-center lg:opacity-42" style={{ backgroundImage: "url('/images/hero-concert-crowd.png')" }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_80%_at_0%_44%,rgba(72,52,255,0.38),transparent_72%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_58%_72%_at_100%_48%,rgba(236,41,148,0.36),transparent_70%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(5,7,18,0.18),rgba(10,8,27,0.68)_42%,rgba(12,7,27,0.42)_70%,rgba(17,5,27,0.12))]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_34%,rgba(4,4,14,0.44)_100%)]" />
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
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-fuchsia-300/30 bg-[linear-gradient(110deg,#7c3aed,#ec2994)] px-6 text-sm font-black text-white shadow-[0_14px_38px_rgba(190,35,220,0.3)] transition hover:border-fuchsia-200/50 hover:brightness-110"
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
              className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md border px-2 py-2 text-xs font-black transition sm:px-5 sm:text-sm ${
                activeTab === tab.key
                  ? "border-[#b968ff]/85 bg-[linear-gradient(135deg,rgba(118,46,255,0.56),rgba(207,48,219,0.24))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_26px_rgba(139,61,255,0.24)]"
                  : "border-purple-100/15 bg-[#17112e]/55 text-[#aaa4b8] backdrop-blur-md hover:border-purple-300/35 hover:bg-[#1b1435]/70 hover:text-white"
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
          <section className="mt-8 rounded-lg border border-purple-200/20 bg-[linear-gradient(145deg,rgba(37,24,65,0.68),rgba(19,14,42,0.72))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl">
            <h2 className="text-xl font-black">Sign in to see your Connections.</h2>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-5 rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white shadow-[0_10px_26px_rgba(139,61,255,0.22)] hover:bg-[#9b4dff]"
            >
              Sign in
            </button>
          </section>
        ) : loading ? (
          <div className="mt-8 rounded-lg border border-purple-200/20 bg-[linear-gradient(145deg,rgba(37,24,65,0.68),rgba(19,14,42,0.72))] p-6 text-[#aaa4b8] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl">
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
              className="h-12 w-full rounded-md border border-purple-200/20 bg-[#17112d]/60 pl-12 pr-4 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_34px_rgba(0,0,0,0.12)] outline-none backdrop-blur-md transition placeholder:text-[#aaa3b7] focus:border-[#b968ff]/85 focus:bg-[#1a1233]/72 focus:shadow-[0_0_0_3px_rgba(139,61,255,0.15),0_14px_34px_rgba(0,0,0,0.12)]"
            />
            </div>

            {filteredConnections.length === 0 ? (
              <div className="mt-5 rounded-lg border border-dashed border-purple-300/25 bg-[#100b20]/65 p-8 text-center backdrop-blur-sm">
                <h2 className="text-xl font-black">No connections yet.</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aaa4b8]">
                  When you and someone you meet through Match both choose Keep in Touch, they&apos;ll appear here.
                </p>
                <Link
                  href="/match"
                  className="mt-6 inline-flex h-11 items-center rounded-md border border-fuchsia-300/25 bg-[linear-gradient(110deg,#7c3aed,#ec2994)] px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(168,45,255,0.2)] hover:brightness-110"
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
    <article className="grid gap-4 rounded-lg border border-purple-200/20 bg-[linear-gradient(135deg,rgba(32,22,59,0.68),rgba(18,14,40,0.72))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_38px_rgba(3,2,15,0.2)] backdrop-blur-xl transition duration-200 hover:-translate-y-px hover:border-purple-300/42 hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_18px_44px_rgba(58,17,110,0.24)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
            className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-black text-white transition hover:border-purple-200/30 hover:bg-purple-300/10"
          >
            View Profile
          </Link>
        )}
        <button
          type="button"
          disabled={removing}
          onClick={() => onRemove(connection)}
          className="rounded-md border border-pink-400/30 bg-pink-950/10 px-3 py-2 text-xs font-black text-[#ff9dc5] transition hover:border-pink-300/50 hover:bg-pink-500/10 disabled:cursor-not-allowed disabled:opacity-60"
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
      <section className="mt-8 rounded-lg border border-dashed border-purple-300/25 bg-[#100b20]/65 p-8 text-center text-[#aaa4b8] backdrop-blur-sm">
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
            className="flex items-center justify-between gap-4 rounded-lg border border-purple-200/20 bg-[linear-gradient(135deg,rgba(32,22,59,0.68),rgba(18,14,40,0.72))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_38px_rgba(3,2,15,0.2)] backdrop-blur-xl transition duration-200 hover:-translate-y-px hover:border-purple-300/42 hover:brightness-110"
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
              className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-black text-white transition hover:border-purple-200/30 hover:bg-purple-300/10"
            >
              View Profile
            </Link>
          </article>
        );
      })}
    </section>
  );
}
