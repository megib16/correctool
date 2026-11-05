import "./style.css";
import { correct, transcribe } from "./openai";
import { el, errorRow, highlight } from "./render";
import { PauseTranscriber } from "./transcriber";
import type { GrammarError, SavedSession, Sentence } from "./types";

const DEFAULT_PROMPT =
  "Trascrizione letterale del parlato di un apprendente di italiano. " +
  "Trascrivi esattamente ciò che viene detto, inclusi gli errori. " +
  'Esempi di errori da conservare: "il casa", "una libro", "ha nata", "a il supermercato", "io non sapere". ' +
  "Non correggere, non contrarre e non completare nulla.";

// A chunk that is only a hesitation sound ("hmm", "eh", "uhm"...) is not worth keeping.
const FILLER_ONLY = /^[\s.,…!?\-–—]*(?:(?:h?m+|e+h+m*|u+h+m*|e+m+|a+h+|boh)[\s.,…!?\-–—]*)*$/i;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyEl = $<HTMLInputElement>("key");
const sttEl = $<HTMLSelectElement>("stt-model");
const fixEl = $<HTMLInputElement>("fix-model");
const levelEl = $<HTMLSelectElement>("level");
const explainEl = $<HTMLSelectElement>("explain");
const chunkEl = $<HTMLSelectElement>("chunk");
const promptEl = $<HTMLTextAreaElement>("prompt");
const recBtn = $<HTMLButtonElement>("rec");
const statusEl = $("status");
const meterBar = $("meter-bar");
const paperEl = $("paper");
const tipEl = $("tip");
const summaryEl = $("summary");
const summaryTitle = $("summary-title");
const summaryBody = $("summary-body");
const historyEl = $("history");
const pastEl = $<HTMLSelectElement>("past");

// ---------- settings (browser storage is optional: everything works without it) ----------
const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

const fields: [HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, string, string][] = [
  [keyEl, "key", ""],
  [sttEl, "stt", "gpt-4o-transcribe"],
  [fixEl, "fix", "gpt-4o"],
  [levelEl, "level", "B1"],
  [explainEl, "explain", "English"],
  [chunkEl, "chunk", "4500"],
  [promptEl, "prompt.v2", DEFAULT_PROMPT],
];
for (const [elem, name, def] of fields) {
  elem.value = store.get(`correctool.${name}`) ?? def;
  elem.addEventListener("input", () => store.set(`correctool.${name}`, elem.value));
}

// ---------- state ----------
// Each Sentence is really one chunk of speech between pauses. They are shown as one paragraph.
let segs: Sentence[] = [];
let interactive = false; // true once you are done: underlined mistakes become clickable
const pending = new Set<Promise<void>>();
let transcriber: PauseTranscriber | null = null;
let nextId = 0;

// ---------- the paragraph ----------
function renderPaper() {
  paperEl.replaceChildren();
  const pick = interactive ? showError : undefined;
  segs.forEach((s, i) => {
    if (i) paperEl.append(" ");
    if (s.status === "transcribing") {
      paperEl.append(el("span", "pending", "…"));
      return;
    }
    const wrap = el("span", s.status === "checking" ? "checking" : "");
    wrap.append(s.correction ? highlight(s.text, s.correction.errors, pick) : s.text);
    paperEl.append(wrap);
    if (s.status === "failed") {
      const warn = el("span", "warn", " ⚠");
      warn.title = s.failure ?? "Something went wrong.";
      paperEl.append(warn);
    }
    if (interactive && s.correction?.suggestion) {
      const btn = el("button", "hintbtn", "✎");
      btn.type = "button";
      btn.title = "A more natural way to say this";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showSuggestion(s, btn);
      });
      paperEl.append(btn);
    }
  });
}

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

function closePopover() {
  pop.hidden = true;
  activeSpan?.classList.remove("active");
  activeSpan = null;
}

function showError(err: GrammarError, span: HTMLElement) {
  closePopover();
  activeSpan = span;
  span.classList.add("active");
  const owner = segs.find((s) => s.correction?.errors.includes(err));
  pop.replaceChildren(errorRow(err));
  if (owner?.correction && owner.correction.corrected !== owner.text) {
    pop.append(el("div", "fixed", `Corrected: ${owner.correction.corrected}`));
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

// ---------- pipeline: clip -> transcript -> correction ----------
async function handleSegment(wav: Blob) {
  const s: Sentence = { id: nextId++, text: "", status: "transcribing" };
  segs.push(s);
  renderPaper();
  const key = keyEl.value.trim();
  const prompt = promptEl.value;
  try {
    const text = (await transcribe(wav, { key, model: sttEl.value, prompt })).trim();
    // Drop empty results, hesitation-only chunks, and the model echoing our prompt on near-silence.
    if (!text || FILLER_ONLY.test(text) || (text.length >= 20 && prompt.includes(text))) {
      segs = segs.filter((x) => x !== s);
      return renderPaper();
    }
    s.text = text;
    s.status = "checking";
    renderPaper();
    const context = segs
      .filter((x) => x.id < s.id && x.text)
      .slice(-3)
      .map((x) => x.text);
    s.correction = await correct(text, context, {
      key,
      model: fixEl.value.trim(),
      level: levelEl.value,
      explainIn: explainEl.value as "English" | "simple Italian",
    });
    s.status = "done";
  } catch (err) {
    s.status = "failed";
    s.failure = err instanceof Error ? err.message : String(err);
  }
  renderPaper();
}

function track(wav: Blob) {
  const p = handleSegment(wav).finally(() => pending.delete(p));
  pending.add(p);
}

// ---------- start / stop ----------
async function start() {
  if (!keyEl.value.trim()) {
    statusEl.textContent = "Add your OpenAI API key in Settings first.";
    $<HTMLDetailsElement>("settings").open = true;
    return;
  }
  closePopover();
  segs = [];
  interactive = false;
  tipEl.textContent = "";
  summaryEl.hidden = true;
  renderPaper();
  try {
    transcriber = new PauseTranscriber(
      track,
      (level, speaking) => {
        meterBar.style.width = `${Math.min(100, level * 600)}%`;
        meterBar.classList.toggle("speaking", speaking);
        paperEl.classList.toggle("speaking", speaking);
      },
      Number(chunkEl.value),
    );
    await transcriber.start();
    recBtn.textContent = "Stop and review";
    recBtn.classList.add("live");
    statusEl.textContent = "Listening… take your time. Mistakes are underlined in red as you go.";
  } catch (err) {
    transcriber = null;
    statusEl.textContent = `Microphone error: ${err instanceof Error ? err.message : err}`;
  }
}

async function stop() {
  recBtn.disabled = true;
  statusEl.textContent = "Finishing…";
  await transcriber?.stop();
  transcriber = null;
  paperEl.classList.remove("speaking");
  await Promise.allSettled([...pending]);
  const done = segs.filter((s) => s.text);
  if (done.length) saveSession(done);
  showReview(done);
  recBtn.textContent = "Start speaking";
  recBtn.classList.remove("live");
  recBtn.disabled = false;
  statusEl.textContent = "";
}

recBtn.addEventListener("click", () => (transcriber ? stop() : start()));

// ---------- review ----------
function showReview(list: Sentence[]) {
  closePopover();
  segs = list;
  interactive = true;
  renderPaper();
  summaryBody.replaceChildren();

  if (!list.length) {
    tipEl.textContent = "No speech was captured.";
    summaryEl.hidden = true;
    return;
  }
  const all = list.flatMap((s) => (s.correction?.errors ?? []).map((e) => ({ e, s })));
  const tips = list.filter((s) => s.correction?.suggestion).length;
  tipEl.textContent = all.length
    ? `Click an underlined mistake to see why${tips ? ", or ✎ for a more natural phrasing" : ""}.`
    : tips
      ? "No mistakes found. Click ✎ for a more natural phrasing."
      : "No mistakes found. Nice!";

  summaryEl.hidden = all.length === 0;
  summaryTitle.textContent = `All mistakes (${all.length})`;
  const groups = new Map<string, typeof all>();
  for (const item of all) groups.set(item.e.type, [...(groups.get(item.e.type) ?? []), item]);
  for (const [type, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const g = el("div", "group");
    g.append(el("h3", "", `${type} (${items.length})`));
    for (const { e, s } of items) {
      const row = errorRow(e);
      row.append(el("div", "src", `“${s.text}”`));
      g.append(row);
    }
    summaryBody.append(g);
  }
}

// ---------- saved sessions ----------
function loadSessions(): SavedSession[] {
  try {
    return JSON.parse(store.get("correctool.sessions") ?? "[]") as SavedSession[];
  } catch {
    return [];
  }
}

function saveSession(list: Sentence[]) {
  const sessions = loadSessions();
  sessions.unshift({ id: Date.now(), date: new Date().toISOString(), sentences: list });
  store.set("correctool.sessions", JSON.stringify(sessions.slice(0, 30)));
  renderHistory();
}

function renderHistory() {
  const sessions = loadSessions();
  historyEl.hidden = sessions.length === 0;
  pastEl.replaceChildren(new Option("Choose a session…", ""));
  for (const s of sessions) {
    const label = `${new Date(s.date).toLocaleString()} · ${s.sentences.length} chunks`;
    pastEl.append(new Option(label, String(s.id)));
  }
}

pastEl.addEventListener("change", () => {
  const found = loadSessions().find((s) => String(s.id) === pastEl.value);
  if (found && !transcriber) showReview(found.sentences);
});

renderHistory();
