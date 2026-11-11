import { BLANK, fullSentence, isCorrect, shuffleWords, topPairs, validateExercise, weakAreas } from "./exercise-logic";
import { loadExStats, recordAnswer, recordRun } from "./exstats";
import { generateExercises, speak } from "./openai";
import { el } from "./render";
import { getSettings } from "./settings";
import { loadStats } from "./stats";
import { TYPE_LABELS } from "./types";
import type { ErrorType, Exercise } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setupEl = $("ex-setup");
const runEl = $("ex-run");
const doneEl = $("ex-done");

const ALL_TYPES = Object.keys(TYPE_LABELS) as ErrorType[];
let selected: Set<ErrorType> | null = null; // topics to practise
let count = 8;
let list: Exercise[] = [];
let index = 0;
let generating = false;
let progressSaved = true;
let results: { ex: Exercise; given: string; ok: boolean }[] = [];
const voiceCache = new Map<string, Blob>();

function show(which: "setup" | "run" | "done") {
  setupEl.hidden = which !== "setup";
  runEl.hidden = which !== "run";
  doneEl.hidden = which !== "done";
}

/** Called when the Exercises tab is opened. A set in progress or its results are left alone. */
export function renderExercises() {
  if (!setupEl.hidden && !generating) renderSetup();
}

// ---------- choosing what to practise ----------
function renderSetup() {
  show("setup");
  setupEl.replaceChildren();
  const stats = loadStats();
  const areas = weakAreas(stats, loadExStats());
  selected ??= new Set(areas.length ? areas.slice(0, 3).map((a) => a.type) : (["gender", "article", "conjugation"] as ErrorType[]));

  setupEl.append(
    el(
      "p",
      "rp-intro",
      areas.length
        ? "Short exercises built from your own mistakes. Pick what to practise: your weakest topics are already chosen."
        : "Short exercises on the topics Italian learners find hardest. Once you've practised speaking, they will be built from your own mistakes.",
    ),
  );

  const chipsFor = (types: ErrorType[], heading: string) => {
    if (!types.length) return;
    setupEl.append(el("h3", "ex-heading", heading));
    const wrap = el("div", "chips");
    for (const type of types) {
      const area = areas.find((a) => a.type === type);
      const chip = el("button", "chip");
      chip.type = "button";
      chip.append(el("span", "chip-label", TYPE_LABELS[type]));
      if (area) {
        const acc = area.accuracy === null ? "" : ` · ${Math.round(area.accuracy * 100)}% in exercises`;
        chip.append(el("span", "chip-detail", `${area.mistakes} mistake${area.mistakes === 1 ? "" : "s"}${acc}`));
      }
      const paint = () => {
        chip.classList.toggle("selected", selected!.has(type));
        chip.setAttribute("aria-pressed", String(selected!.has(type)));
      };
      paint();
      chip.addEventListener("click", () => {
        if (selected!.has(type)) selected!.delete(type);
        else selected!.add(type);
        paint();
        startBtn.disabled = selected!.size === 0;
      });
      wrap.append(chip);
    }
    setupEl.append(wrap);
  };

  const startBtn = el("button", "btn primary", "Start exercises");
  startBtn.type = "button";
  startBtn.id = "ex-start";
  const weakTypes = areas.map((a) => a.type);
  chipsFor(weakTypes, "Your weak spots");
  chipsFor(
    ALL_TYPES.filter((t) => !weakTypes.includes(t) && t !== "other"),
    weakTypes.length ? "Other topics" : "Topics",
  );

  const row = el("div", "ex-start-row");
  const label = el("label", "switch", "How many ");
  const sel = el("select");
  sel.setAttribute("aria-label", "Number of exercises");
  for (const n of [5, 8, 12]) {
    const o = new Option(String(n), String(n));
    o.selected = n === count;
    sel.append(o);
  }
  sel.addEventListener("change", () => (count = Number(sel.value)));
  label.append(sel);
  startBtn.disabled = selected.size === 0;
  const msg = el("p", "rp-msg");
  msg.id = "ex-msg";
  startBtn.addEventListener("click", () => void start(startBtn, msg));
  row.append(label, startBtn);
  setupEl.append(row, msg);
}

async function start(button: HTMLButtonElement, msg: HTMLElement) {
  if (generating) return;
  const st = getSettings();
  msg.textContent = "";
  if (!st.key) {
    msg.textContent = "Add your OpenAI API key in Settings (on the Practice tab) first.";
    return;
  }
  if (!selected?.size) return;
  generating = true;
  button.disabled = true;
  msg.textContent = "Writing your exercises…";
  msg.classList.add("busy");
  try {
    const areas = weakAreas(loadStats(), loadExStats());
    const focus = [...selected].map((type) => {
      const a = areas.find((x) => x.type === type);
      return { type, label: TYPE_LABELS[type], mistakes: a?.mistakes ?? 0, accuracy: a?.accuracy ?? null };
    });
    const pairs = topPairs(loadStats())
      .filter((p) => selected!.has(p.type))
      .map((p) => ({ wrong: p.wrong, right: p.right, type: p.type, count: p.count }));
    const raw = await generateExercises({
      key: st.key,
      model: st.fixModel,
      level: st.level,
      explainIn: st.explainIn,
      count,
      focus,
      pairs,
    });
    const usable = raw.map((r) => validateExercise(r)).filter((e): e is Exercise => e !== null);
    if (usable.length < 3) throw new Error("The AI returned too few usable exercises. Please try again.");
    list = usable;
    index = 0;
    results = [];
    progressSaved = true;
    renderQuestion();
  } catch (err) {
    msg.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    generating = false;
    msg.classList.remove("busy");
    button.disabled = false;
  }
}

// ---------- one exercise at a time ----------
function renderQuestion() {
  show("run");
  runEl.replaceChildren();
  const ex = list[index];

  const head = el("div", "ex-head");
  const bar = el("div", "ex-progress");
  const fill = el("div", "ex-progress-fill");
  fill.style.width = `${(index / list.length) * 100}%`;
  bar.append(fill);
  const stop = el("button", "linkbtn", "Stop");
  stop.type = "button";
  stop.addEventListener("click", () => (results.length ? finish() : renderSetup()));
  head.append(el("span", "ex-count", `${index + 1} / ${list.length}`), bar, stop);

  const card = el("div", "ex-card");
  card.append(el("div", "ex-topic", TYPE_LABELS[ex.type]));
  const instruction = { choice: "Choose the right word", fill: "Type the missing word", reorder: "Put the words in the right order" }[ex.kind];
  card.append(el("div", "ex-instruction", instruction));

  const feedback = el("div", "ex-feedback");
  feedback.hidden = true;

  const sentence = el("div", "ex-sentence");
  if (ex.kind === "reorder") {
    sentence.append(el("em", "", ex.prompt));
  } else {
    const [before, after] = ex.prompt.split(BLANK);
    sentence.append(before, el("span", "blank", "_____"), after);
    card.append(sentence);
    if (ex.hint) card.append(el("div", "ex-hint", ex.hint));
  }
  if (ex.kind === "reorder") card.append(sentence);

  /** Locks the exercise and shows how it went. */
  const answered = (given: string) => {
    const ok = isCorrect(ex, given);
    results.push({ ex, given, ok });
    progressSaved = recordAnswer(ex.type, ok) && progressSaved;
    card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((c) => (c.disabled = true));
    showFeedback(feedback, ex, given, ok);
    if (!progressSaved) feedback.append(el("p", "warn", "Could not store exercise progress. Browser storage may be full or unavailable."));
    return ok;
  };

  if (ex.kind === "choice") {
    const opts = el("div", "ex-options");
    for (const o of ex.options) {
      const b = el("button", "ex-option", o);
      b.type = "button";
      b.addEventListener("click", () => {
        const ok = answered(o);
        b.classList.add(ok ? "right" : "wrong");
        if (!ok) opts.querySelectorAll<HTMLButtonElement>(".ex-option").forEach((x) => x.textContent === ex.answer && x.classList.add("right"));
      });
      opts.append(b);
    }
    card.append(opts);
  } else if (ex.kind === "fill") {
    const row = el("div", "ex-fill");
    const input = el("input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Your answer");
    const check = el("button", "btn primary", "Check");
    check.type = "button";
    const submit = () => {
      if (input.value.trim()) answered(input.value);
    };
    check.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => ev.key === "Enter" && submit());
    row.append(input, check);
    card.append(row);
    queueMicrotask(() => input.focus());
  } else {
    card.append(reorderControls(ex, answered));
  }

  card.append(feedback);
  runEl.append(head, card);
}

function reorderControls(ex: Exercise, answered: (given: string) => boolean): HTMLElement {
  const words = shuffleWords(ex.answer);
  const chosen: number[] = []; // indexes into `words`, in the order the learner picked them
  const wrap = el("div", "ex-reorder");
  const line = el("div", "ex-line");
  const pool = el("div", "ex-pool");
  const check = el("button", "btn primary", "Check");
  check.type = "button";
  check.disabled = true;
  const reset = el("button", "btn", "Clear");
  reset.type = "button";

  const draw = () => {
    line.replaceChildren();
    pool.replaceChildren();
    chosen.forEach((wi, pos) => {
      const b = el("button", "word placed", words[wi]);
      b.type = "button";
      b.addEventListener("click", () => {
        chosen.splice(pos, 1);
        draw();
      });
      line.append(b);
    });
    words.forEach((w, wi) => {
      const b = el("button", "word", w);
      b.type = "button";
      b.disabled = chosen.includes(wi);
      b.addEventListener("click", () => {
        chosen.push(wi);
        draw();
      });
      pool.append(b);
    });
    line.classList.toggle("empty", chosen.length === 0);
    check.disabled = chosen.length !== words.length;
  };
  check.addEventListener("click", () => answered(chosen.map((wi) => words[wi]).join(" ")));
  reset.addEventListener("click", () => {
    chosen.length = 0;
    draw();
  });
  draw();
  wrap.append(line, pool, el("div", "ex-fill", ""));
  wrap.lastElementChild!.append(check, reset);
  return wrap;
}

function showFeedback(box: HTMLElement, ex: Exercise, given: string, ok: boolean) {
  box.hidden = false;
  box.className = `ex-feedback ${ok ? "ok" : "bad"}`;
  box.replaceChildren(el("div", "ex-verdict", ok ? "✓ Corretto!" : "✗ Not quite"));
  if (!ok) {
    if (given.trim()) box.append(el("div", "ex-yours", `You answered: ${given}`));
    box.append(el("div", "ex-correct", `Correct: ${fullSentence(ex)}`));
  } else if (ex.kind !== "reorder") {
    box.append(el("div", "ex-correct", fullSentence(ex)));
  }
  box.append(el("div", "why", ex.explanation));

  const actions = el("div", "ex-actions");
  const listen = el("button", "linkbtn", "▶ Listen");
  listen.type = "button";
  listen.addEventListener("click", () => void sayIt(fullSentence(ex), listen));
  const last = index === list.length - 1;
  const next = el("button", "btn primary", last ? "See results" : "Next →");
  next.type = "button";
  next.addEventListener("click", () => {
    if (last) finish();
    else {
      index++;
      renderQuestion();
    }
  });
  actions.append(listen, next);
  box.append(actions);
  next.focus();
}

async function sayIt(text: string, button: HTMLButtonElement) {
  const st = getSettings();
  const before = button.textContent;
  try {
    button.textContent = "…";
    const key = `${st.ttsModel}|${st.ttsVoiceF}|${text}`;
    let blob = voiceCache.get(key);
    if (!blob) {
      blob = await speak(text, {
        key: st.key,
        model: st.ttsModel,
        voice: st.ttsVoiceF,
        level: st.level,
        style: "a clear, friendly Italian teacher reading an example sentence",
      });
      voiceCache.set(key, blob);
    }
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
  } catch {
    button.textContent = "Voice unavailable";
    return;
  }
  button.textContent = before;
}

// ---------- results ----------
function finish() {
  show("done");
  doneEl.replaceChildren();
  const total = results.length;
  const right = results.filter((r) => r.ok).length;
  progressSaved = recordRun(total, right) && progressSaved;
  if (!progressSaved) doneEl.append(el("p", "warn", "Some exercise progress could not be saved on this device."));

  const pct = total ? Math.round((right / total) * 100) : 0;
  doneEl.append(
    el("div", "ex-score", `${right} / ${total}`),
    el(
      "p",
      "ex-score-msg",
      pct === 100 ? "Perfetto! Nothing missed." : pct >= 70 ? "Bene! A few to look at." : pct >= 40 ? "Keep going: these are worth another round." : "These are hard for you right now. That's exactly why they're here.",
    ),
  );

  const missed = results.filter((r) => !r.ok);
  if (missed.length) {
    doneEl.append(el("h3", "ex-heading", "To review"));
    for (const { ex, given } of missed) {
      const row = el("div", "note");
      row.append(el("span", "right", fullSentence(ex)), " ", el("span", "tag", TYPE_LABELS[ex.type]));
      if (given.trim()) row.append(el("div", "ex-yours", `You answered: ${given}`));
      row.append(el("div", "why", ex.explanation));
      doneEl.append(row);
    }
  }

  const again = el("button", "btn primary", "Practise again");
  again.type = "button";
  again.addEventListener("click", () => {
    renderSetup();
    $<HTMLButtonElement>("ex-start").click(); // same topics, a fresh set
  });
  const change = el("button", "btn", "Change topics");
  change.type = "button";
  change.addEventListener("click", renderSetup);
  const row = el("div", "ex-start-row");
  row.append(again, change);
  doneEl.append(row);
}
