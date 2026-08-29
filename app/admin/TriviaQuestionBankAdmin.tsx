"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  triviaCategories, triviaDifficulties, triviaLabel, type TriviaQuestion,
} from "@/lib/lightningTrivia";

const blankAnswers = ["", "", "", ""];

type FormState = {
  id: string | null;
  question: string;
  answers: string[];
  correctAnswer: "A" | "B" | "C" | "D";
  category: string;
  difficulty: string;
  humour: boolean;
  isActive: boolean;
};

const blankForm: FormState = {
  id: null, question: "", answers: blankAnswers, correctAnswer: "A",
  category: "general_knowledge", difficulty: "medium", humour: false, isActive: true,
};

export default function TriviaQuestionBankAdmin({ supabase }: { supabase: SupabaseClient }) {
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [humour, setHumour] = useState<"" | "yes" | "no">("");
  const [active, setActive] = useState<"" | "yes" | "no">("");
  const [form, setForm] = useState<FormState>(blankForm);
  const [preview, setPreview] = useState<TriviaQuestion | FormState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_admin_trivia_question_bank", {
      p_search: search.trim() || null,
      p_category: category || null,
      p_difficulty: difficulty || null,
      p_humour: humour === "" ? null : humour === "yes",
      p_is_active: active === "" ? null : active === "yes",
      p_limit: 1000,
    });
    if (error) throw new Error(error.message);
    setQuestions((data ?? []) as TriviaQuestion[]);
  }, [active, category, difficulty, humour, search, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((reason) => setMessage(reason instanceof Error ? reason.message : "Could not load questions.")), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const canSave = useMemo(() => form.question.trim() && form.answers.every((answer) => answer.trim()) && new Set(form.answers.map((answer) => answer.trim().toLowerCase())).size === 4, [form]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Question bank operation failed."); }
    finally { setBusy(false); }
  }

  function edit(item: TriviaQuestion) {
    setForm({ id: item.id, question: item.question_text, answers: [...item.answers], correctAnswer: item.correct_answer_key, category: item.category, difficulty: item.difficulty, humour: item.humour, isActive: item.is_active });
    document.getElementById("trivia-question-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    await run(async () => {
      const { error } = await supabase.rpc("admin_upsert_trivia_question", {
        p_question_id: form.id,
        p_question_text: form.question,
        p_answers: form.answers,
        p_correct_answer: form.correctAnswer,
        p_category: form.category,
        p_difficulty: form.difficulty,
        p_humour: form.humour,
        p_is_active: form.isActive,
      });
      if (error) throw new Error(error.message);
      setForm(blankForm); setMessage(form.id ? "Question updated." : "Question created.");
    });
  }

  async function toggleActive(item: TriviaQuestion) {
    await run(async () => {
      const { error } = await supabase.rpc("admin_set_trivia_question_active", { p_question_id: item.id, p_is_active: !item.is_active });
      if (error) throw new Error(error.message);
    });
  }

  async function remove(item: TriviaQuestion) {
    if (!window.confirm(`Permanently delete “${item.question_text}”? Existing rounds keep their snapshot.`)) return;
    await run(async () => {
      const { error } = await supabase.rpc("admin_delete_trivia_question", { p_question_id: item.id });
      if (error) throw new Error(error.message);
      if (form.id === item.id) setForm(blankForm);
    });
  }

  async function importQuestions() {
    await run(async () => {
      let parsed: unknown;
      try { parsed = JSON.parse(importJson); } catch { throw new Error("The import is not valid JSON."); }
      if (!Array.isArray(parsed)) throw new Error("Import JSON must be an array of question objects.");
      const { data, error } = await supabase.rpc("admin_import_trivia_questions", { p_questions: parsed });
      if (error) throw new Error(error.message);
      setMessage(`${Array.isArray(data) ? data.length : parsed.length} questions imported.`);
      setImportJson(""); setImportOpen(false);
    });
  }

  const previewQuestion = preview && "question_text" in preview ? preview.question_text : preview?.question;
  const previewAnswers = preview && "question_text" in preview ? preview.answers : preview?.answers;
  const previewCorrect = preview && "question_text" in preview ? preview.correct_answer : preview ? preview.correctAnswer.charCodeAt(0) - 65 : -1;
  const previewCategory = preview && "question_text" in preview ? preview.category : preview?.category;
  const previewDifficulty = preview && "question_text" in preview ? preview.difficulty : preview?.difficulty;

  return <section id="trivia-bank" className="mt-8 rounded-xl border border-yellow-300/20 bg-[#100a17] p-5 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[0.2em] text-yellow-300">CENTRAL CONTENT</p><h2 className="mt-1 text-2xl font-black">PartyUp Trivia Question Bank</h2><p className="mt-1 text-sm text-[#aaa4b8]">Only site administrators can modify these canonical questions. Hosts receive active questions as read-only choices.</p></div><button type="button" onClick={() => setImportOpen((value) => !value)} className="rounded-md bg-fuchsia-600 px-4 py-3 text-sm font-black">{importOpen ? "Close import" : "Bulk JSON import"}</button></div>
    {message && <p role="status" className="mt-4 rounded-md bg-white/5 p-3 text-sm font-bold">{message}</p>}

    {importOpen && <div className="mt-5 rounded-xl border border-fuchsia-300/20 bg-fuchsia-950/15 p-4"><h3 className="font-black">Import up to 100 questions</h3><p className="mt-1 text-sm text-zinc-400">Paste a JSON array using question_text, answers (four strings), correct_answer (A–D), difficulty, category, humour, and optional is_active.</p><textarea rows={12} value={importJson} onChange={(event) => setImportJson(event.target.value)} className="mt-3 w-full rounded-lg bg-black p-4 font-mono text-sm" placeholder={'[{\n  "question_text": "Which artist... ?",\n  "answers": ["One", "Two", "Three", "Four"],\n  "correct_answer": "C",\n  "difficulty": "easy",\n  "category": "music",\n  "humour": false\n}]'} /><button type="button" disabled={busy || !importJson.trim()} onClick={() => void importQuestions()} className="mt-3 rounded-lg bg-emerald-500 px-5 py-3 font-black text-black disabled:opacity-40">Import questions</button></div>}

    <div id="trivia-question-editor" className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-black">{form.id ? "Edit PartyUp question" : "Create PartyUp question"}</h3>{form.id && <button type="button" onClick={() => setForm(blankForm)} className="rounded border border-white/15 px-3 py-2 text-xs font-black">Cancel edit</button>}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold md:col-span-2">Question<input maxLength={240} value={form.question} onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>{form.answers.map((answer, index) => <label key={index} className="text-sm font-bold">Answer {String.fromCharCode(65 + index)}<input maxLength={100} value={answer} onChange={(event) => setForm((current) => ({ ...current, answers: current.answers.map((value, answerIndex) => answerIndex === index ? event.target.value : value) }))} className="mt-1 w-full rounded-lg bg-black p-3" /></label>)}<label className="text-sm font-bold">Correct answer<select value={form.correctAnswer} onChange={(event) => setForm((current) => ({ ...current, correctAnswer: event.target.value as FormState["correctAnswer"] }))} className="mt-1 w-full rounded-lg bg-black p-3">{["A","B","C","D"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 w-full rounded-lg bg-black p-3">{triviaCategories.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select></label><label className="text-sm font-bold">Difficulty<select value={form.difficulty} onChange={(event) => setForm((current) => ({ ...current, difficulty: event.target.value }))} className="mt-1 w-full rounded-lg bg-black p-3">{triviaDifficulties.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select></label><label className="flex items-center gap-3 rounded-lg bg-black p-3 text-sm font-bold"><input type="checkbox" checked={form.humour} onChange={(event) => setForm((current) => ({ ...current, humour: event.target.checked }))} />Humour question</label><label className="flex items-center gap-3 rounded-lg bg-black p-3 text-sm font-bold"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />Active for hosts</label></div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !canSave} onClick={() => void save()} className="rounded-lg bg-yellow-400 px-5 py-3 font-black text-black disabled:opacity-40">{form.id ? "Save changes" : "Create question"}</button><button type="button" onClick={() => setPreview(form)} className="rounded-lg border border-white/15 px-5 py-3 font-black">Preview</button></div>
    </div>

    <div className="mt-6 grid gap-2 md:grid-cols-5"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions and answers" className="rounded-lg bg-black p-3 md:col-span-2" /><select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg bg-black p-3"><option value="">All categories</option>{triviaCategories.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="rounded-lg bg-black p-3"><option value="">All difficulties</option>{triviaDifficulties.map((value) => <option key={value} value={value}>{triviaLabel(value)}</option>)}</select><select value={humour} onChange={(event) => setHumour(event.target.value as typeof humour)} className="rounded-lg bg-black p-3"><option value="">Humour: all</option><option value="yes">Yes</option><option value="no">No</option></select><select value={active} onChange={(event) => setActive(event.target.value as typeof active)} className="rounded-lg bg-black p-3"><option value="">Status: all</option><option value="yes">Active</option><option value="no">Inactive</option></select></div>
    <p className="mt-3 text-sm font-bold text-zinc-400">{questions.length} question{questions.length === 1 ? "" : "s"}</p>
    <div className="mt-3 max-h-[760px] space-y-2 overflow-y-auto pr-1">{questions.map((item) => <article key={item.id} className={`rounded-lg border p-4 ${item.is_active ? "border-white/10 bg-black/20" : "border-zinc-700 bg-zinc-950/60 opacity-75"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="font-black">{item.question_text}</p><p className="mt-1 text-xs font-bold text-zinc-400">{triviaLabel(item.category)} · {triviaLabel(item.difficulty)}{item.humour ? " · 😄 Humour" : ""} · {item.is_active ? "Active" : "Inactive"}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setPreview(item)} className="rounded border border-white/15 px-3 py-1.5 text-xs font-black">Preview</button><button type="button" onClick={() => edit(item)} className="rounded border border-purple-300/25 px-3 py-1.5 text-xs font-black text-purple-200">Edit</button><button type="button" disabled={busy} onClick={() => void toggleActive(item)} className="rounded border border-amber-300/25 px-3 py-1.5 text-xs font-black text-amber-100">{item.is_active ? "Deactivate" : "Reactivate"}</button><button type="button" disabled={busy} onClick={() => void remove(item)} className="rounded border border-red-300/25 px-3 py-1.5 text-xs font-black text-red-200">Delete</button></div></div><div className="mt-3 grid gap-1 text-sm text-zinc-300 md:grid-cols-2">{item.answers.map((answer, index) => <span key={index} className={index === item.correct_answer ? "font-black text-emerald-200" : ""}>{String.fromCharCode(65 + index)}) {answer}</span>)}</div></article>)}{questions.length === 0 && <p className="rounded-lg border border-dashed border-white/15 p-8 text-center text-zinc-400">No PartyUp questions match these filters.</p>}</div>

    {preview && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[10000] grid place-items-center bg-black/75 p-4"><div className="w-full max-w-lg rounded-2xl border border-yellow-300/30 bg-[#171107] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[0.18em] text-yellow-300">LIGHTNING TRIVIA PREVIEW</p><h3 className="mt-2 text-xl font-black">{previewQuestion}</h3></div><button type="button" onClick={() => setPreview(null)} className="rounded border border-white/15 px-3 py-2 text-sm font-black">Close</button></div><div className="mt-5 grid gap-2">{previewAnswers?.map((answer, index) => <div key={index} className={`rounded-lg border p-3 font-bold ${index === previewCorrect ? "border-emerald-300/50 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-black/30"}`}>{String.fromCharCode(65 + index)}) {answer || "Empty answer"}</div>)}</div><p className="mt-4 text-xs font-bold text-zinc-400">{previewCategory ? triviaLabel(previewCategory) : "Category"} · {previewDifficulty ? triviaLabel(previewDifficulty) : "Difficulty"}</p></div></div>}
  </section>;
}
