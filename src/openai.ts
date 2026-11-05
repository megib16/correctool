import type { Correction } from "./types";

export interface TranscribeOptions {
  key: string;
  model: string;
  prompt: string;
}

export async function transcribe(wav: Blob, o: TranscribeOptions): Promise<string> {
  const form = new FormData();
  form.append("file", wav, "speech.wav");
  form.append("model", o.model);
  form.append("language", "it");
  form.append("temperature", "0");
  form.append("prompt", o.prompt);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription ${res.status}: ${await res.text()}`);
  return ((await res.json()).text as string) ?? "";
}

export interface CorrectOptions {
  key: string;
  model: string;
  level: string;
  explainIn: "English" | "simple Italian";
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corrected", "errors", "suggestion"],
  properties: {
    corrected: { type: "string" },
    suggestion: { type: ["string", "null"] },
    errors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["wrong", "right", "type", "explanation"],
        properties: {
          wrong: { type: "string" },
          right: { type: "string" },
          type: {
            type: "string",
            enum: [
              "gender",
              "article",
              "agreement",
              "conjugation",
              "auxiliary",
              "preposition",
              "word-order",
              "vocabulary",
              "other",
            ],
          },
          explanation: { type: "string" },
        },
      },
    },
  },
} as const;

function systemPrompt(o: CorrectOptions): string {
  return `You are an Italian teacher correcting spoken Italian from a ${o.level}-level learner.
You get a fragment of text transcribed from the learner's speech. Check it.

The learner pauses and hesitates while thinking, so a fragment can start or end in the middle of a sentence. Read it as a continuation of the earlier text. Never flag a fragment for being incomplete, and ignore hesitation sounds (eh, ehm, mmm, uhm, boh).

Rules:
- Punctuation, capitalisation and apostrophes come from the transcription, not the learner. Never flag them.
- Flag only genuine errors: gender, articles, agreement, verb conjugation, auxiliary choice, prepositions, word order, wrong word choice. Never flag correct Italian, even if it is unusual or you would phrase it differently. Never invent errors.
- If the fragment is correct: errors = [] and corrected = the input unchanged.
- "wrong" must be an exact, contiguous substring of the fragment to check. "right" is its replacement. Keep spans minimal but include the words needed for the fix (e.g. "il città" -> "la città").
- "explanation": one or two short sentences in ${o.explainIn}. Name the rule. For gender or article errors, state the noun's gender (e.g. "città" is feminine).
- "corrected": the whole fragment with all fixes applied.
- "suggestion": if the fragment (after correction) is grammatical but sounds awkward or unnatural to a native speaker, give a more natural rephrasing of it; otherwise null. Never repeat "corrected".
- The earlier text is provided only as context (for agreement, topic). Never correct it.`;
}

export async function correct(
  sentence: string,
  context: string[],
  o: CorrectOptions,
): Promise<Correction> {
  const user =
    (context.length ? `Earlier text (context only, do not correct):\n${context.join(" ")}\n\n` : "") +
    `Fragment to check:\n${sentence}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: o.model,
      messages: [
        { role: "system", content: systemPrompt(o) },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "correction", strict: true, schema: SCHEMA },
      },
    }),
  });
  if (!res.ok) throw new Error(`Correction ${res.status}: ${await res.text()}`);
  const msg = (await res.json()).choices?.[0]?.message;
  if (!msg?.content) throw new Error(`No correction returned${msg?.refusal ? `: ${msg.refusal}` : ""}`);
  return JSON.parse(msg.content) as Correction;
}
