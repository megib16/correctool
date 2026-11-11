import { failureNotice, reviewSegments } from "./review";
import "./style.css";
import { renderConversation } from "./chat";
import { renderExercises } from "./exercises";
import { loadExStats, resetExStats } from "./exstats";
import { speak } from "./openai";
import { closePopover, renderPaper } from "./paper";
import { processChunk } from "./pipeline";
import { buildProgress } from "./progress";
import { el } from "./render";
import { renderScenarios } from "./roleplay";
import { addSaved, deleteSaved, loadSaved } from "./sessions";
import { getLevel, getSettings, onLevelChange, setLevel } from "./settings";
import type { SeamOptions } from "./seams";
import { loadStats, recordSession, resetStats } from "./stats";
import { buildSummary } from "./summary";
import { LEVELS, randomTopic } from "./topics";
import type { Level } from "./topics";
import { PauseTranscriber } from "./transcriber";
import type { CutReason } from "./transcriber";
import type { SavedSession, Sentence } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
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
const savedChat = $("saved-chat");
const savedSummary = $("saved-summary");
const topicBtn = $<HTMLButtonElement>("topic-btn");
const topicCard = $("topic-card");

// ---------- tabs ----------
type Tab = "practice" | "roleplay" | "exercises" | "progress" | "saved";
const TABS: Tab[] = ["practice", "roleplay", "exercises", "progress", "saved"];

function showTab(tab: Tab) {
  closePopover();
  document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  TABS.forEach((t) => ($(`panel-${t}`).hidden = t !== tab));
  $("levelbar").hidden = tab === "progress" || tab === "saved";
  if (tab === "roleplay") renderScenarios();
  if (tab === "exercises") renderExercises();
  if (tab === "progress") renderProgress();
  if (tab === "saved") renderSavedList();
}
document.querySelectorAll<HTMLElement>(".tab").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab as Tab)),
);

// ---------- level pills and topic suggestions ----------
function paintLevel(l: Level) {
  document.querySelectorAll<HTMLElement>(".lvl").forEach((b) => {
    const on = b.dataset.level === l;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  // a topic shown for another level would be misleading
  topicCard.hidden = true;
  topicBtn.textContent = "Suggest a topic";
}
document.querySelectorAll<HTMLElement>(".lvl").forEach((b) =>
  b.addEventListener("click", () => setLevel(b.dataset.level as Level)),
);
onLevelChange((l) => {
  paintLevel(l);
  renderScenarios();
});
paintLevel(getLevel());
void LEVELS;

topicBtn.addEventListener("click", () => {
  const t = randomTopic(getLevel());
  $("topic-it").textContent = t.it;
  $("topic-en").textContent = t.en;
  $("topic-level").textContent = getLevel();
  topicCard.hidden = false;
  topicBtn.textContent = "Another topic";
});

// ---------- practice: state ----------
// Each Sentence is really one chunk of speech. Chunks are shown together as one paragraph.
let segs: Sentence[] = [];
const pending = new Set<Promise<void>>();
let transcriber: PauseTranscriber | null = null;
let nextId = 0;
let lastSession: Sentence[] | null = null; // the finished session, offered for saving

const renderLive = () => renderPaper(paperEl, segs, false);

// ---------- practice: clip -> transcript -> correction ----------
async function handleSegment(wav: Blob, seam: SeamOptions) {
  const s: Sentence = { id: nextId++, text: "", status: "transcribing" };
  segs.push(s);
  renderLive();
  const context = () =>
    segs
      .filter((x) => x.id < s.id && x.text)
      .slice(-3)
      .map((x) => x.text);
  const kept = await processChunk(s, wav, context, getSettings(), renderLive, seam);
  if (!kept) segs = segs.filter((x) => x !== s);
  renderLive();
}

let prevCutMid = false; // was the previous clip cut in the middle of what you were saying?
function track(wav: Blob, _seq?: number, reason?: CutReason) {
  const endsMid = reason === "soft" || reason === "hard";
  const seam = { endsMid, continues: prevCutMid };
  prevCutMid = endsMid;
  const p = handleSegment(wav, seam).finally(() => pending.delete(p));
  pending.add(p);
}

// ---------- practice: start / stop ----------
async function start() {
  const st = getSettings();
  if (!st.key) {
    statusEl.textContent = "Add your OpenAI API key in Settings first.";
    $<HTMLDetailsElement>("settings").open = true;
    return;
  }
  recBtn.disabled = true;
  closePopover();
  segs = [];
  prevCutMid = false;
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
      st.chunkMs,
      st.pauseMs,
    );
    await transcriber.start();
    recBtn.textContent = "Stop and review";
    recBtn.classList.add("live");
    statusEl.textContent = "Listening… take your time. Mistakes are underlined in red as you go.";
  } catch (err) {
    transcriber = null;
    statusEl.textContent = `Microphone error: ${err instanceof Error ? err.message : err}`;
  } finally {
    recBtn.disabled = false;
  }
}

async function stop() {
  recBtn.disabled = true;
  statusEl.textContent = "Finishing…";
  await transcriber?.stop();
  transcriber = null;
  paperEl.classList.remove("speaking");
  await Promise.allSettled([...pending]);

  const done = reviewSegments(segs);
  segs = done;
  renderPaper(paperEl, done, true);
  describeReview(done);

  // The session itself is not kept unless the user chooses to. Only totals and recurring error pairs go to "My mistakes".
  lastSession = done.length ? done : null;
  if (done.some((s) => s.correction)) {
    saveNote.textContent = recordSession(done) ? "Added to My mistakes." : "Could not store progress. Browser storage may be full or unavailable.";
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
  if (!addSaved(lastSession)) {
    saveNote.textContent = "Could not save. Browser storage may be full or unavailable. Free some space and try again.";
    return;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = "Saved ✓";
  saveNote.textContent = "Saved on this device.";
});

// ---------- practice: review ----------
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
  const notice = failureNotice(list);
  if (notice) tipEl.textContent = notice + (count ? " Click underlined mistakes to review the available results." : "");
  summaryEl.hidden = count === 0;
  summaryTitle.textContent = `All mistakes (${count})`;
  summaryBody.append(root);
}

// ---------- my mistakes ----------
function renderProgress() {
  progressBody.replaceChildren(
    buildProgress(loadStats(), loadExStats(), () => {
      const speechReset = resetStats();
      const exercisesReset = resetExStats();
      if (!speechReset || !exercisesReset) alert("Could not reset all progress. Browser storage is unavailable.");
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
    savedList.append(
      el("p", "empty", "Nothing saved yet. After a practice session or a role-play, choose “Save” to keep it here."),
    );
    return;
  }
  for (const s of items) savedList.append(savedItem(s));
}

function savedItem(s: SavedSession): HTMLElement {
  const row = el("div", "saved-item");
  const info = el("div", "info");
  const mistakes = s.sentences.reduce((n, c) => n + (c.correction?.errors.length ?? 0), 0);
  const text = s.sentences.map((c) => c.text).join(" ");
  info.append(
    el("div", "when", new Date(s.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })),
    el("div", "preview", s.turns ? `Role-play: ${s.title ?? ""}` : text),
    el("div", "meta", `${mistakes} mistake${mistakes === 1 ? "" : "s"}`),
  );
  const open = el("button", "btn", "Open");
  open.type = "button";
  open.addEventListener("click", () => openSaved(s));
  const del = el("button", "btn danger", "Delete");
  del.type = "button";
  del.addEventListener("click", () => {
    if (confirm("Delete this saved session?")) {
      if (!deleteSaved(s.id)) {
        alert("Could not delete this session. Browser storage is unavailable.");
        return;
      }
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
  const when = new Date(s.date).toLocaleString([], { dateStyle: "full", timeStyle: "short" });
  savedTitle.textContent = s.title ? `${s.title} · ${when}` : when;
  savedPaper.hidden = !!s.turns;
  savedChat.hidden = !s.turns;
  if (s.turns) renderConversation(savedChat, s.turns, { interactive: true });
  else renderPaper(savedPaper, s.sentences, true);
  const { root, count } = buildSummary(s.sentences);
  savedSummary.replaceChildren();
  if (count) savedSummary.append(el("h3", "", `All mistakes (${count})`), root);
}

$("saved-back").addEventListener("click", () => {
  closePopover();
  renderSavedList();
});

// ---------- settings: audition the voices ----------
function auditionVoice(buttonId: string, gender: "f" | "m") {
  $(buttonId).addEventListener("click", async () => {
    const note = $("tts-test-note");
    const st = getSettings();
    if (!st.key) {
      note.textContent = "Add your API key first.";
      return;
    }
    note.textContent = "Loading…";
    try {
      const name = gender === "m" ? "Marco" : "Giulia";
      const blob = await speak(`Ciao! Mi chiamo ${name}. Come stai oggi? Raccontami un po' della tua giornata.`, {
        key: st.key,
        model: st.ttsModel,
        voice: gender === "m" ? st.ttsVoiceM : st.ttsVoiceF,
        level: st.level,
        style: gender === "m" ? "a friendly young Italian man" : "a friendly young Italian woman",
      });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
      note.textContent = "";
    } catch (err) {
      note.textContent = err instanceof Error ? err.message.slice(0, 120) : String(err);
    }
  });
}
auditionVoice("tts-test-f", "f");
auditionVoice("tts-test-m", "m");
