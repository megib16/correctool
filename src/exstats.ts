import { store } from "./store";
import type { ErrorType, ExerciseStats } from "./types";

const KEY = "correctool.exercises";
const MAX_HISTORY = 100;

export function emptyExStats(): ExerciseStats {
  return { total: 0, correct: 0, byType: {}, history: [] };
}

export function loadExStats(): ExerciseStats {
  try {
    const raw = store.get(KEY);
    return raw ? { ...emptyExStats(), ...JSON.parse(raw) } : emptyExStats();
  } catch {
    return emptyExStats();
  }
}

/** Counts one answered exercise. */
export function recordAnswer(type: ErrorType, correct: boolean): boolean {
  const s = loadExStats();
  s.total++;
  if (correct) s.correct++;
  const t = (s.byType[type] ??= { right: 0, wrong: 0 });
  if (correct) t.right++;
  else t.wrong++;
  return store.set(KEY, JSON.stringify(s));
}

/** Remembers how a whole set of exercises went. */
export function recordRun(total: number, correct: number): boolean {
  if (!total) return true;
  const s = loadExStats();
  s.history = [...s.history, { date: new Date().toISOString(), total, correct }].slice(-MAX_HISTORY);
  return store.set(KEY, JSON.stringify(s));
}

export function resetExStats(): boolean {
  return store.remove(KEY);
}
