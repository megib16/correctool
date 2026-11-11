import { store } from "./store";

const KEY = "correctool.key";
const REMEMBER = "correctool.remember-key";

export function loadCredential(): { key: string; remember: boolean } {
  const remember = store.get(REMEMBER) === "1";
  const previous = store.get(KEY) ?? "";
  let session = "";
  try { session = sessionStorage.getItem(KEY) ?? ""; } catch { /* optional */ }
  if (!remember && previous) {
    // Migrate previously persisted credentials into this tab's session.
    try { sessionStorage.setItem(KEY, previous); } catch { /* keep it in the input */ }
    store.remove(KEY);
  }
  return { key: remember ? previous : session || previous, remember };
}

export function saveCredential(key: string, remember: boolean): boolean {
  if (remember) {
    try { sessionStorage.removeItem(KEY); } catch { /* optional */ }
    return store.set(KEY, key) && store.set(REMEMBER, "1");
  }
  const removed = store.remove(KEY) && store.remove(REMEMBER);
  try { sessionStorage.setItem(KEY, key); } catch { /* the input still holds the key */ }
  return removed;
}
