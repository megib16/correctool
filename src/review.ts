import type { Sentence } from "./types";

/** Failed transcription clips have no text but must remain visible in the review. */
export const reviewSegments = (list: Sentence[]) => list.filter((s) => s.text || s.status === "failed");

export function failureNotice(list: Sentence[]): string {
  const failed = list.filter((s) => s.status === "failed").length;
  return failed ? `${failed} audio clip${failed === 1 ? "" : "s"} could not be transcribed or checked. Results are incomplete.` : "";
}
