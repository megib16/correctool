import { clipAudio } from "./debugaudio";
import { el, errorRow, highlight } from "./render";
import type { GrammarError, Sentence } from "./types";

// ---------- popover with the explanation ----------
const pop = el("div", "popover");
pop.hidden = true;
document.body.append(pop);
let activeSpan: HTMLElement | null = null;

function placePopover(anchor: HTMLElement) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;
}

export function closePopover() {
  pop.hidden = true;
  activeSpan?.classList.remove("active");
  activeSpan = null;
}

function showError(err: GrammarError, span: HTMLElement, s: Sentence) {
  closePopover();
  activeSpan = span;
  span.classList.add("active");
  pop.replaceChildren(errorRow(err));
  if (s.correction && s.correction.corrected !== s.text) {
    pop.append(el("div", "fixed", `Corrected: ${s.correction.corrected}`));
  }
  placePopover(span);
}

function showSuggestion(s: Sentence, anchor: HTMLElement) {
  closePopover();
  pop.replaceChildren(el("div", "why", `“${s.text}”`));
  const line = el("div", "note", "Maybe you meant: ");
  line.append(el("em", "", s.correction!.suggestion!));
  pop.append(line);
  placePopover(anchor);
}

document.addEventListener("click", (ev) => {
  if (!pop.hidden && !pop.contains(ev.target as Node)) closePopover();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closePopover();
});

// ---------- the paragraph ----------
/** Draws chunks of speech as one paragraph. With clickable, mistakes open the popover. */
export function renderPaper(target: HTMLElement, list: Sentence[], clickable: boolean) {
  target.replaceChildren();
  list.forEach((s, i) => {
    if (i) target.append(" ");
    if (s.status === "transcribing") {
      target.append(el("span", "pending", "…"));
      return;
    }
    const pick = clickable ? (err: GrammarError, span: HTMLElement) => showError(err, span, s) : undefined;
    const wrap = el("span", s.status === "checking" ? "checking" : "");
    wrap.append(s.correction ? highlight(s.text, s.correction.errors, pick) : s.text);
    target.append(wrap);
    const clip = clipAudio.get(s);
    if (clip) {
      const play = el("button", "hintbtn", "▶");
      play.type = "button";
      play.title = "Listen to the audio that was sent for this text";
      play.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void new Audio(clip).play();
      });
      target.append(play);
    }
    if (s.status === "failed") {
      const warn = el("span", "warn", " ⚠");
      warn.title = s.failure ?? "Something went wrong.";
      target.append(warn);
    }
    if (clickable && s.correction?.suggestion) {
      const btn = el("button", "hintbtn", "✎");
      btn.type = "button";
      btn.title = "A more natural way to say this";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showSuggestion(s, btn);
      });
      target.append(btn);
    }
  });
}
