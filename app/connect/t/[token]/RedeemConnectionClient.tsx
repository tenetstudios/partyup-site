"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { redeemPartyUpTapToken, type PartyUpTapRedeemResult } from "@/lib/partyupTap";
import { createSupabaseClient } from "@/lib/supabase";

type RedeemState = "checking" | "signed_out" | "connecting" | "result" | "network_error";

export default function RedeemConnectionClient({ token }: { token: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const started = useRef(false);
  const [state, setState] = useState<RedeemState>("checking");
  const [result, setResult] = useState<PartyUpTapRedeemResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redeem = useCallback(async () => {
    setState("connecting");
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setState("signed_out");
        return;
      }
      const nextResult = await redeemPartyUpTapToken(supabase, token);
      setResult(nextResult);
      setState("result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect right now.");
      setState("network_error");
    }
  }, [supabase, token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void redeem();
  }, [redeem]);

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
  }

  const successful = result?.status === "connected" || result?.status === "already_connected";
  const title = result?.status === "connected" ? "Connected ⚡"
    : result?.status === "already_connected" ? "Already connected"
    : result?.status === "self_scan" ? "That’s your Tap"
    : result?.status === "expired" ? "Tap expired"
    : "Invalid Tap";
  const copy = result?.status === "already_connected" ? "You two are already in each other’s Connections."
    : result?.status === "self_scan" ? "Have someone else scan your code."
    : result?.status === "expired" ? "Ask them to make a fresh one."
    : result?.status === "invalid" ? "This code isn’t valid."
    : null;

  return (
    <PartyUpPageShell intensity="immersive" crowd>
      <HomeHeader />
      <main className="mx-auto grid min-h-[calc(100vh-76px)] w-full max-w-xl place-items-center px-5 py-10">
        <section className={`${partyUpTheme.glassElevated} w-full p-6 text-center sm:p-10`}>
          <p className={partyUpTheme.sectionLabel}>PartyUp Tap</p>
          {state === "checking" || state === "connecting" ? (
            <div className="py-12"><div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-white/15 border-t-[#c35dff]" /><h1 className="mt-6 text-3xl font-black">Connecting...</h1><p className="mt-2 text-sm font-bold text-[#aaa4b8]">Hold tight.</p></div>
          ) : state === "signed_out" ? (
            <div className="py-10"><h1 className="text-3xl font-black">Connect on PartyUp</h1><p className="mt-3 text-sm font-bold text-[#aaa4b8]">Sign in to finish this Tap.</p><button type="button" onClick={() => void signIn()} className={`${partyUpTheme.primaryButton} mt-7 px-6`}>Sign in & Connect</button></div>
          ) : state === "network_error" ? (
            <div className="py-10"><h1 className="text-3xl font-black">Connection hiccup</h1><p className="mt-3 text-sm font-bold text-amber-100">{error}</p><button type="button" onClick={() => void redeem()} className={`${partyUpTheme.primaryButton} mt-7 px-6`}>Try again</button></div>
          ) : (
            <div className="py-8">
              {successful && <div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-[#8b3dff] text-4xl font-black shadow-[0_0_45px_rgba(139,61,255,0.58)]">{result?.person?.avatar_url ? <img src={result.person.avatar_url} alt="" className="h-full w-full object-cover" /> : (result?.person?.display_name || "P").slice(0, 1).toUpperCase()}</div>}
              <h1 className="mt-6 text-4xl font-black">{title}</h1>
              {successful && result?.person && <p className="mt-3 text-lg font-bold text-[#d4cfda]">{result.person.display_name}</p>}
              {result?.origin_label && <p className="mt-2 text-sm font-bold text-[#c9a6ff]">Met at {result.origin_label}</p>}
              {copy && <p className="mt-3 text-sm font-bold text-[#aaa4b8]">{copy}</p>}
              <div className="mt-7 flex flex-wrap justify-center gap-3"><Link href={successful ? "/connections" : "/connect"} className={`${partyUpTheme.primaryButton} px-6`}>{successful ? "See Connections" : "Back to Connect"}</Link>{successful && <Link href="/" className={`${partyUpTheme.ghostButton} px-6`}>Done</Link>}</div>
            </div>
          )}
        </section>
      </main>
    </PartyUpPageShell>
  );
}
