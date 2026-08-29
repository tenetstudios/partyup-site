export type TriviaImportDraft = {
  id: string;
  sourceNumber: number;
  question: string;
  answers: string[];
  correctAnswer: number | null;
  category: string;
  difficulty: string;
  parseIssues: string[];
};

export type TriviaQuestionIdentity = { question_text: string };

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function cleanMarkdown(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(?:strong|b)>/gi, "**")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[_*]+|[_*]+$/g, "")
    .replace(/\\\s*$/, "")
    .trim();
}

export function normalizeTriviaCategory(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.toLowerCase() === "uncategorized" ? "" : normalized;
}

export function parseChatGPTTriviaList(
  source: string,
  defaults: { category?: string; difficulty?: string } = {},
) {
  const normalized = decodeHtmlEntities(source)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong>/gi, "**")
    .replace(/<\/strong>/gi, "**")
    .replace(/\r\n?/g, "\n")
    .replace(/\\[ \t]*$/gm, "");
  const drafts: TriviaImportDraft[] = [];
  const ignoredLines: string[] = [];
  let current: (TriviaImportDraft & { correctCandidates: Set<number> }) | null = null;

  const finishCurrent = () => {
    if (!current) return;
    const parseIssues = [...current.parseIssues];
    if (current.correctCandidates.size === 0) parseIssues.push("Bold exactly one answer to mark it correct.");
    if (current.correctCandidates.size > 1) parseIssues.push("More than one answer is marked correct.");
    drafts.push({
      id: current.id,
      sourceNumber: current.sourceNumber,
      question: current.question,
      answers: current.answers,
      correctAnswer: current.correctCandidates.size === 1 ? [...current.correctCandidates][0] : null,
      category: current.category,
      difficulty: current.difficulty,
      parseIssues,
    });
    current = null;
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const questionMatch = line.match(/^(\d{1,3})\s*[.)]\s+(.+)$/);
    if (questionMatch) {
      finishCurrent();
      const sourceNumber = Number(questionMatch[1]);
      current = {
        id: `import-${sourceNumber}-${drafts.length}`,
        sourceNumber,
        question: cleanMarkdown(questionMatch[2]),
        answers: ["", "", "", ""],
        correctAnswer: null,
        correctCandidates: new Set<number>(),
        category: normalizeTriviaCategory(defaults.category),
        difficulty: defaults.difficulty?.trim() ?? "",
        parseIssues: [],
      };
      continue;
    }

    if (!current) {
      ignoredLines.push(line);
      continue;
    }

    const withoutBullet = line.replace(/^[-*]\s+/, "");
    const plainLine = withoutBullet.replace(/\*\*/g, "");
    const answerMatch = plainLine.match(/^([A-D])\s*[).:]\s+(.+)$/i);
    if (!answerMatch) {
      ignoredLines.push(line);
      continue;
    }
    const answerIndex = answerMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (current.answers[answerIndex]) current.parseIssues.push(`Answer ${answerMatch[1].toUpperCase()} appears more than once.`);
    current.answers[answerIndex] = cleanMarkdown(answerMatch[2]);
    if (/\*\*/.test(withoutBullet)) current.correctCandidates.add(answerIndex);
  }
  finishCurrent();

  return { drafts: drafts.slice(0, 100), ignoredLines, truncated: drafts.length > 100 };
}

export function validateTriviaImportDraft(
  draft: TriviaImportDraft,
  allDrafts: TriviaImportDraft[],
  existingQuestions: TriviaQuestionIdentity[],
) {
  const errors = [...draft.parseIssues];
  const question = draft.question.trim();
  if (!question) errors.push("Question is required.");
  else if (question.length > 240) errors.push("Question must be 240 characters or fewer.");
  draft.answers.forEach((answer, index) => {
    const clean = answer.trim();
    if (!clean) errors.push(`Answer ${String.fromCharCode(65 + index)} is required.`);
    else if (clean.length > 100) errors.push(`Answer ${String.fromCharCode(65 + index)} must be 100 characters or fewer.`);
  });
  const filledAnswers = draft.answers.map((answer) => answer.trim().toLowerCase()).filter(Boolean);
  if (new Set(filledAnswers).size !== filledAnswers.length) errors.push("Answer choices must be unique.");
  if (draft.correctAnswer === null || draft.correctAnswer < 0 || draft.correctAnswer > 3) errors.push("Choose exactly one correct answer.");
  if (normalizeTriviaCategory(draft.category).length > 60) errors.push("Category must be 60 characters or fewer.");
  if (draft.difficulty.trim().length > 40) errors.push("Difficulty must be 40 characters or fewer.");

  const normalizedQuestion = question.toLowerCase();
  if (normalizedQuestion && allDrafts.some((item) => item.id !== draft.id && item.question.trim().toLowerCase() === normalizedQuestion)) {
    errors.push("This question appears more than once in the pasted list.");
  }
  if (normalizedQuestion && existingQuestions.some((item) => item.question_text.trim().toLowerCase() === normalizedQuestion)) {
    errors.push("This question already exists in the active question bank.");
  }
  return [...new Set(errors)];
}
