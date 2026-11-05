// When a clip is cut in the middle of what the learner was saying, the transcriber still treats it as
// a finished sentence: it adds a full stop and capitalises the next clip's first word. These helpers
// hide that seam so the paragraph reads as one continuous text.

// Words that start a sentence only by accident when they come right after a mid-sentence cut.
// Names and other capitalised words are left alone on purpose.
const CONTINUATION_WORDS = new Set(
  (
    "e ed o ma che di a da in con su per tra fra il lo la i gli le un uno una l dell all nell sull dall c d m t s " +
    "mi ti ci si vi non poi perché perche quando dove come se anche più molto ho hai ha abbiamo avete hanno sono sei è " +
    "siamo siete era ero eri eravamo mio mia miei mie tuo tua suo sua al alla allo ai alle del della dello dei delle " +
    "nel nella nei nelle sul sulla questo questa quello quella cosa tutto tutti io tu lui lei noi voi loro ora adesso " +
    "allora quindi però invece dopo prima così già ancora sempre mai solo magari insomma"
  ).split(" "),
);

/** Removes the full stop (or ellipsis) the transcriber put at the end of a clip that was cut mid-sentence. */
export function stripFinalStop(text: string): string {
  return text.replace(/\s*[.…]+\s*$/u, "");
}

/** Lowercases the first word of a clip that continues the previous one, if it is a plain function word. */
export function lowerIfContinuation(text: string): string {
  const m = /^\p{L}+/u.exec(text);
  if (!m) return text;
  const word = m[0];
  const isCapitalised = word[0] !== word[0].toLowerCase();
  if (isCapitalised && CONTINUATION_WORDS.has(word.toLowerCase())) return word[0].toLowerCase() + text.slice(1);
  return text;
}

export interface SeamOptions {
  /** This clip was cut in the middle of what the learner was saying. */
  endsMid?: boolean;
  /** The clip before this one was cut in the middle of what the learner was saying. */
  continues?: boolean;
}

export function cleanSeam(text: string, o: SeamOptions = {}): string {
  let t = text.trim();
  if (o.endsMid) t = stripFinalStop(t);
  if (o.continues) t = lowerIfContinuation(t);
  return t;
}
