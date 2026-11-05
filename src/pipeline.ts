import { clipAudio } from "./debugaudio";
import { correct, transcribe } from "./openai";
import { cleanSeam } from "./seams";
import type { SeamOptions } from "./seams";
import type { Settings } from "./settings";
import type { Sentence } from "./types";

// A chunk that is only a hesitation sound ("hmm", "eh", "uhm"...) is not worth keeping.
const FILLER_ONLY = /^[\s.,…!?\-–—]*(?:(?:h?m+|e+h+m*|u+h+m*|e+m+|a+h+|boh)[\s.,…!?\-–—]*)*$/i;

/**
 * Runs one audio clip through transcription and then the grammar check, updating `s` as it goes
 * (so the caller can show grey text first and the red marks a moment later).
 * Returns false when the clip turned out to be empty or only a filler, so the caller can drop it.
 * A failure is kept (returns true) so it can be shown with a warning.
 */
export async function processChunk(
  s: Sentence,
  wav: Blob,
  context: () => string[],
  st: Settings,
  changed: () => void,
  seam: SeamOptions = {},
): Promise<boolean> {
  if (st.debugAudio) clipAudio.set(s, URL.createObjectURL(wav));
  try {
    const raw = (await transcribe(wav, { key: st.key, model: st.sttModel, prompt: st.prompt })).trim();
    // Drop empty results, hesitation-only chunks, and the model echoing our prompt on near-silence.
    if (!raw || FILLER_ONLY.test(raw) || (raw.length >= 20 && st.prompt.includes(raw))) return false;
    const text = cleanSeam(raw, seam);
    s.text = text;
    s.status = "checking";
    changed();
    s.correction = await correct(text, context(), {
      key: st.key,
      model: st.fixModel,
      level: st.level,
      explainIn: st.explainIn,
    });
    s.status = "done";
  } catch (err) {
    s.status = "failed";
    s.failure = err instanceof Error ? err.message : String(err);
  }
  return true;
}
