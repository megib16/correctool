import { store } from "./store";
import type { Sentence, Stats } from "./types";

const KEY = "correctool.stats";
const MAX_PAIRS = 300;
const MAX_HISTORY = 100;

export function emptyStats(): Stats {
  return { sessions: 0, words: 0, mistakes: 0, byType: {}, pairs: {}, history: [] };
}

export function loadStats(): Stats {
  try {
    const raw = store.get(KEY);
    return raw ? { ...emptyStats(), ...JSON.parse(raw) } : emptyStats();
  } catch {
    return emptyStats();
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[.,;:!?"“”]/g, "").trim();

/** Adds one finished session to the running totals. Only chunks that were actually checked count. */
export function recordSession(list: Sentence[]): Stats | null {
  const stats = loadStats();
  const now = Date.now();
  let words = 0;
  let mistakes = 0;
  for (const s of list) {
    if (!s.correction) continue;
    words += s.text.trim().split(/\s+/).filter(Boolean).length;
    for (const e of s.correction.errors) {
      mistakes++;
      stats.byType[e.type] = (stats.byType[e.type] ?? 0) + 1;
      const key = `${norm(e.wrong)}→${norm(e.right)}`;
      const p = stats.pairs[key];
      if (p) {
        p.count++;
        p.last = now;
      } else {
        stats.pairs[key] = { wrong: e.wrong, right: e.right, type: e.type, count: 1, last: now };
      }
    }
  }
  if (!words) return stats;

  stats.sessions++;
  stats.words += words;
  stats.mistakes += mistakes;
  stats.history = [...stats.history, { date: new Date().toISOString(), words, mistakes }].slice(-MAX_HISTORY);

  const keys = Object.keys(stats.pairs);
  if (keys.length > MAX_PAIRS) {
    keys
      .sort((a, b) => stats.pairs[a].count - stats.pairs[b].count || stats.pairs[a].last - stats.pairs[b].last)
      .slice(0, keys.length - MAX_PAIRS)
      .forEach((k) => delete stats.pairs[k]);
  }
  if (!store.set(KEY, JSON.stringify(stats))) return null;
  return stats;
}

export function resetStats() {
  return store.remove(KEY);
}
