const DEFAULT_PROMPT =
  "Trascrizione letterale del parlato di un apprendente di italiano. " +
  "Trascrivi esattamente ciò che viene detto, parola per parola, inclusi errori " +
  "di grammatica, genere, articoli, coniugazione e preposizioni. " +
  "Non correggere, non migliorare e non completare nulla.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyEl = $<HTMLInputElement>("key");
const modelEl = $<HTMLSelectElement>("model");
const promptEl = $<HTMLTextAreaElement>("prompt");
const recBtn = $<HTMLButtonElement>("rec");
const statusEl = $("status");
const takesEl = $("takes");

function load(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function save(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

keyEl.value = load("correctool.key") ?? "";
promptEl.value = load("correctool.prompt") ?? DEFAULT_PROMPT;
keyEl.addEventListener("input", () => save("correctool.key", keyEl.value.trim()));
promptEl.addEventListener("input", () => save("correctool.prompt", promptEl.value));

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

async function transcribe(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "speech.webm");
  form.append("model", modelEl.value);
  form.append("language", "it");
  form.append("temperature", "0");
  form.append("prompt", promptEl.value);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${keyEl.value.trim()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()).text as string;
}

function addTake(model: string, text: string, isError = false) {
  const div = document.createElement("div");
  div.className = "take";
  const small = document.createElement("small");
  small.textContent = model;
  const p = document.createElement("p");
  p.textContent = text;
  if (isError) p.className = "err";
  div.append(small, p);
  takesEl.prepend(div);
}

async function start() {
  if (!keyEl.value.trim()) { statusEl.textContent = "Enter your API key first."; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder?.mimeType ?? "audio/webm" });
      statusEl.textContent = "Transcribing…";
      const model = modelEl.value;
      try {
        addTake(model, await transcribe(blob));
        statusEl.textContent = "";
      } catch (err) {
        addTake(model, String(err), true);
        statusEl.textContent = "";
      }
    };
    recorder.start();
    recBtn.textContent = "■ Stop";
    statusEl.textContent = "Recording… speak now.";
  } catch (err) {
    statusEl.textContent = `Microphone error: ${err}`;
  }
}

function stop() {
  recorder?.stop();
  recBtn.textContent = "● Start recording";
}

recBtn.addEventListener("click", () => {
  if (recorder && recorder.state === "recording") stop();
  else start();
});
