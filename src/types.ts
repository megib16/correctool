export type ErrorType =
  | "gender"
  | "article"
  | "agreement"
  | "conjugation"
  | "auxiliary"
  | "preposition"
  | "word-order"
  | "vocabulary"
  | "other";

export interface GrammarError {
  wrong: string;
  right: string;
  type: ErrorType;
  explanation: string;
}

export interface Correction {
  corrected: string;
  errors: GrammarError[];
  suggestion: string | null;
}

export interface Sentence {
  id: number;
  text: string;
  status: "transcribing" | "checking" | "done" | "failed";
  correction?: Correction;
  failure?: string;
}

export interface SavedSession {
  id: number;
  date: string;
  sentences: Sentence[];
}
