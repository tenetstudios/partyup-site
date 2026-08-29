"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  createTriviaRound, generateTriviaQuestionIds, getRoomTrivia, getTriviaQuestionBank,
  saveTriviaQuestion, triviaCategories, triviaDifficulties, triviaLabel,
  type TriviaQuestion, type TriviaRoundSummary,
} from "@/lib/lightningTrivia";
import { getWildRoomState, type WildRoomState } from "@/lib/wild";

const emptyAnswers = ["", "", "", ""];

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomValue = new Uint32Array(1);
    window.crypto.getRandomValues(randomValue);
    const swapIndex = randomValue[0] % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export default function LightningTriviaManager({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const [supabase] = useState(() => createSupabaseClient());
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [rounds, setRounds] = useState<TriviaRoundSummary[]>([]);
  const [wild, setWild] = useState<WildRoomState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [chosenQuestions, setChosenQuestions] = useState<TriviaQuestion[]>([]);
  const [preview, setPreview] = useState<TriviaQuestion | null>(null);
  const [territory, setTerritory] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [countdown, setCountdown] = useState(10);
  const [minimum, setMinimum] = useState(5);
  const [rewards, setRewards] = useState<[number, number, number]>([50, 20, 10]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [humourFilter, setHumourFilter] = useState<"" | "yes" | "no">("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customQuestion, setCustomQuestion] = useState("");
  const [customAnswers, setCustomAnswers] = useState(emptyAnswers);
  const [customCorrect, setCustomCorrect] = useState(0);
  const [customCategory, setCustomCategory] = useState("general_knowledge");
  const [customDifficulty, setCustomDifficulty] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadRoundData = useCallback(async () => {
    const [{ data: roundRows, error: roundsError }, currentRound, wildState] = await Promise.all([
      supabase.rpc("get_lightning_trivia_host_rounds", { p_room_id: roomId }),
      getRoomTrivia(supabase, roomId),
      getWildRoomState(supabase, roomId).catch(() => null),
    ]);
    if (roundsError) throw new Error(roundsError.message);
    setRounds(((roundRows ?? []) as TriviaRoundSummary[]).map((item) => item.id === currentRound?.id ? { ...item, ...currentRound } : item));
    setWild(wildState);
  }, [roomId, supabase]);

  const loadBank = useCallback(async () => {
    setQuestions(await getTriviaQuestionBank(supabase, {
      roomId, search, category: categoryFilter, difficulty: difficultyFilter,
      humour: humourFilter === "" ? null : humourFilter === "yes",
    }));
  }, [categoryFilter, difficultyFilter, humourFilter, roomId, search, supabase]);

  useEffect(() => {
    queueMicrotask(() => void loadRoundData().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load trivia.")));
    const channel = supabase.channel(`trivia-host-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void loadRoundData())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadRoundData, roomId, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBank().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load the question bank.")), 200);
    return () => window.clearTimeout(timer);
  }, [loadBank]);

  const liveRound = rounds.find((item) => ["scheduled", "active", "scoring"].includes(item.status));
  const lastEndedRound = rounds.find((item) => item.status === "ended");
  const activeWild = wild?.game?.status === "active" ? wild.game : null;
  const selectedQuestions = selected.map((id) => chosenQuestions.find((item) => item.id === id)).filter((item): item is TriviaQuestion => Boolean(item));

  async function run(action: () => Promise<unknown>, reloadBank = false) {
    setBusy(true); setError("");
    try { await action(); await loadRoundData(); if (reloadBank) await loadBank(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Trivia operation failed."); }
    finally { setBusy(false); }
  }

  function toggleSelected(question: TriviaQuestion) {
    setSelected((current) => {
      if (current.includes(question.id)) {
        setChosenQuestions((items) => items.filter((item) => item.id !== question.id));
        return current.filter((item) => item !== question.id);
      }
      if (current.length >= 10) return current;
      setChosenQuestions((items) => [...items.filter((item) => item.id !== question.id), question]);
      return [...current, question.id];
    });
  }

  function moveSelected(questionId: string, direction: -1 | 1) {
    setSelected((current) => {
      const from = current.indexOf(questionId); const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current]; [next[from], next[to]] = [next[to], next[from]]; return next;
    });
  }

  async function generateTen() {
    await run(async () => {
      const ids = await generateTriviaQuestionIds(supabase, { roomId, category: categoryFilter, difficulty: difficultyFilter });
      const generatedQuestions = await getTriviaQuestionBank(supabase, { roomId, category: categoryFilter, difficulty: difficultyFilter });
      setSelected(ids); setChosenQuestions(generatedQuestions.filter((item) => ids.includes(item.id)));
      setSearch(""); setHumourFilter("");
    });
  }

  async function createCustomQuestion() {
    await run(async () => {
      await saveTriviaQuestion(supabase, { roomId, question: customQuestion, answers: customAnswers, correctAnswer: customCorrect, category: customCategory, difficulty: customDifficulty });
      setCustomQuestion(""); setCustomAnswers(emptyAnswers); setCustomCorrect(0); setCustomOpen(false);
    }, true);
  }

  return <section className="p-5">
    <p className="text-xs font-black tracking-[0.22em] text-yellow-300">⚡ VERIFIED MISSION</p>
    <h2 className="mt-2 text-2xl font-black">Lightning Trivia</h2>
    <p className="mt-1 text-sm text-zinc-400">Choose ten from PartyUp&apos;s bank. Every launched round keeps an immutable snapshot.</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-950/50 p-3 text-sm font-bold text-red-200">{error}</p>}

    {liveRound ? <div className="mt-5 rounded-xl border border-yellow-300/25 bg-yellow-400/10 p-4">
      <p className="font-black">ROUND {liveRound.status.toUpperCase()}</p>
      <p className="mt-1 text-sm text-zinc-300">{liveRound.participant_count ?? 0} joined · starts {new Date(liveRound.starts_at).toLocaleTimeString()}</p>
      {liveRound.status === "scheduled" && <button type="button" disabled={busy} onClick={() => void run(async () => { const { error: cancelError } = await supabase.rpc("cancel_lightning_trivia_round", { p_round_id: liveRound.id }); if (cancelError) throw new Error(cancelError.message); })} className="mt-3 rounded-lg border border-red-300/30 px-4 py-2 text-sm font-black text-red-200">Cancel round</button>}
    </div> : <>
      <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4">
        <h3 className="font-black">Round setup</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm font-bold">Target territory<select value={territory} onChange={(event) => setTerritory(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3"><option value="">None (room-wide)</option>{activeWild?.config.territories.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="text-sm font-bold">Seconds/question<input type="number" min={3} max={15} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
          <label className="text-sm font-bold">Countdown<input type="number" min={3} max={120} value={countdown} onChange={(event) => setCountdown(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
          <label className="text-sm font-bold">Minimum/faction<input type="number" min={1} max={10} value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
          {["1st reward", "2nd reward", "3rd reward"].map((label, index) => <label key={label} className="text-sm font-bold">{label}<input type="number" min={0} max={100} value={rewards[index]} onChange={(event) => setRewards((current) => current.map((value, itemIndex) => itemIndex === index ? Number(event.target.value) : value) as [number, number, number])} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-yellow-300/20 bg-yellow-400/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">PartyUp Question Bank</h3><p className="mt-1 text-sm text-zinc-400">Search, filter, preview, and select. Canonical questions are read-only for hosts.</p></div><span className="rounded-full bg-yellow-400 px-3 py-1 text-sm font-black text-black">{selected.length}/10 selected</span></div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <input aria-label="Search question bank" placeholder="Search questions and answers" value={search} onChange={(event) => setSearch(event.target.value)} className="rounded-lg bg-black p-3 md:col-span-2" />
          <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg bg-black p-3"><option value="">General Mix / all categories</option>{triviaCategories.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select>
          <select aria-label="Filter by difficulty" value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)} className="rounded-lg bg-black p-3"><option value="">Any difficulty</option>{triviaDifficulties.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select>
          <select aria-label="Filter by humour" value={humourFilter} onChange={(event) => setHumourFilter(event.target.value as "" | "yes" | "no")} className="rounded-lg bg-black p-3"><option value="">Humour: any</option><option value="yes">Humour: yes</option><option value="no">Humour: no</option></select>
          <button type="button" disabled={busy} onClick={() => void generateTen()} className="rounded-lg bg-yellow-400 px-4 py-3 font-black text-black disabled:opacity-40">Generate 10 from PartyUp Bank</button>
          <button type="button" disabled={selected.length < 2} onClick={() => setSelected((current) => shuffled(current))} className="rounded-lg border border-white/15 px-4 py-3 font-black disabled:opacity-40">Shuffle selected</button>
          <button type="button" disabled={!selected.length} onClick={() => { setSelected([]); setChosenQuestions([]); }} className="rounded-lg border border-white/15 px-4 py-3 font-black disabled:opacity-40">Clear</button>
        </div>
        <div className="mt-4 max-h-[560px] space-y-2 overflow-y-auto pr-1">{questions.map((item) => { const isSelected = selected.includes(item.id); return <article key={item.id} className={`rounded-lg border p-3 ${isSelected ? "border-yellow-300/60 bg-yellow-400/10" : "border-white/10 bg-black/25"}`}><div className="flex gap-3"><input type="checkbox" aria-label={`Select ${item.question_text}`} checked={isSelected} disabled={!isSelected && selected.length >= 10} onChange={() => toggleSelected(item)} /><button type="button" onClick={() => setPreview(item)} className="min-w-0 flex-1 text-left"><span className="block font-black">{item.question_text}</span><span className="mt-1 block text-xs text-zinc-400">{triviaLabel(item.category)} · {triviaLabel(item.difficulty)}{item.humour ? " · 😄 Humour" : ""}{item.bank_scope === "custom" ? " · Your custom question" : " · PartyUp"}</span></button><button type="button" onClick={() => setPreview(item)} className="self-start rounded border border-white/15 px-3 py-1.5 text-xs font-black">Preview</button></div></article>; })}{questions.length === 0 && <p className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-zinc-400">No active questions match these filters.</p>}</div>
      </div>

      {selectedQuestions.length > 0 && <div className="mt-5 rounded-xl border border-white/10 p-4"><h3 className="font-black">Round order</h3><ol className="mt-3 space-y-2">{selectedQuestions.map((item, index) => <li key={item.id} className="flex items-center gap-3 rounded-lg bg-black/30 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-yellow-400/15 text-sm font-black text-yellow-200">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-black">{item.question_text}</span><button type="button" disabled={index === 0} onClick={() => moveSelected(item.id, -1)} aria-label={`Move question ${index + 1} up`} className="rounded border border-white/15 px-2 py-1 disabled:opacity-25">↑</button><button type="button" disabled={index === selectedQuestions.length - 1} onClick={() => moveSelected(item.id, 1)} aria-label={`Move question ${index + 1} down`} className="rounded border border-white/15 px-2 py-1 disabled:opacity-25">↓</button><button type="button" onClick={() => toggleSelected(item)} className="rounded border border-red-300/25 px-2 py-1 text-xs font-black text-red-200">Remove</button></li>)}</ol></div>}
      <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yellow-300/25 bg-[#171107]/95 p-4 shadow-2xl backdrop-blur"><span className="font-black">{selected.length}/10 questions ready</span><button type="button" disabled={busy || roomEnded || selected.length !== 10} onClick={() => void run(() => createTriviaRound(supabase, { roomId, questionIds: selected, countdownSeconds: countdown, secondsPerQuestion: seconds, wildGameId: territory ? activeWild?.id : null, territoryKey: territory || null, minimumParticipants: minimum, rewards }))} className="rounded-lg bg-yellow-400 px-5 py-3 font-black text-black disabled:opacity-40">Launch selected 10</button></div>

      <div className="mt-6 border-t border-white/10 pt-5"><button type="button" onClick={() => setCustomOpen((value) => !value)} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-black">{customOpen ? "Close custom question" : "Add an optional custom question"}</button>{customOpen && <div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-2"><label className="text-sm font-bold md:col-span-2">Question<input maxLength={240} value={customQuestion} onChange={(event) => setCustomQuestion(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3" /></label>{customAnswers.map((answer, index) => <label key={index} className="text-sm font-bold">Answer {String.fromCharCode(65 + index)}<input maxLength={100} value={answer} onChange={(event) => setCustomAnswers((current) => current.map((value, answerIndex) => answerIndex === index ? event.target.value : value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}<label className="text-sm font-bold">Correct answer<select value={customCorrect} onChange={(event) => setCustomCorrect(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3">{customAnswers.map((answer, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}{answer ? ` — ${answer}` : ""}</option>)}</select></label><label className="text-sm font-bold">Category<select value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3">{triviaCategories.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select></label><label className="text-sm font-bold">Difficulty<select value={customDifficulty} onChange={(event) => setCustomDifficulty(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3">{triviaDifficulties.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select></label><button type="button" disabled={busy || !customQuestion.trim() || customAnswers.some((answer) => !answer.trim())} onClick={() => void createCustomQuestion()} className="self-end rounded-lg bg-purple-600 px-5 py-3 font-black disabled:opacity-40">Save custom question</button></div>}</div>
    </>}

    {lastEndedRound?.standings && !liveRound && <div className="mt-5 rounded-xl border border-purple-300/20 bg-purple-500/10 p-4"><h3 className="font-black">Last round complete</h3><p className="mt-1 text-sm text-zinc-300">Results and faction contributions are preserved in round history.</p></div>}
    {preview && <div role="dialog" aria-modal="true" aria-label="Trivia question preview" className="fixed inset-0 z-[10000] grid place-items-center bg-black/75 p-4"><div className="w-full max-w-lg rounded-2xl border border-yellow-300/30 bg-[#171107] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[0.18em] text-yellow-300">QUESTION PREVIEW</p><h3 className="mt-2 text-xl font-black">{preview.question_text}</h3></div><button type="button" onClick={() => setPreview(null)} className="rounded border border-white/15 px-3 py-2 text-sm font-black">Close</button></div><div className="mt-5 grid gap-2">{preview.answers.map((answer, index) => <div key={index} className={`rounded-lg border p-3 font-bold ${index === preview.correct_answer ? "border-emerald-300/50 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-black/30"}`}><span className="mr-2 text-zinc-400">{String.fromCharCode(65 + index)})</span>{answer}</div>)}</div><p className="mt-4 text-xs font-bold text-zinc-400">{triviaLabel(preview.category)} · {triviaLabel(preview.difficulty)}{preview.humour ? " · Humour" : ""}</p></div></div>}
  </section>;
}
