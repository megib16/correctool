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

/** One turn of a role-play conversation. */
export interface Turn {
  role: "ai" | "user";
  text: string;
  /** For the other speaker's lines: how the line should sound, e.g. "warm and amused". */
  tone?: string;
  /** For the learner's turns: the chunks of speech, with their corrections. */
  segments?: Sentence[];
}

/** A session the user chose to keep. Role-play sessions also carry their title and turns. */
export interface SavedSession {
  id: number;
  date: string;
  sentences: Sentence[];
  title?: string;
  turns?: Turn[];
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

// ---------- exercises ----------
export type ExerciseKind = "choice" | "fill" | "reorder";

export interface Exercise {
  kind: ExerciseKind;
  /** Which kind of mistake this exercise practises. */
  type: ErrorType;
  /** choice and fill: an Italian sentence with one blank written ___ . reorder: the English meaning. */
  prompt: string;
  /** choice only: the options to pick from. */
  options: string[];
  /** choice and fill: what goes in the blank. reorder: the whole correct sentence. */
  answer: string;
  /** Other answers that are also right. */
  accepted: string[];
  explanation: string;
  /** English translation of the finished sentence. */
  hint: string;
}

/** How the learner is doing in the exercises. */
export interface ExerciseStats {
  total: number;
  correct: number;
  byType: Partial<Record<ErrorType, { right: number; wrong: number }>>;
  history: { date: string; total: number; correct: number }[];
}
