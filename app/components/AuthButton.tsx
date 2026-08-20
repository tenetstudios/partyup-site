"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type Profile = {
  username: string | null;
  avatar_url: string | null;
};

export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const supabase = useMemo(() => createSupabaseClient(), []);

  const loadUserAndProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    setEmail(user?.email ?? null);
    setUserId(user?.id ?? null);

    if (!user) {
      setProfile(null);
      return;
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    setProfile(profileData);
  }, [supabase]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadUserAndProfile();
    }, 0);

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void loadUserAndProfile();
    });

    return () => {
      window.clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, [loadUserAndProfile, supabase]);

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}`,
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setEmail(null);
    setUserId(null);
    setProfile(null);
  }

  if (email && userId) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href={`/user/${userId}`}
          className="flex h-10 items-center gap-2 rounded-md px-1 text-white hover:bg-white/10 sm:gap-3 sm:px-2"
          aria-label="Open your profile"
        >
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#8b3dff] text-sm font-black shadow-[0_0_18px_rgba(139,61,255,0.5)]">
              {(profile?.username || "P").slice(0, 1).toUpperCase()}
            </div>
          )}

          <span className="hidden max-w-32 truncate text-[15px] font-black sm:block">
            {profile?.username || "PartyUp User"}
          </span>
        </Link>

        <button
          onClick={signOut}
          className="hidden rounded-md border border-white/10 px-3 py-2 text-sm font-black text-white hover:bg-white/10 lg:block"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
    >
      Sign in
    </button>
  );
}
