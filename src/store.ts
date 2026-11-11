// Browser storage is optional: every call is guarded so the app still works without it.
export const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): boolean {
    try { localStorage.setItem(k, v); return true; } catch { return false; }
  },
  remove(k: string): boolean {
    try { localStorage.removeItem(k); return true; } catch { return false; }
  },
};
