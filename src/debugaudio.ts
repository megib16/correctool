import type { Sentence } from "./types";

/** Audio clips kept in memory (only when the debug option is on) so they can be played back next to the text. */
export const clipAudio = new WeakMap<Sentence, string>();
