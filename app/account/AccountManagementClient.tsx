"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountFrame from "./AccountFrame";
import { partyUpTheme } from "@/app/components/PartyUpTheme";
import { createSupabaseClient } from "@/lib/supabase";

export default function AccountManagementClient() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setLoading(false);
    });
  }, [supabase]);

  return (
    <AccountFrame
      eyebrow="Your account"
      title="Account Management"
      subtitle="Choose what other people see or manage the private settings behind your PartyUp account."
    >
      {loading ? (
        <div className={`${partyUpTheme.glassCard} p-6 ${partyUpTheme.textSecondary}`}>Loading...</div>
      ) : !userId ? (
        <div className={`${partyUpTheme.emptyState} p-7`}>
          <p className="font-black text-white">Sign in to manage your account.</p>
          <Link href="/" className={`${partyUpTheme.primaryButton} mt-4 px-5 text-sm`}>Go to sign in</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/account/public-profile" className={`${partyUpTheme.glassInteractive} p-6`}>
            <p className={partyUpTheme.sectionLabel}>What others see</p>
            <h2 className="mt-2 text-2xl font-black">Public Profile</h2>
            <p className={`mt-3 text-sm leading-6 ${partyUpTheme.textSecondary}`}>
              Edit your photo, unique PartyUp name, bio, and general location.
            </p>
            <span className="mt-5 inline-block font-black text-[#d8b4fe]">Edit public profile →</span>
          </Link>

          <Link href="/account/profile-settings" className={`${partyUpTheme.glassInteractive} p-6`}>
            <p className={partyUpTheme.sectionLabel}>Private controls</p>
            <h2 className="mt-2 text-2xl font-black">Profile Settings</h2>
            <p className={`mt-3 text-sm leading-6 ${partyUpTheme.textSecondary}`}>
              Manage sign-in details, notifications, account data, and your session.
            </p>
            <span className="mt-5 inline-block font-black text-[#d8b4fe]">Open settings →</span>
          </Link>

          <Link href={`/user/${userId}`} className={`${partyUpTheme.ghostButton} px-5 text-sm md:col-span-2`}>
            View your public profile
          </Link>
        </div>
      )}
    </AccountFrame>
  );
}
