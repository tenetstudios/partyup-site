"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import {
  getProfileSocialState,
  removePartyUpConnection,
  type ProfileSocialState,
} from "@/lib/connections";
import { createSupabaseClient } from "@/lib/supabase";

type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

const emptyState: ProfileSocialState = {
  followers: 0,
  following: 0,
  is_following: false,
  connected: false,
  connection_id: null,
};

function getProfileName(profile: Profile) {
  return profile.username?.trim() || `Guest ${profile.id.slice(0, 4)}`;
}

export default function ProfileClient({ profileId }: { profileId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [state, setState] = useState<ProfileSocialState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id ?? null);

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio")
        .eq("id", profileId)
        .maybeSingle<Profile>();

      if (error) {
        throw new Error(error.message);
      }

      setProfile(data);

      if (data) {
        setState(await getProfileSocialState(supabase, profileId));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  }, [profileId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProfile();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadProfile]);

  async function toggleFollow() {
    if (!profile || !currentUserId || currentUserId === profile.id || processing) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      if (state.is_following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profile.id);

        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: currentUserId,
          following_id: profile.id,
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      setState(await getProfileSocialState(supabase, profile.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Follow.");
    } finally {
      setProcessing(false);
    }
  }

  async function removeConnection() {
    if (!state.connection_id || processing) {
      return;
    }

    const confirmed = window.confirm("Remove this PartyUp Connection? Following will not change.");

    if (!confirmed) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      await removePartyUpConnection(supabase, state.connection_id);
      setState((current) => ({
        ...current,
        connected: false,
        connection_id: null,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this Connection.");
    } finally {
      setProcessing(false);
    }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/user/${profileId}`,
      },
    });
  }

  return (
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader />

      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <Link href="/connections" className="text-sm font-black text-[#c35dff] hover:text-white">
          Back to Connections
        </Link>

        {message && (
          <div className="mt-6 rounded-md border border-amber-300/20 bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-100">
            {message}
          </div>
        )}

        {loading ? (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Loading...
          </section>
        ) : profile ? (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-24 w-24 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full bg-[#8b3dff] text-3xl font-black">
                  {getProfileName(profile).slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h1 className="truncate text-4xl font-black tracking-normal">
                  {getProfileName(profile)}
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state.connected && (
                    <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-sm font-black text-emerald-100">
                      Connected
                    </span>
                  )}
                  {state.is_following && (
                    <span className="rounded-md border border-purple-300/25 bg-purple-400/10 px-3 py-1 text-sm font-black text-purple-100">
                      Following
                    </span>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-6 text-sm leading-6 text-[#c9c2d7]">
              {profile.bio?.trim() || "This user has no bio yet."}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-2xl font-black">{state.followers}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[#aaa4b8]">
                  Followers
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <p className="text-2xl font-black">{state.following}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[#aaa4b8]">
                  Following
                </p>
              </div>
            </div>

            {currentUserId === profile.id ? (
              <p className="mt-6 text-sm font-bold text-[#aaa4b8]">This is your public profile.</p>
            ) : currentUserId ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={processing}
                  className="rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state.is_following ? "Unfollow" : "Follow"}
                </button>
                {state.connected && (
                  <button
                    type="button"
                    onClick={removeConnection}
                    disabled={processing}
                    className="rounded-md border border-red-400/30 px-5 py-3 text-sm font-black text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove Connection
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="mt-6 rounded-md bg-[#8b3dff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]"
              >
                Sign in to Follow
              </button>
            )}
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-white/10 bg-[#10101a] p-6 text-[#aaa4b8]">
            Profile not found.
          </section>
        )}
      </div>
    </main>
  );
}
