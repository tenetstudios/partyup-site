"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

type Profile = {
  username: string | null;
  avatar_url: string | null;
};

export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const supabase = createSupabaseClient();

  async function loadUserAndProfile() {
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    setEmail(user?.email ?? null);

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
  }

  useEffect(() => {
    loadUserAndProfile();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadUserAndProfile();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

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
    setProfile(null);
  }

  if (email) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-md border border-white/15 px-3 py-2 sm:flex">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-6 w-6 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-6 w-6 place-items-center rounded-full bg-[#9146ff] text-xs font-black">
              {(profile?.username || "P").slice(0, 1).toUpperCase()}
            </div>
          )}

          <span className="max-w-24 truncate text-sm font-black">
            {profile?.username || "PartyUp User"}
          </span>
        </div>

        <button
          onClick={signOut}
          className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
    >
      Sign in
    </button>
  );
}