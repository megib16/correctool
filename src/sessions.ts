import { store } from "./store";
import type { SavedSession, Sentence } from "./types";

const KEY = "correctool.saved";
const MAX_SAVED = 50;

export function loadSaved(): SavedSession[] {
  try {
    return JSON.parse(store.get(KEY) ?? "[]") as SavedSession[];
  } catch {
    return [];
  }
}

export function addSaved(sentences: Sentence[]): void {
  const existing = loadSaved();
  const id = Math.max(Date.now(), ...existing.map((s) => s.id + 1)); // always unique
  const all = [{ id, date: new Date().toISOString(), sentences }, ...existing];
  store.set(KEY, JSON.stringify(all.slice(0, MAX_SAVED)));
}

export function deleteSaved(id: number): void {
  store.set(KEY, JSON.stringify(loadSaved().filter((s) => s.id !== id)));
}
