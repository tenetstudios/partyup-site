"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { readActiveRoomContext } from "@/lib/activeRoomContext";
import {
  cancelPartyUpTapToken,
  createPartyUpTapToken,
  getPartyUpTapTokenStatus,
  type PartyUpTapPerson,
  type PartyUpTapToken,
} from "@/lib/partyupTap";
import { createSupabaseClient } from "@/lib/supabase";

type ScreenState = "checking" | "signed_out" | "generating" | "ready" | "expired" | "connected" | "error";

export default function ConnectClient() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const router = useRouter();
  const [state, setState] = useState<ScreenState>("checking");
  const [tapToken, setTapToken] = useState<PartyUpTapToken | null>(null);
  const [person, setPerson] = useState<PartyUpTapPerson | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const generate = useCallback(async () => {
    setState("generating");
    setMessage(null);
    setPerson(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setState("signed_out");
        return;
      }
      const activeRoom = readActiveRoomContext();
      const created = await createPartyUpTapToken(supabase, activeRoom?.roomId);
      setTapToken(created);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make a connection code.");
      setState("error");
    }
  }, [supabase]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void generate(), 0);
    return () => window.clearTimeout(timeout);
  }, [generate]);

  useEffect(() => {
    if (!tapToken || state !== "ready") return;
    const refresh = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(tapToken.expires_at) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setState("expired");
    };
    refresh();
    const interval = window.setInterval(refresh, 250);
    return () => window.clearInterval(interval);
  }, [state, tapToken]);

  useEffect(() => {
    if (!tapToken || state !== "ready") return;
    const poll = window.setInterval(async () => {
      try {
        const result = await getPartyUpTapTokenStatus(supabase, tapToken.token);
        if (result.status === "connected") {
          setPerson(result.person ?? null);
          setState("connected");
        } else if (result.status === "expired" || result.status === "cancelled") {
          setState("expired");
        }
      } catch {
        // Keep the QR usable through a transient polling failure.
      }
    }, 1500);
    return () => window.clearInterval(poll);
  }, [state, supabase, tapToken]);

  async function close() {
    if (tapToken && state === "ready") {
      await cancelPartyUpTapToken(supabase, tapToken.token).catch(() => undefined);
    }
    router.push("/connections");
  }

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/connect` },
    });
  }

  function useCode(event: React.FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized) router.push(`/connect/t/${encodeURIComponent(normalized)}`);
  }

  const qrValue = tapToken ? `${window.location.origin}/connect/t/${tapToken.token}` : "";

  return (
    <PartyUpPageShell intensity="immersive" crowd>
      <HomeHeader />
      <main className="mx-auto w-full max-w-xl px-5 py-8 sm:py-12">
        <section className={`${partyUpTheme.glassElevated} overflow-hidden p-5 text-center sm:p-8`}>
          <div className="flex items-start justify-between gap-4 text-left">
            <div>
              <p className={partyUpTheme.sectionLabel}>PartyUp Tap</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">Connect on PartyUp</h1>
            </div>
            <button type="button" onClick={() => void close()} aria-label="Close" className={`${partyUpTheme.ghostButton} grid h-10 w-10 shrink-0 place-items-center text-xl`}>×</button>
          </div>

          {state === "checking" || state === "generating" ? (
            <StateMessage title="Making your Tap..." copy="One sec." />
          ) : state === "signed_out" ? (
            <div className="py-12">
              <h2 className="text-2xl font-black">Sign in to connect.</h2>
              <p className="mt-3 text-sm font-bold text-[#aaa4b8]">PartyUp Taps are tied to your account.</p>
              <button type="button" onClick={() => void signIn()} className={`${partyUpTheme.primaryButton} mt-6 px-6`}>Sign in</button>
            </div>
          ) : state === "ready" && tapToken ? (
            <div className="pt-7">
              <div className="mx-auto w-fit rounded-2xl bg-white p-4 shadow-[0_0_45px_rgba(255,255,255,0.25)]">
                <QRCodeSVG value={qrValue} size={280} level="M" marginSize={0} bgColor="#ffffff" fgColor="#090611" />
              </div>
              <p className="mt-5 text-lg font-black">Scan me</p>
              <p className="mt-2 text-sm font-bold text-[#aaa4b8]">Open your camera and point it here.</p>
              <div className="mx-auto mt-5 flex max-w-sm items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs font-black uppercase tracking-[0.14em] text-[#817b8b]">or enter</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <p className="mt-3 font-mono text-2xl font-black tracking-[0.28em] text-[#e7ccff]">{tapToken.short_code}</p>
              <p className="mt-4 text-sm font-black text-[#c35dff]">{secondsLeft}s</p>
              {tapToken.origin_label && <p className="mt-3 text-xs font-bold text-[#aaa4b8]">Meeting at {tapToken.origin_label}</p>}
            </div>
          ) : state === "connected" ? (
            <div className="py-12">
              <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[#8b3dff] text-3xl font-black shadow-[0_0_40px_rgba(139,61,255,0.55)]">
                {person?.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : (person?.display_name || "P").slice(0, 1).toUpperCase()}
              </div>
              <h2 className="mt-6 text-4xl font-black">Connected ⚡</h2>
              {person && <p className="mt-3 text-lg font-bold text-[#d4cfda]">You and {person.display_name} are now connected.</p>}
              <Link href="/connections" className={`${partyUpTheme.primaryButton} mt-7 px-6`}>See Connections</Link>
            </div>
          ) : state === "expired" ? (
            <div className="py-12">
              <h2 className="text-2xl font-black">That Tap expired.</h2>
              <p className="mt-3 text-sm font-bold text-[#aaa4b8]">Make a fresh one when you&apos;re ready.</p>
              <button type="button" onClick={() => void generate()} className={`${partyUpTheme.primaryButton} mt-6 px-6`}>New Tap</button>
            </div>
          ) : (
            <div className="py-12">
              <h2 className="text-2xl font-black">Couldn&apos;t make a Tap.</h2>
              <p className="mt-3 text-sm font-bold text-amber-100">{message || "Check your connection and try again."}</p>
              <button type="button" onClick={() => void generate()} className={`${partyUpTheme.primaryButton} mt-6 px-6`}>Try again</button>
            </div>
          )}
        </section>

        <form onSubmit={useCode} className={`${partyUpTheme.glassCard} mt-4 p-4`}>
          <label htmlFor="tap-code" className="text-sm font-black">Have their code?</label>
          <div className="mt-3 flex gap-2">
            <input id="tap-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={6} autoCapitalize="characters" placeholder="ABC123" className={`${partyUpTheme.input} min-w-0 flex-1 px-4 font-mono uppercase tracking-[0.18em]`} />
            <button type="submit" disabled={!code.trim()} className={`${partyUpTheme.ghostButton} px-5`}>Connect</button>
          </div>
        </form>
      </main>
    </PartyUpPageShell>
  );
}

function StateMessage({ title, copy }: { title: string; copy: string }) {
  return <div className="py-16"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-[#c35dff]" /><h2 className="mt-6 text-2xl font-black">{title}</h2><p className="mt-2 text-sm font-bold text-[#aaa4b8]">{copy}</p></div>;
}
