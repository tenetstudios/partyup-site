"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import { createTriviaRound, getRoomTrivia, saveTriviaQuestion, type TriviaQuestion, type TriviaRoundSummary } from "@/lib/lightningTrivia";
import { getWildRoomState, type WildRoomState } from "@/lib/wild";
import TriviaImportWizard from "./TriviaImportWizard";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(emptyAnswers);
  const [correctAnswer, setCorrectAnswer] = useState(0);
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [territory, setTerritory] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [countdown, setCountdown] = useState(10);
  const [minimum, setMinimum] = useState(5);
  const [rewards, setRewards] = useState<[number, number, number]>([50, 20, 10]);
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [{ data: bank, error: bankError }, { data: roundRows, error: roundsError }, currentRound, wildState] = await Promise.all([
      supabase.rpc("get_trivia_question_bank", { p_room_id: roomId, p_search: null }),
      supabase.rpc("get_lightning_trivia_host_rounds", { p_room_id: roomId }),
      getRoomTrivia(supabase, roomId),
      getWildRoomState(supabase, roomId).catch(() => null),
    ]);
    if (bankError || roundsError) throw new Error(bankError?.message || roundsError?.message);
    setQuestions((bank ?? []) as TriviaQuestion[]);
    setRounds(((roundRows ?? []) as TriviaRoundSummary[]).map((item) => item.id === currentRound?.id ? { ...item, ...currentRound } : item));
    setWild(wildState);
  }, [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load trivia.")));
    const channel = supabase.channel(`trivia-host-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_rounds", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, roomId, supabase]);

  const visibleQuestions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? questions.filter((item) => item.question_text.toLowerCase().includes(needle) || item.category?.toLowerCase().includes(needle)) : questions;
  }, [questions, search]);
  const liveRound = rounds.find((item) => ["scheduled", "active", "scoring"].includes(item.status));
  const lastEndedRound = rounds.find((item) => item.status === "ended");
  const activeWild = wild?.game?.status === "active" ? wild.game : null;
  const difficultyOptions = useMemo(() => {
    const values = new Map<string, string>();
    questions.forEach((item) => {
      const value = item.difficulty?.trim();
      if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
    });
    return [...values.values()].sort((left, right) => left.localeCompare(right));
  }, [questions]);
  const selectedQuestions = selected.map((id) => questions.find((item) => item.id === id)).filter((item): item is TriviaQuestion => Boolean(item));

  function resetForm() {
    setEditingId(null); setQuestion(""); setAnswers(emptyAnswers); setCorrectAnswer(0); setCategory(""); setDifficulty("");
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Trivia operation failed."); }
    finally { setBusy(false); }
  }

  function beginEdit(item: TriviaQuestion) {
    setEditingId(item.id); setQuestion(item.question_text); setAnswers([...item.answers]);
    setCorrectAnswer(item.correct_answer); setCategory(item.category ?? ""); setDifficulty(item.difficulty ?? "");
  }

  async function archive(item: TriviaQuestion) {
    if (!window.confirm(`Delete “${item.question_text}”? It will be archived so historical rounds stay intact.`)) return;
    await run(async () => {
      const { error: archiveError } = await supabase.rpc("archive_trivia_question", { p_room_id: roomId, p_question_id: item.id });
      if (archiveError) throw new Error(archiveError.message);
      setSelected((current) => current.filter((id) => id !== item.id));
    });
  }

  function selectRandomTen() {
    const pool = questions.filter((item) => !difficultyFilter || item.difficulty?.trim().toLowerCase() === difficultyFilter.toLowerCase());
    if (pool.length < 10) {
      setError(`Only ${pool.length} active question${pool.length === 1 ? " is" : "s are"} available${difficultyFilter ? ` at ${difficultyFilter} difficulty` : ""}. Add at least ${10 - pool.length} more.`);
      return;
    }
    setSelected(shuffled(pool).slice(0, 10).map((item) => item.id));
    setError("");
  }

  function shuffleSelected() {
    if (selected.length < 2) return;
    setSelected((current) => shuffled(current));
  }

  function moveSelected(questionId: string, direction: -1 | 1) {
    setSelected((current) => {
      const from = current.indexOf(questionId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  return (
    <section className="p-5">
      <p className="text-xs font-black tracking-[0.22em] text-yellow-300">⚡ VERIFIED MISSION</p>
      <h2 className="mt-2 text-2xl font-black">Lightning Trivia</h2>
      <p className="mt-1 text-sm text-zinc-400">Ten synchronized questions. Five frantic seconds each. Top 10 faction average.</p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-950/50 p-3 text-sm font-bold text-red-200">{error}</p>}

      {liveRound ? (
        <div className="mt-5 rounded-xl border border-yellow-300/25 bg-yellow-400/10 p-4">
          <p className="font-black">ROUND {liveRound.status.toUpperCase()}</p>
          <p className="mt-1 text-sm text-zinc-300">{liveRound.participant_count ?? 0} joined · starts {new Date(liveRound.starts_at).toLocaleTimeString()}</p>
          {liveRound.status === "scheduled" && <button type="button" disabled={busy} onClick={() => void run(async () => {
            const { error: cancelError } = await supabase.rpc("cancel_lightning_trivia_round", { p_round_id: liveRound.id });
            if (cancelError) throw new Error(cancelError.message);
          })} className="mt-3 rounded-lg border border-red-300/30 px-4 py-2 text-sm font-black text-red-200">Cancel round</button>}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4">
          <h3 className="font-black">Create round</h3>
          <p className="mt-1 text-sm text-zinc-400">Select exactly 10 questions below. Their current text and answers will be snapshotted.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-bold">Target territory<select value={territory} onChange={(event) => setTerritory(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3"><option value="">None (room-wide)</option>{activeWild?.config.territories.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <label className="text-sm font-bold">Seconds/question<input type="number" min={3} max={15} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
            <label className="text-sm font-bold">Countdown<input type="number" min={3} max={120} value={countdown} onChange={(event) => setCountdown(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
            <label className="text-sm font-bold">Minimum/faction<input type="number" min={1} max={10} value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
            {["1st reward", "2nd reward", "3rd reward"].map((label, index) => <label key={label} className="text-sm font-bold">{label}<input type="number" min={0} max={100} value={rewards[index]} onChange={(event) => setRewards((current) => current.map((value, itemIndex) => itemIndex === index ? Number(event.target.value) : value) as [number, number, number])} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}
          </div>
          {selectedQuestions.length > 0 && <ol className="mt-4 space-y-2">{selectedQuestions.map((item, index) => <li key={item.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-yellow-400/15 text-sm font-black text-yellow-200">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{item.question_text}</span>{item.difficulty && <span className="text-xs text-zinc-500">{item.difficulty}</span>}</span><button type="button" disabled={index === 0} onClick={() => moveSelected(item.id, -1)} aria-label={`Move question ${index + 1} up`} className="rounded border border-white/15 px-2 py-1 disabled:opacity-25">↑</button><button type="button" disabled={index === selectedQuestions.length - 1} onClick={() => moveSelected(item.id, 1)} aria-label={`Move question ${index + 1} down`} className="rounded border border-white/15 px-2 py-1 disabled:opacity-25">↓</button><button type="button" onClick={() => setSelected((current) => current.filter((id) => id !== item.id))} className="rounded border border-red-300/25 px-2 py-1 text-xs font-black text-red-200">Remove</button></li>)}</ol>}
          <button type="button" disabled={busy || roomEnded || selected.length !== 10} onClick={() => void run(() => createTriviaRound(supabase, {
            roomId, questionIds: selected, countdownSeconds: countdown, secondsPerQuestion: seconds,
            wildGameId: territory ? activeWild?.id : null, territoryKey: territory || null,
            minimumParticipants: minimum, rewards,
          }))} className="mt-4 rounded-lg bg-yellow-400 px-5 py-3 font-black text-black disabled:opacity-40">Launch selected 10 ({selected.length}/10)</button>
        </div>
      )}

      {lastEndedRound?.standings && !liveRound && <div className="mt-5 rounded-xl border border-purple-300/20 bg-purple-500/10 p-4"><h3 className="font-black">Latest faction result</h3><div className="mt-3 space-y-2">{lastEndedRound.standings.map((standing) => <div key={standing.faction_key} className="flex justify-between gap-4 text-sm font-bold"><span>{standing.eligible ? `${standing.placement}. ` : ""}{standing.faction_key.toUpperCase()} ({standing.participant_count})</span><span>{standing.eligible ? standing.average_score.toLocaleString() : "Insufficient participation"}</span></div>)}</div><p className="mt-3 text-xs font-bold text-zinc-400">Reward: {lastEndedRound.reward_status.replace(/_/g, " ")}</p></div>}

      <div className="mt-7 border-t border-white/10 pt-6">
        <h3 className="text-lg font-black">Lightning Trivia Questions</h3>
        <p className="mt-1 text-sm text-zinc-400">Questions should be readable in a few seconds. Keep answers short.</p>
        <TriviaImportWizard disabled={busy || roomEnded} existingQuestions={questions} onImported={load} roomId={roomId} supabase={supabase} />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-bold md:col-span-2">Question<input maxLength={240} value={question} onChange={(event) => setQuestion(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
          {answers.map((answer, index) => <label key={index} className="text-sm font-bold">Answer {String.fromCharCode(65 + index)}<input maxLength={100} value={answer} onChange={(event) => setAnswers((current) => current.map((value, answerIndex) => answerIndex === index ? event.target.value : value))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}
          <label className="text-sm font-bold">Correct answer<select value={correctAnswer} onChange={(event) => setCorrectAnswer(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-black p-3">{answers.map((answer, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}{answer ? ` — ${answer}` : ""}</option>)}</select></label>
          <label className="text-sm font-bold">Category<input maxLength={60} value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
          <label className="text-sm font-bold">Difficulty (optional)<input maxLength={40} value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
        </div>
        <div className="mt-4 flex gap-2"><button type="button" disabled={busy || !question.trim() || answers.some((answer) => !answer.trim())} onClick={() => void run(async () => {
          await saveTriviaQuestion(supabase, { roomId, id: editingId, question, answers, correctAnswer, category, difficulty }); resetForm();
        })} className="rounded-lg bg-purple-600 px-5 py-3 font-black disabled:opacity-40">{editingId ? "Save changes" : "Create question"}</button>{editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-white/15 px-5 py-3 font-black">Cancel</button>}</div>
      </div>

      <div className="mt-7 border-t border-white/10 pt-6">
        <div className="mb-4 rounded-xl border border-yellow-300/20 bg-yellow-400/5 p-4">
          <p className="font-black">Random question draw</p>
          <p className="mt-1 text-sm text-zinc-400">Draw ten distinct active questions, then inspect or reorder them before launch.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-48 text-sm font-bold">Difficulty<select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)} className="mt-1 w-full rounded-lg bg-black p-3"><option value="">Any difficulty</option>{difficultyOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <button type="button" disabled={questions.length < 10} onClick={selectRandomTen} className="min-h-11 rounded-lg bg-yellow-400 px-4 font-black text-black disabled:opacity-40">Random 10</button>
            <button type="button" disabled={selected.length < 2} onClick={shuffleSelected} className="min-h-11 rounded-lg border border-white/15 px-4 font-black disabled:opacity-40">Shuffle selected</button>
            <span className="pb-3 text-sm font-bold text-zinc-400">{selected.length}/10 selected</span>
          </div>
        </div>
        <input aria-label="Search questions" placeholder="Search questions or categories" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg bg-black p-3" />
        <div className="mt-3 space-y-2">{visibleQuestions.map((item) => <article key={item.id} className={`rounded-lg border p-3 ${selected.includes(item.id) ? "border-yellow-300/50 bg-yellow-400/10" : "border-white/10 bg-black/25"}`}>
          <label className="flex cursor-pointer gap-3"><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 10} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span className="min-w-0 flex-1"><span className="block font-black">{item.question_text}</span><span className="mt-1 block text-xs text-zinc-400">{item.category || "Uncategorized"}{item.difficulty ? ` · ${item.difficulty}` : ""} · Correct: {item.answers[item.correct_answer]}</span></span></label>
          <div className="mt-3 flex gap-2"><button type="button" onClick={() => beginEdit(item)} className="rounded border border-white/15 px-3 py-1.5 text-xs font-black">Edit</button><button type="button" onClick={() => void archive(item)} className="rounded border border-red-300/25 px-3 py-1.5 text-xs font-black text-red-200">Delete</button></div>
        </article>)}</div>
      </div>
    </section>
  );
}
