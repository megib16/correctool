import { renderConversation } from "./chat";
import { converse, speak } from "./openai";
import { closePopover } from "./paper";
import { processChunk } from "./pipeline";
import { el } from "./render";
import { MAX_TURNS, SCENARIOS } from "./scenarios";
import type { Scenario } from "./scenarios";
import { addSaved } from "./sessions";
import { getLevel, getSettings, getSpeak, setSpeak } from "./settings";
import { recordSession } from "./stats";
import { buildSummary } from "./summary";
import { PauseTranscriber } from "./transcriber";
import type { CutReason } from "./transcriber";
import type { Sentence, Turn } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pickerEl = $("rp-picker");
const scenariosEl = $("rp-scenarios");
const msgEl = $("rp-msg");
const chatEl = $("rp-chat");
const titleEl = $("rp-title");
const goalEl = $("rp-goal");
const endBtn = $<HTMLButtonElement>("rp-end");
const logEl = $("rp-log");
const controlsEl = $("rp-controls");
const meterBar = $("rp-meter-bar");
const statusEl = $("rp-status");
const nextBtn = $<HTMLButtonElement>("rp-next");
const voiceBox = $<HTMLInputElement>("rp-voice");
const afterEl = $("rp-after");
const tipEl = $("rp-tip");
const saveBar = $("rp-save-bar");
const saveBtn = $<HTMLButtonElement>("rp-save-btn");
const saveNote = $("rp-save-note");
const summaryWrap = $("rp-summary");
const summaryTitle = $("rp-summary-title");
const summaryBody = $("rp-summary-body");
const newBtn = $<HTMLButtonElement>("rp-new");

type Phase = "idle" | "ai" | "user" | "processing" | "ended";

let phase: Phase = "idle";
let runId = 0; // bumped whenever a conversation starts or is ended, so stale async work can bail out
let scenario: Scenario | null = null;
let turns: Turn[] = [];
let current: Turn | null = null; // the learner's turn in progress
let userTurns = 0;
let transcriber: PauseTranscriber | null = null;
const pending = new Set<Promise<void>>();
let timer: number | undefined;
let hasSpoken = false;
let speakingNow = false;
let lastSpeechAt = 0;
let prevCutMid = false; // was the previous clip of this turn cut in the middle of a sentence?
let audio: HTMLAudioElement | null = null;
let stopAudio: (() => void) | null = null;
const voiceCache = new Map<string, Blob>();
let finished: Sentence[] = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const setStatus = (t: string) => (statusEl.textContent = t);
const lockLevel = (on: boolean) =>
  document.querySelectorAll<HTMLButtonElement>(".lvl").forEach((b) => (b.disabled = on));

// ---------- picking a scenario ----------
export function renderScenarios() {
  if (phase !== "idle") return; // never disturb a running conversation or its review
  scenariosEl.replaceChildren();
  for (const sc of SCENARIOS[getLevel()]) {
    const card = el("button", "scenario-card");
    card.type = "button";
    card.append(
      el("div", "sc-title", sc.title),
      el("div", "sc-en", sc.titleEn),
      el("div", "sc-goal", sc.goalIt),
      el("div", "sc-goal-en", sc.goalEn),
    );
    card.addEventListener("click", () => void start(sc));
    scenariosEl.append(card);
  }
}

async function start(sc: Scenario) {
  const st = getSettings();
  msgEl.textContent = "";
  if (!st.key) {
    msgEl.textContent = "Add your OpenAI API key in Settings (on the Practice tab) first.";
    return;
  }
  const id = ++runId;
  scenario = sc;
  turns = [];
  current = null;
  userTurns = 0;
  finished = [];
  try {
    transcriber = new PauseTranscriber(onWav, onLevel, st.chunkMs, st.pauseMs);
    await transcriber.start();
    transcriber.setPaused(true); // the mic opens only on the learner's turn
  } catch (err) {
    transcriber = null;
    msgEl.textContent = `Microphone error: ${err instanceof Error ? err.message : err}`;
    return;
  }
  closePopover();
  phase = "ai";
  pickerEl.hidden = true;
  chatEl.hidden = false;
  controlsEl.hidden = false;
  afterEl.hidden = true;
  endBtn.hidden = false;
  titleEl.textContent = `${sc.title} · ${sc.titleEn}`;
  goalEl.textContent = `${sc.goalIt}  (${sc.goalEn})`;
  voiceBox.checked = getSpeak();
  lockLevel(true);
  renderLog();
  await aiTurn(id);
}

// ---------- the AI's turn ----------
async function aiTurn(id: number) {
  phase = "ai";
  setStatus("Thinking…");
  updateControls();
  const st = getSettings();
  const max = MAX_TURNS[st.level];
  try {
    const r = await converse(
      turns.map(({ role, text }) => ({ role, text })),
      { key: st.key, model: st.fixModel, level: st.level, setup: scenario!.setup, userTurns, maxTurns: max },
    );
    if (id !== runId) return;
    turns.push({ role: "ai", text: r.reply });
    renderLog();
    const last = (r.end && userTurns > 0) || userTurns >= max;
    if (getSpeak()) {
      await playText(r.reply, id);
      if (id !== runId) return;
      await sleep(250); // let the room go quiet before the mic opens
      if (id !== runId) return;
    }
    if (last) await finish(id);
    else userTurn();
  } catch (err) {
    if (id !== runId) return;
    showRetry(err, id);
  }
}

function showRetry(err: unknown, id: number) {
  setStatus("");
  const box = el("div", "bubble-error", `Something went wrong: ${err instanceof Error ? err.message : err}`);
  const retry = el("button", "btn", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => {
    box.remove();
    void aiTurn(id);
  });
  box.append(" ", retry);
  logEl.append(box);
  box.scrollIntoView({ block: "nearest" });
}

// ---------- spoken replies ----------
async function playText(text: string, id: number) {
  const st = getSettings();
  try {
    setStatus("Speaking…");
    const cacheKey = `${st.ttsModel}|${st.ttsVoice}|${st.level}|${text}`;
    let blob = voiceCache.get(cacheKey);
    if (!blob) {
      blob = await speak(text, { key: st.key, model: st.ttsModel, voice: st.ttsVoice, level: st.level });
      voiceCache.set(cacheKey, blob);
    }
    if (id !== runId) return;
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audio = a;
    updateControls();
    await new Promise<void>((resolve) => {
      stopAudio = resolve;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve()); // e.g. the browser blocked autoplay: carry on with text only
    });
    a.pause();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus(`Voice unavailable (${err instanceof Error ? err.message.slice(0, 80) : err}). Continuing with text.`);
    await sleep(1500);
  } finally {
    audio = null;
    stopAudio = null;
    updateControls();
  }
}

/** The "Listen" button on a bubble. The mic is muted while it plays. */
async function replay(text: string) {
  if (audio) return;
  const id = runId;
  const wasUser = phase === "user";
  if (wasUser) transcriber?.setPaused(true);
  await playText(text, id);
  if (wasUser && phase === "user" && id === runId) {
    transcriber?.setPaused(false);
    setStatus(userPrompt());
  } else if (phase === "ended") {
    setStatus("");
  }
}

// ---------- the learner's turn ----------
function userPrompt(): string {
  const silence = getSettings().turnSilenceMs;
  return silence > 0
    ? `Your turn. Speak, then pause for ${silence / 1000} seconds, or press Next when you're done.`
    : "Your turn. Press Next when you're done.";
}

function userTurn() {
  phase = "user";
  current = { role: "user", text: "", segments: [] };
  turns.push(current);
  hasSpoken = false;
  speakingNow = false;
  lastSpeechAt = 0;
  prevCutMid = false;
  renderLog();
  transcriber?.setPaused(false);
  setStatus(userPrompt());
  updateControls();
  window.clearInterval(timer);
  const silence = getSettings().turnSilenceMs;
  if (silence > 0) {
    timer = window.setInterval(() => {
      if (phase === "user" && hasSpoken && !speakingNow && Date.now() - lastSpeechAt >= silence) {
        void endUserTurn();
      }
    }, 250);
  }
}

function onLevel(level: number, speaking: boolean) {
  meterBar.style.width = `${Math.min(100, level * 600)}%`;
  meterBar.classList.toggle("speaking", speaking);
  if (phase === "user") {
    speakingNow = speaking;
    if (speaking) {
      hasSpoken = true;
      lastSpeechAt = Date.now();
    }
  }
}

function onWav(wav: Blob, _seq?: number, reason?: CutReason) {
  const turn = current;
  if (!turn || (phase !== "user" && phase !== "processing")) return;
  const segs = turn.segments!;
  const endsMid = reason === "soft" || reason === "hard";
  const seam = { endsMid, continues: prevCutMid };
  prevCutMid = endsMid;
  const s: Sentence = { id: segs.length, text: "", status: "transcribing" };
  segs.push(s);
  renderLog();
  const context = () => {
    const lastAi = [...turns].reverse().find((t) => t.role === "ai");
    return [
      ...(lastAi ? [`The other speaker just said: "${lastAi.text}"`] : []),
      ...segs.filter((x) => x.id < s.id && x.text).map((x) => x.text),
    ];
  };
  const p = (async () => {
    const kept = await processChunk(s, wav, context, getSettings(), renderLog, seam);
    if (!kept) turn.segments = turn.segments!.filter((x) => x !== s);
    renderLog();
  })().finally(() => pending.delete(p));
  pending.add(p);
}

async function endUserTurn() {
  if (phase !== "user") return;
  const id = runId;
  phase = "processing";
  window.clearInterval(timer);
  transcriber?.flush();
  transcriber?.setPaused(true);
  setStatus("Checking what you said…");
  updateControls();
  await Promise.allSettled([...pending]);
  if (id !== runId) return;

  const turn = current!;
  turn.segments = turn.segments!.filter((s) => s.text);
  turn.text = turn.segments.map((s) => s.text).join(" ");
  if (!turn.text) {
    // nothing recognised: drop the empty turn and listen again
    turns.pop();
    current = null;
    userTurn();
    setStatus("I didn't catch anything. " + userPrompt());
    return;
  }
  userTurns++;
  current = null;
  renderLog();
  await aiTurn(id);
}

// ---------- controls ----------
function updateControls() {
  if (phase === "user") {
    nextBtn.textContent = "Next →";
    nextBtn.disabled = false;
  } else if (phase === "ai" && audio) {
    nextBtn.textContent = "Skip voice";
    nextBtn.disabled = false;
  } else {
    nextBtn.textContent = "Next →";
    nextBtn.disabled = true;
  }
}

nextBtn.addEventListener("click", () => {
  if (phase === "ai" && stopAudio) stopAudio();
  else if (phase === "user") void endUserTurn();
});

voiceBox.addEventListener("change", () => {
  setSpeak(voiceBox.checked);
  if (!voiceBox.checked) stopAudio?.();
});

endBtn.addEventListener("click", () => void endNow());

newBtn.addEventListener("click", () => {
  phase = "idle";
  closePopover();
  chatEl.hidden = true;
  pickerEl.hidden = false;
  renderScenarios();
});

function renderLog(interactive = false) {
  renderConversation(logEl, turns, { interactive, onReplay: (t) => void replay(t), scroll: !interactive });
}

// ---------- ending ----------
/** The learner ends the conversation early. */
async function endNow() {
  if (phase === "idle" || phase === "ended") return;
  const id = ++runId; // cancels anything still in flight
  window.clearInterval(timer);
  stopAudio?.();
  if (current) {
    transcriber?.flush();
    transcriber?.setPaused(true);
    await Promise.allSettled([...pending]);
    const turn = current;
    turn.segments = turn.segments!.filter((s) => s.text);
    turn.text = turn.segments.map((s) => s.text).join(" ");
    if (turn.text) userTurns++;
    else turns = turns.filter((t) => t !== turn);
    current = null;
  }
  await finish(id);
}

/** The conversation is over (by the AI or by the learner): show the review. */
async function finish(id: number) {
  if (id !== runId) return;
  phase = "ended";
  window.clearInterval(timer);
  await transcriber?.stop();
  transcriber = null;
  lockLevel(false);
  setStatus("");
  controlsEl.hidden = true;
  endBtn.hidden = true;
  afterEl.hidden = false;
  closePopover();
  renderLog(true);

  finished = turns.filter((t) => t.role === "user").flatMap((t) => t.segments ?? []);
  const { root, count } = buildSummary(finished);
  const hints = finished.filter((s) => s.correction?.suggestion).length;
  tipEl.textContent = !finished.length
    ? "The conversation ended before you spoke."
    : count
      ? `Conversation finished. Click an underlined mistake to see why${hints ? ", or ✎ for a more natural phrasing" : ""}.`
      : "Conversation finished. No mistakes found. Nice!";
  summaryBody.replaceChildren(root);
  summaryTitle.textContent = `All mistakes (${count})`;
  summaryWrap.hidden = count === 0;

  const checked = finished.some((s) => s.correction);
  if (checked) recordSession(finished);
  saveNote.textContent = checked ? "Added to My mistakes." : "";
  saveBar.hidden = !finished.length;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save this conversation";
}

saveBtn.addEventListener("click", () => {
  if (!finished.length || !scenario) return;
  addSaved(finished, { title: `${scenario.title} · ${scenario.titleEn}`, turns });
  saveBtn.disabled = true;
  saveBtn.textContent = "Saved ✓";
});
