"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountFrame from "../AccountFrame";
import { partyUpTheme } from "@/app/components/PartyUpTheme";
import { createSupabaseClient } from "@/lib/supabase";

type Preferences = {
  missions: boolean;
  announcements: boolean;
  recaps: boolean;
  connections: boolean;
};

const defaultPreferences: Preferences = {
  missions: true,
  announcements: true,
  recaps: true,
  connections: true,
};

const preferenceLabels: Record<keyof Preferences, string> = {
  missions: "Missions & Wild",
  announcements: "Host announcements",
  recaps: "Event recaps",
  connections: "Connections",
};

export default function ProfileSettingsClient() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [account, setAccount] = useState<{ id: string; email: string; provider: string; verified: boolean } | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState<keyof Preferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setLoading(false);
        return;
      }

      setAccount({
        id: user.id,
        email: user.email ?? "No email available",
        provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "account",
        verified: Boolean(user.email_confirmed_at),
      });

      const { data: preferenceData } = await supabase.rpc("get_my_notification_preferences", { p_guest_token: null });
      if (preferenceData && typeof preferenceData === "object") {
        const value = preferenceData as Record<string, unknown>;
        setPreferences({
          missions: value.missions !== false,
          announcements: value.announcements !== false,
          recaps: value.recaps !== false,
          connections: value.connections !== false,
        });
      }
      setLoading(false);
    })();
  }, [supabase]);

  async function updatePreference(key: keyof Preferences, checked: boolean) {
    const previous = preferences;
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    setSavingPreference(key);
    setMessage(null);
    const { error } = await supabase.rpc("set_my_notification_preferences", {
      p_missions: next.missions,
      p_announcements: next.announcements,
      p_recaps: next.recaps,
      p_connections: next.connections,
      p_guest_token: null,
    });
    if (error) {
      setPreferences(previous);
      setMessage(error.message);
    }
    setSavingPreference(null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <AccountFrame
      eyebrow="Private controls"
      title="Profile Settings"
      subtitle="These details and controls are for you. They never appear on your public PartyUp profile."
      backHref="/account"
    >
      {loading ? (
        <div className={`${partyUpTheme.glassCard} p-6 ${partyUpTheme.textSecondary}`}>Loading...</div>
      ) : !account ? (
        <div className={`${partyUpTheme.emptyState} p-7`}>Sign in to manage profile settings.</div>
      ) : (
        <div className="space-y-5">
          <section className={`${partyUpTheme.glassElevated} p-6`}>
            <p className={partyUpTheme.sectionLabel}>Sign-in details</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <SettingValue label="Email" value={account.email} />
              <SettingValue label="Sign-in provider" value={account.provider === "google" ? "Google" : account.provider} />
              <SettingValue label="Email status" value={account.verified ? "Verified" : "Not verified"} />
              <SettingValue label="Account ID" value={account.id} mono />
            </dl>
          </section>

          <section className={`${partyUpTheme.glassCard} p-6`}>
            <p className={partyUpTheme.sectionLabel}>Notifications</p>
            <h2 className="mt-2 text-2xl font-black">What PartyUp should notify you about</h2>
            <div className="mt-5 divide-y divide-white/10">
              {(Object.keys(preferenceLabels) as (keyof Preferences)[]).map((key) => (
                <label key={key} className="flex min-h-14 items-center justify-between gap-4 py-3 font-bold">
                  <span>{preferenceLabels[key]}</span>
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    disabled={savingPreference !== null}
                    onChange={(event) => void updatePreference(key, event.target.checked)}
                    className="h-5 w-5 accent-[#8b3dff]"
                  />
                </label>
              ))}
            </div>
            <p className={`mt-3 text-xs ${partyUpTheme.textMuted}`}>Device push delivery is enabled from the iOS or Android app.</p>
            {message && <p role="status" className="mt-3 text-sm font-bold text-pink-300">{message}</p>}
          </section>

          <section className={`${partyUpTheme.glassCard} p-6`}>
            <p className={partyUpTheme.sectionLabel}>Your content</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/connections" className={`${partyUpTheme.ghostButton} px-5 text-sm`}>Connections & Memories</Link>
              <Link href="/privacy" className={`${partyUpTheme.ghostButton} px-5 text-sm`}>Privacy Policy</Link>
              <Link href="/terms" className={`${partyUpTheme.ghostButton} px-5 text-sm`}>Terms of Use</Link>
              <Link href="/contact" className={`${partyUpTheme.ghostButton} px-5 text-sm`}>Support</Link>
            </div>
          </section>

          <section className={`${partyUpTheme.glassCard} p-6`}>
            <p className={partyUpTheme.sectionLabel}>Account actions</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void signOut()} className={`${partyUpTheme.ghostButton} px-5 text-sm`}>Sign out</button>
              <Link href="/delete-account" className={`${partyUpTheme.destructiveButton} px-5 text-sm`}>Delete Account</Link>
            </div>
          </section>
        </div>
      )}
    </AccountFrame>
  );
}

function SettingValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-[#100b20]/55 p-4">
      <dt className={`text-xs font-black uppercase tracking-[0.12em] ${partyUpTheme.textMuted}`}>{label}</dt>
      <dd className={`mt-2 break-all text-sm font-bold text-white ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
