"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createGuestSession, readStoredGuestSession } from "@/lib/matchmaking";
import { getRoomTrivia, getTriviaPlayerState, getTriviaTimeline, joinTriviaRound, submitTriviaAnswer, type TriviaPlayerState } from "@/lib/lightningTrivia";
import { createSupabaseClient } from "@/lib/supabase";

const factionDetails: Record<string, { label: string; emoji: string }> = {
  pack: { label: "Pack", emoji: "🐺" }, marsh: { label: "Marsh", emoji: "🐸" }, pride: { label: "Pride", emoji: "🦁" },
};

export default function LightningTriviaClient({ roomId }: { roomId: string }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [state, setState] = useState<TriviaPlayerState | null>(null);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [feedback, setFeedback] = useState<Record<number, { correct: boolean; score: number }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [guestToken, setGuestToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const summary = await getRoomTrivia(supabase, roomId);
    if (!summary) { setError("No Lightning Trivia round is available."); return; }
    const { data: authData } = await supabase.auth.getUser();
    let token = guestToken ?? readStoredGuestSession()?.guestToken ?? null;
    if (!authData.user && !token) {
      token = (await createGuestSession(supabase)).guestToken;
      setGuestToken(token);
    }
    const next = await getTriviaPlayerState(supabase, summary.id, token);
    setState(next);
    setSelected(Object.fromEntries(next.answers.map((answer) => [answer.question_order, answer.selected_answer])));
    setFeedback(Object.fromEntries(next.answers.map((answer) => [answer.question_order, { correct: answer.is_correct, score: answer.score_awarded }])));
    setError("");
  }, [guestToken, roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => { setNow(Date.now()); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not open trivia.")); });
    const clock = window.setInterval(() => setNow(Date.now()), 50);
    const refresh = window.setInterval(() => void load(), 2000);
    const channel = supabase.channel(`trivia-player-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => { window.clearInterval(clock); window.clearInterval(refresh); void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  const timeline = useMemo(() => state ? getTriviaTimeline(state.round.starts_at, state.round.seconds_per_question, state.round.feedback_ms, now) : null, [now, state]);
  const question = timeline && timeline.questionIndex >= 0 && timeline.questionIndex < 10 ? state?.questions[timeline.questionIndex] : null;
  const lockedAnswer = question ? selected[question.question_order] : undefined;

  async function join() {
    if (!state || busy) return;
    setBusy(true); setError("");
    try { await joinTriviaRound(supabase, state.round.id, guestToken); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join."); }
    finally { setBusy(false); }
  }

  async function answer(index: number) {
    if (!state || !question || lockedAnswer !== undefined || timeline?.phase !== "question") return;
    setSelected((current) => ({ ...current, [question.question_order]: index }));
    try {
      const result = await submitTriviaAnswer(supabase, state.round.id, question.question_order, index, guestToken);
      setFeedback((current) => ({ ...current, [question.question_order]: { correct: result.correct, score: result.score_awarded } }));
    } catch (reason) {
      setError(reason instanceof Error && !reason.message.toLowerCase().includes("time is up") ? reason.message : "");
    }
  }

  if (!state) return <section className="grid min-h-[70dvh] place-items-center text-center"><div><p className="text-5xl">⚡</p><p className="mt-4 font-black">{error || "LOADING ROUND…"}</p></div></section>;
  const countdown = Math.max(0, Math.ceil((Date.parse(state.round.starts_at) - now) / 1000));

  if (state.round.status === "ended") {
    return <section className="py-10 text-center"><p className="text-sm font-black tracking-[0.22em] text-yellow-300">ROUND COMPLETE</p><h1 className="mt-3 text-4xl font-black">FACTION RESULTS</h1>
      <div className="mt-8 space-y-3 text-left">{(state.round.standings ?? []).map((standing) => { const faction = factionDetails[standing.faction_key] ?? { label: standing.faction_key, emoji: "⚡" }; return <div key={standing.faction_key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] p-4"><span className="text-xl font-black">{standing.eligible ? `${standing.placement}. ` : ""}{faction.emoji} {faction.label.toUpperCase()}</span><span className="font-black">{standing.eligible ? standing.average_score.toLocaleString() : "INSUFFICIENT PARTICIPATION"}</span></div>; })}</div>
      {state.player_result && <div className="mt-8 rounded-2xl border border-yellow-300/25 bg-yellow-400/10 p-6"><p className="text-sm font-black text-yellow-200">YOUR SCORE</p><p className="mt-2 text-5xl font-black">{state.player_result.total_score.toLocaleString()}</p><p className="mt-2 font-bold text-zinc-300">{state.player_result.correct_count}/10 correct</p>{state.faction_key && <p className="mt-4 font-black text-yellow-200">{state.player_result.counted_for_faction ? `YOUR SCORE COUNTED FOR ${(factionDetails[state.faction_key]?.label ?? state.faction_key).toUpperCase()}` : `You helped ${factionDetails[state.faction_key]?.label ?? state.faction_key} compete.`}</p>}</div>}
      {state.round.reward_status === "wild_ended" && <p className="mt-5 text-sm font-bold text-amber-300">The Wild ended during the round, so no territory influence was applied.</p>}
    </section>;
  }

  if (!state.joined) {
    const canJoin = state.round.status === "scheduled" && countdown > 0;
    return <section className="grid min-h-[75dvh] place-items-center py-10 text-center"><div><p className="text-6xl">⚡</p><p className="mt-5 text-sm font-black tracking-[0.22em] text-yellow-300">LIGHTNING TRIVIA</p><h1 className="mt-3 text-4xl font-black">10 QUESTIONS.<br />5 SECONDS EACH.</h1><p className="mx-auto mt-4 max-w-md text-lg font-bold text-zinc-300">Your faction&apos;s best players are fighting for the territory.</p>{canJoin ? <><p className="mt-7 text-6xl font-black tabular-nums">{countdown}</p><button type="button" disabled={busy} onClick={() => void join()} className="mt-6 min-h-14 w-full rounded-xl bg-yellow-400 px-8 text-xl font-black text-black disabled:opacity-50">{busy ? "JOINING…" : "JOIN ROUND"}</button></> : <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5 font-black">ROUND IN PROGRESS<br /><span className="mt-2 block text-sm text-zinc-400">Joining closed at the start. Results will appear here.</span></div>}{error && <p className="mt-4 text-sm font-bold text-red-300">{error}</p>}</div></section>;
  }

  if (timeline?.phase === "countdown") return <section className="grid min-h-[75dvh] place-items-center text-center"><div><p className="text-sm font-black tracking-[0.24em] text-yellow-300">ROUND STARTS IN</p><p className="mt-5 text-[9rem] font-black leading-none tabular-nums">{Math.max(1, Math.ceil(timeline.countdownMs / 1000))}</p></div></section>;
  if (timeline?.phase === "complete" || state.round.status === "scoring") return <section className="grid min-h-[75dvh] place-items-center text-center"><div><p className="text-6xl animate-pulse">⚡</p><h1 className="mt-5 text-3xl font-black">CALCULATING THE BATTLE…</h1></div></section>;
  if (!question) return null;
  const result = feedback[question.question_order];
  const displayFeedback = timeline?.phase === "feedback";

  return <section className="flex min-h-[calc(100dvh-5rem)] flex-col py-5">
    <div className="flex items-center justify-between"><p className="font-black text-zinc-300">QUESTION {question.question_order} / 10</p><div className={`grid h-16 w-16 place-items-center rounded-full border-4 text-2xl font-black tabular-nums ${timeline?.remainingMs && timeline.remainingMs < 1500 ? "border-red-400 text-red-300" : "border-yellow-300 text-yellow-200"}`}>{timeline?.phase === "question" ? Math.max(1, Math.ceil(timeline.remainingMs / 1000)) : "0"}</div></div>
    {displayFeedback ? <div className="grid flex-1 place-items-center text-center"><div><p className={`text-6xl font-black ${result?.correct ? "text-emerald-300" : "text-red-300"}`}>{result ? result.correct ? "CORRECT" : "WRONG" : "TIME"}</p>{result?.correct && <p className="mt-3 text-4xl font-black text-yellow-200">+{result.score}</p>}</div></div> : <><h1 className="flex min-h-[8rem] items-center py-4 text-3xl font-black leading-tight sm:text-4xl">{question.question_text}</h1><div className="grid flex-1 grid-rows-4 gap-3">{question.answers.map((choice, index) => <button key={index} type="button" disabled={lockedAnswer !== undefined} onClick={() => void answer(index)} className={`min-h-16 rounded-xl border px-5 text-left text-xl font-black transition ${lockedAnswer === index ? "border-yellow-200 bg-yellow-400 text-black" : lockedAnswer !== undefined ? "border-white/5 bg-white/[0.03] text-zinc-500" : "border-purple-300/25 bg-purple-500/15 active:scale-[0.98] active:bg-purple-500/30"}`}><span className="mr-3 text-sm opacity-70">{String.fromCharCode(65 + index)}</span>{choice}</button>)}</div></>}
  </section>;
}
