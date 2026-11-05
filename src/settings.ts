import { store } from "./store";
import { LEVELS } from "./topics";
import type { Level } from "./topics";

export const DEFAULT_PROMPT =
  "Trascrizione letterale del parlato di un apprendente di italiano. " +
  "Trascrivi esattamente ciò che viene detto, inclusi gli errori. " +
  'Esempi di errori da conservare: "il casa", "una libro", "ha nata", "a il supermercato", "io non sapere". ' +
  "Non correggere, non contrarre e non completare nulla.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const keyEl = $<HTMLInputElement>("key");
const fields: [Field, string, string][] = [
  [keyEl, "key", ""],
  [$("stt-model"), "stt", "gpt-4o-transcribe"],
  [$("fix-model"), "fix", "gpt-4o"],
  [$("explain"), "explain", "English"],
  [$("chunk"), "chunk", "4500"],
  [$("sentence-pause"), "sentence-pause", "2500"],
  [$("turn-silence"), "turn-silence", "4000"],
  [$("tts-model"), "tts-model", "gpt-4o-mini-tts"],
  [$("tts-voice"), "tts-voice", "nova"],
  [$("prompt"), "prompt.v2", DEFAULT_PROMPT],
];
for (const [elem, name, def] of fields) {
  elem.value = store.get(`correctool.${name}`) ?? def;
  elem.addEventListener("input", () => store.set(`correctool.${name}`, elem.value));
}

const debugEl = $<HTMLInputElement>("debug-audio");
debugEl.checked = store.get("correctool.debug-audio") === "1";
debugEl.addEventListener("change", () => store.set("correctool.debug-audio", debugEl.checked ? "1" : "0"));

export interface Settings {
  key: string;
  sttModel: string;
  prompt: string;
  /** Used both for the grammar check and for the role-play conversation. */
  fixModel: string;
  explainIn: "English" | "simple Italian";
  level: Level;
  chunkMs: number;
  pauseMs: number; // a pause this long always ends a clip
  debugAudio: boolean; // keep the audio clips so they can be played back
  turnSilenceMs: number; // 0 = never end a turn automatically
  ttsModel: string;
  ttsVoice: string;
}

export function getSettings(): Settings {
  return {
    key: keyEl.value.trim(),
    sttModel: $<HTMLSelectElement>("stt-model").value,
    prompt: $<HTMLTextAreaElement>("prompt").value,
    fixModel: $<HTMLInputElement>("fix-model").value.trim(),
    explainIn: $<HTMLSelectElement>("explain").value as Settings["explainIn"],
    level,
    chunkMs: Number($<HTMLSelectElement>("chunk").value),
    pauseMs: Number($<HTMLSelectElement>("sentence-pause").value),
    debugAudio: debugEl.checked,
    turnSilenceMs: Number($<HTMLSelectElement>("turn-silence").value),
    ttsModel: $<HTMLInputElement>("tts-model").value.trim(),
    ttsVoice: $<HTMLSelectElement>("tts-voice").value,
  };
}

// ---------- level (shared by Practice and Role-play) ----------
const storedLevel = store.get("correctool.level") ?? "";
let level: Level = (LEVELS as readonly string[]).includes(storedLevel) ? (storedLevel as Level) : "B1";
const listeners = new Set<(l: Level) => void>();

export const getLevel = () => level;
export function onLevelChange(cb: (l: Level) => void) {
  listeners.add(cb);
}
export function setLevel(l: Level) {
  level = l;
  store.set("correctool.level", l);
  listeners.forEach((cb) => cb(l));
}

// ---------- spoken replies on/off ----------
export const getSpeak = () => store.get("correctool.speak") !== "0";
export const setSpeak = (on: boolean) => store.set("correctool.speak", on ? "1" : "0");
