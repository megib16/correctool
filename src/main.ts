import "./style.css";
import { correct, transcribe } from "./openai";
import { buildProgress } from "./progress";
import { el, errorRow, highlight } from "./render";
import { addSaved, deleteSaved, loadSaved } from "./sessions";
import { loadStats, recordSession, resetStats } from "./stats";
import { store } from "./store";
import { PauseTranscriber } from "./transcriber";
import { TYPE_LABELS } from "./types";
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
const saveBar = $("save-bar");
const saveBtn = $<HTMLButtonElement>("save-btn");
const saveNote = $("save-note");
const progressBody = $("progress-body");
const savedList = $("saved-list");
const savedView = $("saved-view");
const savedTitle = $("saved-title");
const savedPaper = $("saved-paper");
const savedSummary = $("saved-summary");

// ---------- settings ----------
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
// Each Sentence is really one chunk of speech. Chunks are shown together as one paragraph.
let segs: Sentence[] = [];
const pending = new Set<Promise<void>>();
let transcriber: PauseTranscriber | null = null;
let nextId = 0;
let lastSession: Sentence[] | null = null; // the finished session, offered for saving

// ---------- tabs ----------
type Tab = "practice" | "progress" | "saved";
function showTab(tab: Tab) {
  closePopover();
  document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  (["practice", "progress", "saved"] as Tab[]).forEach((t) => ($(`panel-${t}`).hidden = t !== tab));
  if (tab === "progress") renderProgress();
  if (tab === "saved") renderSavedList();
}
document.querySelectorAll<HTMLElement>(".tab").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab as Tab)),
);

// ---------- the paragraph ----------
function renderPaper(target: HTMLElement, list: Sentence[], clickable: boolean) {
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
const renderLive = () => renderPaper(paperEl, segs, false);

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

// ---------- pipeline: clip -> transcript -> correction ----------
async function handleSegment(wav: Blob) {
  const s: Sentence = { id: nextId++, text: "", status: "transcribing" };
  segs.push(s);
  renderLive();
  const key = keyEl.value.trim();
  const prompt = promptEl.value;
  try {
    const text = (await transcribe(wav, { key, model: sttEl.value, prompt })).trim();
    // Drop empty results, hesitation-only chunks, and the model echoing our prompt on near-silence.
    if (!text || FILLER_ONLY.test(text) || (text.length >= 20 && prompt.includes(text))) {
      segs = segs.filter((x) => x !== s);
      return renderLive();
    }
    s.text = text;
    s.status = "checking";
    renderLive();
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
  renderLive();
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
  lastSession = null;
  tipEl.textContent = "";
  summaryEl.hidden = true;
  saveBar.hidden = true;
  renderLive();
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
  segs = done;
  renderPaper(paperEl, done, true);
  describeReview(done);

  // The session itself is not kept unless the user chooses to. Only anonymous totals go to "My mistakes".
  lastSession = done.length ? done : null;
  if (done.some((s) => s.correction)) {
    recordSession(done);
    saveNote.textContent = "Added to My mistakes.";
  } else {
    saveNote.textContent = "";
  }
  saveBar.hidden = !lastSession;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save this session";

  recBtn.textContent = "Start speaking";
  recBtn.classList.remove("live");
  recBtn.disabled = false;
  statusEl.textContent = "";
}

recBtn.addEventListener("click", () => (transcriber ? stop() : start()));

saveBtn.addEventListener("click", () => {
  if (!lastSession) return;
  addSaved(lastSession);
  saveBtn.disabled = true;
  saveBtn.textContent = "Saved ✓";
});

// ---------- review ----------
function buildSummary(list: Sentence[]): { root: HTMLElement; count: number } {
  const all = list.flatMap((s) => (s.correction?.errors ?? []).map((e) => ({ e, s })));
  const root = el("div");
  const groups = new Map<string, typeof all>();
  for (const item of all) groups.set(item.e.type, [...(groups.get(item.e.type) ?? []), item]);
  for (const [type, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const g = el("div", "group");
    g.append(el("h3", "", `${TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type} (${items.length})`));
    for (const { e, s } of items) {
      const row = errorRow(e);
      row.append(el("div", "src", `“${s.text}”`));
      g.append(row);
    }
    root.append(g);
  }
  return { root, count: all.length };
}

function describeReview(list: Sentence[]) {
  summaryBody.replaceChildren();
  if (!list.length) {
    tipEl.textContent = "No speech was captured.";
    summaryEl.hidden = true;
    return;
  }
  const { root, count } = buildSummary(list);
  const tips = list.filter((s) => s.correction?.suggestion).length;
  tipEl.textContent = count
    ? `Click an underlined mistake to see why${tips ? ", or ✎ for a more natural phrasing" : ""}.`
    : tips
      ? "No mistakes found. Click ✎ for a more natural phrasing."
      : "No mistakes found. Nice!";
  summaryEl.hidden = count === 0;
  summaryTitle.textContent = `All mistakes (${count})`;
  summaryBody.append(root);
}

// ---------- my mistakes ----------
function renderProgress() {
  progressBody.replaceChildren(
    buildProgress(loadStats(), () => {
      resetStats();
      renderProgress();
    }),
  );
}

// ---------- saved sessions ----------
function renderSavedList() {
  savedView.hidden = true;
  savedList.hidden = false;
  savedList.replaceChildren();
  const items = loadSaved();
  if (!items.length) {
    savedList.append(el("p", "empty", "Nothing saved yet. After a practice session, choose “Save this session” to keep it here."));
    return;
  }
  for (const s of items) savedList.append(savedItem(s));
}

function savedItem(s: SavedSession): HTMLElement {
  const row = el("div", "saved-item");
  const info = el("div", "info");
  const mistakes = s.sentences.reduce((n, c) => n + (c.correction?.errors.length ?? 0), 0);
  info.append(
    el("div", "when", new Date(s.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })),
    el("div", "preview", s.sentences.map((c) => c.text).join(" ")),
    el("div", "meta", `${mistakes} mistake${mistakes === 1 ? "" : "s"}`),
  );
  const open = el("button", "btn", "Open");
  open.type = "button";
  open.addEventListener("click", () => openSaved(s));
  const del = el("button", "btn danger", "Delete");
  del.type = "button";
  del.addEventListener("click", () => {
    if (confirm("Delete this saved session?")) {
      deleteSaved(s.id);
      renderSavedList();
    }
  });
  const actions = el("div", "actions");
  actions.append(open, del);
  row.append(info, actions);
  return row;
}

function openSaved(s: SavedSession) {
  closePopover();
  savedList.hidden = true;
  savedView.hidden = false;
  savedTitle.textContent = new Date(s.date).toLocaleString([], { dateStyle: "full", timeStyle: "short" });
  renderPaper(savedPaper, s.sentences, true);
  const { root, count } = buildSummary(s.sentences);
  savedSummary.replaceChildren();
  if (count) {
    savedSummary.append(el("h3", "", `All mistakes (${count})`), root);
  }
}

$("saved-back").addEventListener("click", () => {
  closePopover();
  renderSavedList();
});
