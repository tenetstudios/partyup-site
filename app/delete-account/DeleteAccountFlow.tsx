"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { partyUpTheme } from "@/app/components/PartyUpTheme";
import { requestAccountDeletion } from "@/lib/accountDeletion";
import { createSupabaseClient } from "@/lib/supabase";

type AccountTarget = {
  id: string;
  email: string | null;
  username: string | null;
};

export default function DeleteAccountFlow() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [account, setAccount] = useState<AccountTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [reauthenticationRequired, setReauthenticationRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setAccount(null);
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    setAccount({
      id: user.id,
      email: user.email ?? null,
      username: profile?.username ?? null,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAccount(), 0);
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      setConfirming(false);
      setConfirmed(false);
      void loadAccount();
    });

    return () => {
      window.clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, [loadAccount, supabase]);

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/delete-account` },
    });
  }

  async function submitDeletionRequest() {
    if (!confirmed || submitting) return;

    setSubmitting(true);
    try {
      const result = await requestAccountDeletion();
      setMessage(result.message);
      setReauthenticationRequired(result.status === "reauthentication_required");
      setDeleted(result.status === "completed");
      setConfirming(false);
      setConfirmed(false);
      if (result.status === "completed") setAccount(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyIdentityAgain() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/delete-account`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  if (loading) {
    return <p className="text-sm font-bold text-[#aaa4b8]">Checking your sign-in status...</p>;
  }

  if (!account && deleted) {
    return (
      <div role="status" className="rounded-md border border-emerald-300/25 bg-emerald-950/30 px-4 py-3 text-sm font-bold text-emerald-100">
        {message}
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <p>
          You can read these instructions without signing in. To identify the PartyUp account you
          want deleted, sign in with the same Google account you use for PartyUp.
        </p>
        <button type="button" onClick={signIn} className={`${partyUpTheme.primaryButton} px-5 text-sm`}>
          Sign in to continue
        </button>
        <p className="text-sm text-[#aaa4b8]">
          Cannot sign in? Use the <Link href="/contact" className="font-black text-[#c35dff] hover:text-white">Contact page</Link> to request help.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-purple-200/20 bg-[#120c25]/65 p-4">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-[#c35dff]">Account targeted</p>
        <p className="mt-2 break-words text-lg font-black text-white">
          {account.username || "PartyUp user"}
        </p>
        <p className="mt-1 break-all text-sm text-[#c9c2d7]">
          {account.email || `Account ending in ${account.id.slice(-8)}`}
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setMessage(null);
          }}
          className={`${partyUpTheme.destructiveButton} px-5 text-sm`}
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-lg border border-pink-400/30 bg-pink-950/15 p-4 sm:p-5" role="group" aria-labelledby="delete-confirmation-title">
          <h3 id="delete-confirmation-title" className="text-lg font-black text-white">Confirm account deletion</h3>
          <p className="mt-2 text-sm leading-6 text-[#c9c2d7]">
            This permanently deletes your account and removes or anonymizes its associated data. This cannot be undone.
          </p>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm font-bold text-white">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[#ec2994]"
            />
            I understand that account deletion is intended to permanently remove my PartyUp account and associated data.
          </label>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!confirmed || submitting}
              onClick={() => void submitDeletionRequest()}
              className={`${partyUpTheme.destructiveButton} px-5 text-sm`}
            >
              {submitting ? "Deleting account..." : "Confirm delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmed(false);
              }}
              className={`${partyUpTheme.ghostButton} px-5 text-sm`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <div role="status" className="rounded-md border border-amber-300/25 bg-amber-950/35 px-4 py-3 text-sm font-bold text-amber-100">
          <p>{message}</p>
          {reauthenticationRequired ? (
            <button type="button" onClick={() => void verifyIdentityAgain()} className={`${partyUpTheme.ghostButton} mt-3 px-4 text-sm`}>
              Verify identity
            </button>
          ) : (
            <Link href="/contact" className="mt-3 inline-block font-black text-white underline decoration-amber-300/50 underline-offset-4">
              Contact PartyUp support
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
