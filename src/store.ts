// Browser storage is optional: every call is guarded so the app still works without it.
export const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
  remove(k: string) {
    try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};
