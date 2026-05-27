"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";

export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const supabase = createSupabaseClient();

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
    }

    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setEmail(session?.user?.email ?? null);
      },
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setEmail(null);
  }

  if (email) {
    return (
      <button
        onClick={signOut}
        className="rounded-md border border-white/15 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
      >
        Sign out
      </button>
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