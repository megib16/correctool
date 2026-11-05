import type { GrammarError } from "./types";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

interface Range {
  start: number;
  end: number;
  err: GrammarError;
}

/** Finds where each error's "wrong" text sits in the text (first non-overlapping match). */
export function locate(text: string, errors: GrammarError[]): Range[] {
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  for (const err of errors) {
    const needle = err.wrong.toLowerCase();
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      if (!ranges.some((r) => i < r.end && end > r.start)) {
        ranges.push({ start: i, end, err });
        break;
      }
      from = i + 1;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export type PickHandler = (err: GrammarError, span: HTMLElement) => void;

/**
 * Text with erroneous parts wrapped in red underlined spans. With onPick the spans become
 * clickable. Uses textContent only, because model output is untrusted.
 */
export function highlight(text: string, errors: GrammarError[], onPick?: PickHandler): DocumentFragment {
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const r of locate(text, errors)) {
    if (r.start > pos) frag.append(text.slice(pos, r.start));
    const span = el("span", onPick ? "err clickable" : "err", text.slice(r.start, r.end));
    if (onPick) {
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onPick(r.err, span);
      });
      span.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onPick(r.err, span);
        }
      });
    }
    frag.append(span);
    pos = r.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}

export function errorRow(e: GrammarError): HTMLElement {
  const row = el("div", "note");
  row.append(el("span", "wrong", e.wrong), " → ", el("strong", "right", e.right), " ", el("span", "tag", e.type));
  row.append(el("div", "why", e.explanation));
  return row;
}
