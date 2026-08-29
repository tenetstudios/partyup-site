"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importTriviaQuestions, type TriviaQuestion } from "@/lib/lightningTrivia";
import { normalizeTriviaCategory, parseChatGPTTriviaList, validateTriviaImportDraft, type TriviaImportDraft } from "@/lib/triviaImport";

export default function TriviaImportWizard({
  disabled,
  existingQuestions,
  onImported,
  roomId,
  supabase,
}: {
  disabled: boolean;
  existingQuestions: TriviaQuestion[];
  onImported: () => Promise<void>;
  roomId: string;
  supabase: SupabaseClient;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"paste" | "review">("paste");
  const [source, setSource] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultDifficulty, setDefaultDifficulty] = useState("");
  const [drafts, setDrafts] = useState<TriviaImportDraft[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const errorsById = useMemo(() => new Map(drafts.map((draft) => [draft.id, validateTriviaImportDraft(draft, drafts, existingQuestions)])), [drafts, existingQuestions]);
  const errorCount = [...errorsById.values()].filter((errors) => errors.length > 0).length;

  function updateDraft(id: string, update: Partial<TriviaImportDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...update, parseIssues: [] } : draft));
  }

  function parse() {
    const result = parseChatGPTTriviaList(source, { category: defaultCategory, difficulty: defaultDifficulty });
    setDrafts(result.drafts);
    setIgnoredCount(result.ignoredLines.length);
    setTruncated(result.truncated);
    setMessage(result.drafts.length ? "" : "No numbered questions with A–D answers were found.");
    if (result.drafts.length) setStage("review");
  }

  async function importAll() {
    if (!drafts.length || errorCount || busy) return;
    setBusy(true); setMessage("");
    try {
      await importTriviaQuestions(supabase, roomId, drafts);
      await onImported();
      setMessage(`${drafts.length} questions imported.`);
      setSource(""); setDrafts([]); setStage("paste");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not import the question list.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="mt-4 rounded-lg bg-fuchsia-600 px-5 py-3 font-black disabled:opacity-40">Import Question List</button>;

  return <div className="mt-5 rounded-xl border border-fuchsia-300/25 bg-fuchsia-950/15 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-fuchsia-300">BULK CREATION WIZARD</p><h4 className="mt-1 text-xl font-black">{stage === "paste" ? "Paste a ChatGPT question list" : `Review ${drafts.length} questions`}</h4></div><button type="button" onClick={() => { setOpen(false); setMessage(""); }} className="rounded border border-white/15 px-3 py-2 text-xs font-black">Close</button></div>

    {stage === "paste" ? <>
      <p className="mt-3 text-sm text-zinc-400">Use numbered questions, answers A–D, and bold exactly one answer. Markdown, line-ending backslashes, and HTML spaces are accepted.</p>
      <textarea value={source} onChange={(event) => setSource(event.target.value)} rows={14} placeholder={'1. **Question?**\n   A) Choice\n   **B) Correct choice**\n   C) Choice\n   D) Choice'} className="mt-4 w-full resize-y rounded-lg bg-black p-4 font-mono text-sm leading-6 text-white" />
      <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">Default category (optional)<input maxLength={60} value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value)} placeholder="Blank / Uncategorized" className="mt-1 w-full rounded-lg bg-black p-3" /></label><label className="text-sm font-bold">Default difficulty (optional)<input maxLength={40} value={defaultDifficulty} onChange={(event) => setDefaultDifficulty(event.target.value)} placeholder="Easy, Medium, Hard…" className="mt-1 w-full rounded-lg bg-black p-3" /></label></div>
      <button type="button" disabled={!source.trim()} onClick={parse} className="mt-4 rounded-lg bg-fuchsia-500 px-5 py-3 font-black disabled:opacity-40">Parse Questions</button>
    </> : <>
      {(ignoredCount > 0 || truncated) && <p className="mt-3 rounded-lg bg-amber-950/40 p-3 text-sm font-bold text-amber-200">{ignoredCount > 0 ? `${ignoredCount} unrecognized non-empty lines were ignored. ` : ""}{truncated ? "Only the first 100 questions are shown." : ""}</p>}
      <div className="mt-4 space-y-4">{drafts.map((draft, draftIndex) => { const draftErrors = errorsById.get(draft.id) ?? []; return <article key={draft.id} className={`rounded-xl border p-4 ${draftErrors.length ? "border-red-300/30 bg-red-950/15" : "border-emerald-300/20 bg-black/25"}`}>
        <div className="flex items-center justify-between gap-3"><p className="font-black">Question {draftIndex + 1}</p><button type="button" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))} className="rounded border border-red-300/25 px-3 py-1.5 text-xs font-black text-red-200">Remove</button></div>
        <label className="mt-3 block text-sm font-bold">Question<input maxLength={240} value={draft.question} onChange={(event) => updateDraft(draft.id, { question: event.target.value })} className="mt-1 w-full rounded-lg bg-black p-3" /></label>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{draft.answers.map((answer, answerIndex) => <label key={answerIndex} className="text-sm font-bold">Answer {String.fromCharCode(65 + answerIndex)}<input maxLength={100} value={answer} onChange={(event) => updateDraft(draft.id, { answers: draft.answers.map((value, index) => index === answerIndex ? event.target.value : value) })} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-sm font-bold">Correct answer<select value={draft.correctAnswer ?? ""} onChange={(event) => updateDraft(draft.id, { correctAnswer: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 w-full rounded-lg bg-black p-3"><option value="">Choose…</option>{draft.answers.map((answer, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}{answer ? ` — ${answer}` : ""}</option>)}</select></label><label className="text-sm font-bold">Category<input maxLength={60} value={draft.category} onChange={(event) => updateDraft(draft.id, { category: normalizeTriviaCategory(event.target.value) })} placeholder="Blank" className="mt-1 w-full rounded-lg bg-black p-3" /></label><label className="text-sm font-bold">Difficulty<input maxLength={40} value={draft.difficulty} onChange={(event) => updateDraft(draft.id, { difficulty: event.target.value })} className="mt-1 w-full rounded-lg bg-black p-3" /></label></div>
        {draftErrors.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-bold text-red-200">{draftErrors.map((item) => <li key={item}>{item}</li>)}</ul>}
      </article>; })}</div>
      <div className="sticky bottom-3 mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#170b22]/95 p-3 shadow-2xl backdrop-blur"><button type="button" onClick={() => setStage("paste")} className="rounded-lg border border-white/15 px-4 py-3 font-black">Back to paste</button><button type="button" disabled={busy || !drafts.length || errorCount > 0} onClick={() => void importAll()} className="rounded-lg bg-emerald-500 px-5 py-3 font-black text-black disabled:opacity-40">{busy ? "Importing…" : `Import ${drafts.length} questions`}</button><p className={`text-sm font-bold ${errorCount ? "text-red-200" : "text-emerald-200"}`}>{errorCount ? `${errorCount} question${errorCount === 1 ? "" : "s"} need attention` : "Ready to import"}</p></div>
    </>}
    {message && <p role="status" className="mt-4 rounded-lg bg-white/5 p-3 text-sm font-bold">{message}</p>}
  </div>;
}
