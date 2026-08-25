"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { claimLiveNode, createLiveNodeClaimHandoff, getLiveNodeScanState, type LiveNodeScanState } from "@/lib/liveNodes";
import { createGuestSession, readStoredGuestSession } from "@/lib/matchmaking";
import { createSupabaseClient } from "@/lib/supabase";

function copyFor(state: LiveNodeScanState) {
  if (state.status === "winner" || state.status === "already_claimed_by_you") return { eyebrow: "NODE FOUND", title: "YOU GOT IT", body: "You were the first person to find the hidden node." };
  if (state.status === "inactive") return { eyebrow: "YOU FOUND A PARTYUP NODE", title: "IT'S NOT ACTIVE YET", body: "Keep an eye on PartyUp." };
  if (state.status === "claimed") return { eyebrow: "PARTYUP LIVE NODE", title: "NODE ALREADY CLAIMED", body: "Someone got here first." };
  if (state.status === "ended") return { eyebrow: "PARTYUP LIVE NODE", title: "NODE ENDED", body: "This node is no longer active." };
  if (state.status === "room_ended") return { eyebrow: "PARTYUP LIVE NODE", title: "ROOM ENDED", body: "This event has ended." };
  if (state.status === "not_eligible" || (state.status === "active" && state.eligible === false)) return { eyebrow: "PARTYUP LIVE NODE", title: "NOT ELIGIBLE", body: "You need to be participating in this room to claim this node." };
  if (state.status === "invalid") return { eyebrow: "PARTYUP LIVE NODE", title: "NODE NOT FOUND", body: "This QR is not a valid PartyUp Node." };
  return { eyebrow: "PARTYUP LIVE NODE", title: state.name?.toUpperCase() || "HIDDEN NODE", body: state.description || "You found it. Claim it before someone else does." };
}

export default function LiveNodeClaimClient({ token }: { token: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [state, setState] = useState<LiveNodeScanState | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appHandoffToken, setAppHandoffToken] = useState<string | null>(null);
  const [appHandoffSettled, setAppHandoffSettled] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    let nextGuestToken = readStoredGuestSession()?.guestToken ?? null;
    if (!data.user && !nextGuestToken) nextGuestToken = (await createGuestSession(supabase)).guestToken;
    setGuestToken(nextGuestToken);
    setState(await getLiveNodeScanState(supabase, token, nextGuestToken));
  }, [supabase, token]);

  useEffect(() => {
    queueMicrotask(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not open this Live Node.")));
  }, [load]);

  async function claim() {
    setBusy(true); setError(null);
    try { setState(await claimLiveNode(supabase, token, guestToken)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not claim this Live Node."); }
    finally { setBusy(false); }
  }

  const content = state ? copyFor(state) : null;
  const won = state?.status === "winner" || state?.status === "already_claimed_by_you";
  const appUrl = `partyup://n/${encodeURIComponent(token)}${appHandoffToken ? `?handoff=${encodeURIComponent(appHandoffToken)}` : ""}`;

  useEffect(() => {
    if (!won || appHandoffToken) return;
    let active = true;
    void createLiveNodeClaimHandoff(supabase, token, guestToken)
      .then((handoff) => { if (active) setAppHandoffToken(handoff.handoff_token); })
      .catch(() => {
        // The normal deep link still works when browser and app already resolve
        // to the same PartyUp identity.
      })
      .finally(() => { if (active) setAppHandoffSettled(true); });
    return () => { active = false; };
  }, [appHandoffToken, guestToken, supabase, token, won]);

  return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#35104b_0,#07000f_52%)] px-5 py-10 text-white">
    <section className={`w-full max-w-md rounded-2xl border p-6 text-center shadow-2xl ${won ? "border-emerald-300/40 bg-emerald-950/25" : "border-fuchsia-300/20 bg-black/40"}`}>
      {!state && !error ? <><p className="text-xs font-black tracking-[0.22em] text-fuchsia-300">PARTYUP LIVE NODE</p><h1 className="mt-4 text-3xl font-black">VERIFYING NODE…</h1></> : content && <>
        <p className={`text-xs font-black tracking-[0.22em] ${won ? "text-emerald-300" : "text-fuchsia-300"}`}>{content.eyebrow}</p>
        <h1 className="mt-4 text-4xl font-black leading-none">{content.title}</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">{content.body}</p>
        {state?.reward_description && <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-black text-zinc-400">REWARD</p><p className="mt-1 text-xl font-black">{state.reward_description}</p></div>}
        {state?.status === "active" && state.eligible !== false && <button type="button" disabled={busy} onClick={() => void claim()} className="mt-6 min-h-12 w-full rounded-lg bg-fuchsia-600 px-5 font-black hover:bg-fuchsia-500 disabled:opacity-50">{busy ? "Claiming…" : "Claim Live Node"}</button>}
        {state?.room_id && <Link href={`/room/${encodeURIComponent(state.room_id)}`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-white/15 px-5 text-sm font-black hover:bg-white/10">Open Room</Link>}
        {won && !appHandoffSettled
          ? <p className="mt-4 text-sm font-black text-zinc-400">Preparing your secure return to PartyUp…</p>
          : <a href={appUrl} className="mt-4 block text-sm font-black text-fuchsia-300 hover:text-fuchsia-200">{won ? "Return to your room in PartyUp" : "Open in the PartyUp app"}</a>}
      </>}
      {error && <p className="mt-4 rounded-lg bg-red-950/50 p-3 text-sm font-bold text-red-200">{error}</p>}
    </section>
  </main>;
}
