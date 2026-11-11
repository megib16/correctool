import { failureNotice, reviewSegments } from "./review";
import { Ambient, NoRecordingError, hasRecording } from "./ambient";
import type { AmbientKind } from "./ambient";
import { renderConversation } from "./chat";
import { converse, speak } from "./openai";
import type { Character } from "./openai";
import { closePopover } from "./paper";
import { processChunk } from "./pipeline";
import { el } from "./render";
import { MAX_TURNS, SCENARIOS } from "./scenarios";
import type { Scenario } from "./scenarios";
import { addSaved } from "./sessions";
import { getAmbientOn, getLevel, getSettings, getSpeak, setAmbientOn, setSpeak } from "./settings";
import type { Settings } from "./settings";
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
const ambientPicker = $<HTMLInputElement>("rp-ambient-picker");
const ambientChat = $<HTMLInputElement>("rp-ambient");
const ambientLevelEl = $<HTMLSelectElement>("rp-ambient-level");

type Phase = "idle" | "ai" | "user" | "processing" | "ended";

let phase: Phase = "idle";
let replyController = new AbortController();
let starting = false;
let ending = false;
let runId = 0; // bumped whenever a conversation starts or is ended, so stale async work can bail out
let scenario: Scenario | null = null;
let character: Character | null = null; // who the other person is today: personality, mood, what is going on
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
const MOODS = [
  "cheerful and relaxed",
  "in a bit of a hurry",
  "chatty and curious",
  "a little tired but friendly",
  "playful and teasing",
  "calm and attentive",
];
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const ambient = new Ambient();
const ambientNote = $("rp-ambient-note");
const ambientHint = $("rp-ambient-hint");
const KIND_NAMES: Record<AmbientKind, string> = { cafe: "café / restaurant", market: "market", street: "street", indoor: "indoors" };

/** Tells the user which scenes have a background recording ready. */
async function refreshAmbientHint() {
  const kinds = [...new Set(SCENARIOS[getLevel()].map((sc) => sc.ambient))];
  const found: AmbientKind[] = [];
  for (const k of kinds) if (await hasRecording(k)) found.push(k);
  ambientHint.textContent = found.length
    ? `Recordings found for: ${found.map((k) => KIND_NAMES[k]).join(", ")}. Headphones recommended.`
    : "No recordings yet. Add some to public/ambient/ (see the README there). Headphones recommended.";
}

/** Tells the AI who it is, so its name and grammar match the voice that will speak. */
function personaText(sc: Scenario): string {
  const man = sc.persona.gender === "m";
  return (
    `Your name is ${sc.persona.name} and you are a ${man ? "man" : "woman"}. If you introduce yourself or talk about yourself, ` +
    `use this name and the matching Italian grammar (for example ${man ? '"sono stanco", "sono contento"' : '"sono stanca", "sono contenta"'}).`
  );
}

const voiceFor = (sc: Scenario | null, st: Settings) => (sc?.persona.gender === "m" ? st.ttsVoiceM : st.ttsVoiceF);

/** Background sound: audible all the time, or only while the other person is talking, depending on the setting. */
function syncAmbient(aiSpeaking: boolean) {
  const st = getSettings();
  ambient.setLevel(st.ambientLevel);
  ambient.setActive(getAmbientOn() && (st.ambientMode === "always" || aiSpeaking));
}

async function startAmbient(id: number) {
  if (!scenario) return;
  try {
    await ambient.start(scenario.ambient, getSettings().ambientLevel);
    if (id !== runId) {
      ambient.stop();
      return;
    }
    ambientNote.textContent = "";
    syncAmbient(!!audio);
  } catch (err) {
    // carry on without background noise
    ambientNote.textContent =
      err instanceof NoRecordingError ? "No background recording for this scene yet (see public/ambient/)." : "Background sound unavailable.";
  }
}

function applyAmbientToggle(on: boolean) {
  setAmbientOn(on);
  ambientPicker.checked = on;
  ambientChat.checked = on;
  if (phase === "idle" || phase === "ended") return;
  if (on) void startAmbient(runId);
  else ambient.stop();
}
ambientPicker.checked = ambientChat.checked = getAmbientOn();
ambientPicker.addEventListener("change", () => {
  applyAmbientToggle(ambientPicker.checked);
  if (ambientPicker.checked) void refreshAmbientHint();
});
ambientChat.addEventListener("change", () => applyAmbientToggle(ambientChat.checked));
ambientLevelEl.addEventListener("change", () => syncAmbient(!!audio));

const lockLevel = (on: boolean) =>
  document.querySelectorAll<HTMLButtonElement>(".lvl").forEach((b) => (b.disabled = on));

// ---------- picking a scenario ----------
export function renderScenarios() {
  if (phase !== "idle") return; // never disturb a running conversation or its review
  if (getAmbientOn()) void refreshAmbientHint();
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
  if (starting || phase !== "idle") return;
  const st = getSettings();
  msgEl.textContent = "";
  if (!st.key) {
    msgEl.textContent = "Add your OpenAI API key in Settings (on the Practice tab) first.";
    return;
  }
  starting = true;
  replyController.abort();
  replyController = new AbortController();
  const id = ++runId;
  scenario = sc;
  character = { personality: sc.personality, mood: pick(MOODS), twist: pick(sc.twists) };
  ambientNote.textContent = "";
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
  } finally {
    starting = false;
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
  if (getAmbientOn()) void startAmbient(id);
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
      { signal: replyController.signal, key: st.key, model: st.fixModel, level: st.level, setup: scenario!.setup, persona: personaText(scenario!), character: character ?? undefined, userTurns, maxTurns: max },
    );
    if (id !== runId) return;
    turns.push({ role: "ai", text: r.reply, tone: r.tone });
    renderLog();
    const last = (r.end && userTurns > 0) || userTurns >= max;
    if (getSpeak()) {
      await playText(r.reply, id, r.tone);
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
async function playText(text: string, id: number, tone?: string) {
  const st = getSettings();
  try {
    setStatus("Speaking…");
    const voice = voiceFor(scenario, st);
    const cacheKey = `${st.ttsModel}|${voice}|${st.level}|${tone ?? ""}|${text}`;
    let blob = voiceCache.get(cacheKey);
    if (!blob) {
      blob = await speak(text, {
        signal: replyController.signal,
        key: st.key,
        model: st.ttsModel,
        voice,
        level: st.level,
        style: scenario?.voiceStyle,
        tone,
      });
      voiceCache.set(cacheKey, blob);
    }
    if (id !== runId) return;
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audio = a;
    updateControls();
    syncAmbient(true);
    await new Promise<void>((resolve) => {
      stopAudio = resolve;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve()); // e.g. the browser blocked autoplay: carry on with text only
    });
    a.pause();
    URL.revokeObjectURL(url);
  } catch (err) {
    if (id !== runId) return;
    setStatus(`Voice unavailable (${err instanceof Error ? err.message.slice(0, 80) : err}). Continuing with text.`);
    await sleep(1500);
  } finally {
    if (id === runId) {
      audio = null;
      stopAudio = null;
      updateControls();
      syncAmbient(false);
    }
  }
}

/** The "Listen" button on a bubble. The mic is muted while it plays. */
async function replay(turn: Turn) {
  if (audio) return;
  const id = runId;
  const wasUser = phase === "user";
  if (wasUser) transcriber?.setPaused(true);
  await playText(turn.text, id, turn.tone);
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
  turn.segments = reviewSegments(turn.segments!);
  turn.text = turn.segments.map((s) => s.text).join(" ");
  if (!turn.text) {
    // nothing recognised: drop the empty turn and listen again
    const failed = !!failureNotice(turn.segments);
    if (!failed) turns.pop();
    current = null;
    userTurn();
    setStatus((failed ? "The audio could not be transcribed. Please try again. " : "I didn't catch anything. ") + userPrompt());
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
  if (phase === "idle" || phase === "ended" || ending) return;
  ending = true;
  endBtn.disabled = true;
  const id = ++runId; // cancels the reply and voice; captured speech is still reviewed
  replyController.abort();
  phase = "processing";
  updateControls();
  window.clearInterval(timer);
  stopAudio?.();
  audio?.pause();
  audio = null;
  stopAudio = null;
  if (current) {
    transcriber?.flush();
    transcriber?.setPaused(true);
    await Promise.allSettled([...pending]);
    const turn = current;
    turn.segments = reviewSegments(turn.segments!);
    turn.text = turn.segments.map((s) => s.text).join(" ");
    if (turn.text) userTurns++;
    else if (!turn.segments.length) turns = turns.filter((t) => t !== turn);
    current = null;
  }
  try {
    await finish(id);
  } finally {
    ending = false;
    endBtn.disabled = false;
  }
}

/** The conversation is over (by the AI or by the learner): show the review. */
async function finish(id: number) {
  if (id !== runId) return;
  phase = "ended";
  window.clearInterval(timer);
  await transcriber?.stop();
  transcriber = null;
  ambient.stop();
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
  const notice = failureNotice(finished);
  if (notice) tipEl.textContent = notice + (count ? " Click underlined mistakes to review the available results." : "");
  summaryBody.replaceChildren(root);
  summaryTitle.textContent = `All mistakes (${count})`;
  summaryWrap.hidden = count === 0;

  const checked = finished.some((s) => s.correction);
  saveNote.textContent = checked
    ? recordSession(finished) ? "Added to My mistakes." : "Could not store progress. Browser storage may be full or unavailable."
    : "";
  saveBar.hidden = !finished.length;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save this conversation";
}

saveBtn.addEventListener("click", () => {
  if (!finished.length || !scenario) return;
  if (!addSaved(finished, { title: `${scenario.title} · ${scenario.titleEn}`, turns })) {
    saveNote.textContent = "Could not save. Browser storage may be full or unavailable. Free some space and try again.";
    return;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = "Saved ✓";
  saveNote.textContent = "Saved on this device.";
});
