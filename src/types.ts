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

export const TYPE_LABELS: Record<ErrorType, string> = {
  gender: "Noun gender",
  article: "Articles",
  agreement: "Agreement",
  conjugation: "Verb forms",
  auxiliary: "Avere / essere",
  preposition: "Prepositions",
  "word-order": "Word order",
  vocabulary: "Word choice",
  other: "Other",
};

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

/** One chunk of speech between pauses. Chunks are shown together as a single paragraph. */
export interface Sentence {
  id: number;
  text: string;
  status: "transcribing" | "checking" | "done" | "failed";
  correction?: Correction;
  failure?: string;
}

/** A session the user chose to keep. */
export interface SavedSession {
  id: number;
  date: string;
  sentences: Sentence[];
}

export interface PairStat {
  wrong: string;
  right: string;
  type: ErrorType;
  count: number;
  last: number;
}

/** Aggregated data about the user's mistakes over time. No session content is kept here. */
export interface Stats {
  sessions: number;
  words: number;
  mistakes: number;
  byType: Partial<Record<ErrorType, number>>;
  pairs: Record<string, PairStat>;
  history: { date: string; words: number; mistakes: number }[];
}
