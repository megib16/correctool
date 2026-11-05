import { el, errorRow } from "./render";
import { TYPE_LABELS } from "./types";
import type { ErrorType, Sentence } from "./types";

/** All mistakes of a session, grouped by type with the most frequent type first. */
export function buildSummary(list: Sentence[]): { root: HTMLElement; count: number } {
  const all = list.flatMap((s) => (s.correction?.errors ?? []).map((e) => ({ e, s })));
  const root = el("div");
  const groups = new Map<ErrorType, typeof all>();
  for (const item of all) groups.set(item.e.type, [...(groups.get(item.e.type) ?? []), item]);
  for (const [type, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const g = el("div", "group");
    g.append(el("h3", "", `${TYPE_LABELS[type] ?? type} (${items.length})`));
    for (const { e, s } of items) {
      const row = errorRow(e);
      row.append(el("div", "src", `“${s.text}”`));
      g.append(row);
    }
    root.append(g);
  }
  return { root, count: all.length };
}
