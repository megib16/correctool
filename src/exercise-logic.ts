// The rules for exercises, with no browser or network code, so they can be tested on their own.
import { TYPE_LABELS } from "./types";
import type { ErrorType, Exercise, ExerciseKind, ExerciseStats, PairStat, Stats } from "./types";

export const BLANK = "___";
const KINDS: ExerciseKind[] = ["choice", "fill", "reorder"];

/** Makes two answers comparable: ignores capitals, spacing and punctuation, but not accents. */
export function normalize(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[.,!?;:"“”«»()…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The complete correct sentence, for showing and for reading aloud. */
export function fullSentence(ex: Exercise): string {
  return ex.kind === "reorder" ? ex.answer : ex.prompt.replace(BLANK, ex.answer);
}

export function isCorrect(ex: Exercise, given: string): boolean {
  const g = normalize(given);
  if (!g) return false;
  const answers = [ex.answer, ...ex.accepted];
  // typing the whole sentence instead of just the missing word is fine too
  const candidates = ex.kind === "reorder" ? answers : [...answers, ...answers.map((a) => ex.prompt.replace(BLANK, a))];
  return candidates.some((c) => normalize(c) === g);
}

/** The words of a sentence in a scrambled order (never the original order). */
export function shuffleWords(answer: string, rand: () => number = Math.random): string[] {
  const words = answer.trim().replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length) words[0] = words[0][0].toLowerCase() + words[0].slice(1); // a capital would give away the first word
  const same = (a: string[]) => a.join(" ").toLowerCase() === words.join(" ").toLowerCase();
  if (words.length < 2 || new Set(words.map((w) => w.toLowerCase())).size < 2) return words;
  let out = words;
  for (let tries = 0; tries < 30 && same(out); tries++) {
    out = [...words];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

const asString = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asStrings = (v: unknown) => (Array.isArray(v) ? v.map(asString).filter(Boolean) : []);

/** Checks what the AI returned. Anything unusable is dropped (returns null) instead of breaking the session. */
export function validateExercise(raw: unknown, rand: () => number = Math.random): Exercise | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as ExerciseKind;
  if (!KINDS.includes(kind)) return null;
  const type = (r.type as ErrorType) in TYPE_LABELS ? (r.type as ErrorType) : "other";
  const ex: Exercise = {
    kind,
    type,
    prompt: asString(r.prompt),
    options: asStrings(r.options),
    answer: asString(r.answer),
    accepted: asStrings(r.accepted),
    explanation: asString(r.explanation),
    hint: asString(r.hint),
  };
  if (!ex.answer || !ex.explanation) return null;

  if (kind === "reorder") {
    const words = ex.answer.trim().split(/\s+/);
    if (words.length < 3 || words.length > 12) return null;
    ex.options = [];
    return ex;
  }

  // choice and fill: exactly one blank in the sentence
  if (ex.prompt.split(BLANK).length !== 2) return null;
  if (kind === "fill") {
    ex.options = [];
    return ex;
  }
  // choice: the right answer must be among the options, with no duplicates, in a random order
  const seen = new Set<string>();
  const options = [ex.answer, ...ex.options].filter((o) => {
    const key = normalize(o);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (options.length < 2 || options.length > 5) return null;
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  ex.options = options;
  return ex;
}

export interface WeakArea {
  type: ErrorType;
  mistakes: number;
  attempts: number;
  accuracy: number | null; // null until there are at least 3 exercise answers to go on
}

/** The learner's weak spots, worst first: many mistakes in speaking and low accuracy in exercises both push a topic up. */
export function weakAreas(stats: Stats, ex: ExerciseStats): WeakArea[] {
  const types = new Set<ErrorType>([...Object.keys(stats.byType), ...Object.keys(ex.byType)] as ErrorType[]);
  const areas = [...types]
    .filter((type) => (stats.byType[type] ?? 0) > 0 || (ex.byType[type]?.wrong ?? 0) > 0)
    .map((type) => {
      const mistakes = stats.byType[type] ?? 0;
      const e = ex.byType[type];
      const attempts = e ? e.right + e.wrong : 0;
      return { type, mistakes, attempts, accuracy: attempts >= 3 ? e!.right / attempts : null };
    });
  const score = (a: WeakArea) => (a.mistakes + (ex.byType[a.type]?.wrong ?? 0)) * (1 + (a.accuracy === null ? 0.5 : 1 - a.accuracy));
  return areas.sort((a, b) => score(b) - score(a));
}

/** The exact mistakes that come back most often. */
export function topPairs(stats: Stats, n = 10): PairStat[] {
  return Object.values(stats.pairs)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}
