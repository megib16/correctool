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

// ---------- role-play: the AI's side of the conversation ----------
export interface ChatTurn {
  role: "ai" | "user";
  text: string;
}

export interface Character {
  personality: string; // what the character is like
  mood: string; // today's mood
  twist: string; // something going on today
}

export interface ConverseOptions {
  key: string;
  model: string;
  level: string;
  setup: string; // who the AI is and the situation
  persona?: string; // the AI's name and gender, so it stays consistent with the voice
  character?: Character;
  userTurns: number; // how many times the learner has spoken so far
  maxTurns: number; // the conversation must be over by this many learner turns
}

export interface Reply {
  reply: string;
  tone: string; // how the line should sound, passed on to the voice
  end: boolean;
}

const LEVEL_GUIDE: Record<string, { style: string; length: string }> = {
  A1: { style: "very simple present-tense sentences, basic everyday vocabulary, one idea at a time", length: "one or two short sentences" },
  A2: { style: "simple sentences with common vocabulary; past and near future are fine", length: "one or two short sentences" },
  B1: { style: "clear everyday Italian with some connectors and mixed tenses", length: "one to three sentences" },
  B2: { style: "natural, fluent Italian, occasional idioms, subjunctive where natural", length: "two to four sentences" },
  C1: { style: "sophisticated, idiomatic, nuanced Italian", length: "two to four sentences" },
};

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "tone", "end"],
  properties: { reply: { type: "string" }, tone: { type: "string" }, end: { type: "boolean" } },
} as const;

// A little randomness so the character does not repeat itself. Some models reject these, so there is a fallback.
const SAMPLING = { temperature: 1, frequency_penalty: 0.4, presence_penalty: 0.3 };

function conversationPrompt(o: ConverseOptions): string {
  const g = LEVEL_GUIDE[o.level] ?? LEVEL_GUIDE.B1;
  const c = o.character;
  const lastExchange = o.userTurns >= o.maxTurns - 1;
  return `${o.persona ?? ""}
${o.setup}
${c ? `\nCHARACTER\n${c.personality}\nToday you are ${c.mood}.${c.twist ? ` Something that is going on: ${c.twist}.` : ""}\n` : ""}
You are a real person in a real situation. You are NOT a teacher, tutor or assistant: never explain Italian, never correct the learner, never mention an exercise or being an AI.
The person you are talking to is learning Italian (level ${o.level}). Use ${g.style}. A typical line is ${g.length}, but vary it: sometimes just a quick reaction ("Ah, davvero?", "Mhm, capisco."), sometimes more when you have something to say.

HOW TO SOUND LIKE A PERSON
- React first to what they actually said (surprise, amusement, sympathy, doubt, enthusiasm), then move the scene on. Pick up on specific details they gave, and refer back to things said earlier.
- Share something about yourself or your day now and then, give opinions, tease gently if it suits you. Don't just interview them.
- Do NOT end every line with a question. About half of your lines should end with a statement, a comment or a reaction.
- Vary how your lines start and how long they are. Never begin two lines in a row with the same word, and do not reuse phrases or fillers you have already used.
- Speak real spoken Italian, because your lines are read aloud: short sentences, interjections that fit YOUR character (not the same ones every time), the occasional self-correction or hesitation ("cioè...", "anzi...", "ehm"). No lists, no formal written style, no stage directions, no emojis.
- The learner's messages come from speech transcription and may contain grammar mistakes. Answer what they meant. If you did not understand, react as a real person would ("Come? Scusa, non ho capito.") and let them try again.
- "tone": 2 to 5 English words for how you say this exact line (for example "warm and amused", "in a hurry", "doubtful", "apologetic", "teasing"). Make it match the line, and vary it.

ENDING
- You decide when the conversation ends. Set "end" to true when the scene has reached its natural conclusion (order paid, problem solved, interview over, goodbye said) or when the limit below is reached. When "end" is true, "reply" must be a natural closing line with no question.
- The learner has spoken ${o.userTurns} time(s) so far. The conversation must be over after at most ${o.maxTurns} learner turns.${
    lastExchange ? " This is the final exchange: wrap up now with a closing line and set end to true." : ""
  }`;
}

export async function converse(history: ChatTurn[], o: ConverseOptions): Promise<Reply> {
  const messages = [
    { role: "system", content: conversationPrompt(o) },
    ...(history.length
      ? history.map((t) => ({ role: t.role === "ai" ? "assistant" : "user", content: t.text }))
      : [{ role: "user", content: "[Begin the scene now with your opening line.]" }]),
  ];
  const send = (extra: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: o.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "reply", strict: true, schema: REPLY_SCHEMA } },
        ...extra,
      }),
    });
  let res = await send(SAMPLING);
  if (res.status === 400 && /temperature|penalty/i.test(await res.clone().text())) res = await send({});
  if (!res.ok) throw new Error(`Conversation ${res.status}: ${await res.text()}`);
  const msg = (await res.json()).choices?.[0]?.message;
  if (!msg?.content) throw new Error(`No reply returned${msg?.refusal ? `: ${msg.refusal}` : ""}`);
  return JSON.parse(msg.content) as Reply;
}

// ---------- role-play: spoken replies ----------
export interface SpeakOptions {
  key: string;
  model: string;
  voice: string;
  level: string;
  style?: string; // who is speaking and how, e.g. "a calm, reassuring doctor"
  tone?: string; // how this particular line should sound, e.g. "warm and amused"
}

export async function speak(text: string, o: SpeakOptions): Promise<Blob> {
  const slow = o.level === "A1" || o.level === "A2";
  const body: Record<string, unknown> = { model: o.model, voice: o.voice, input: text, response_format: "mp3" };
  // Only the newer gpt-4o speech models accept style instructions.
  if (o.model.startsWith("gpt-4o")) {
    body.instructions =
      `You are ${o.style ?? "a native Italian speaker"}, from Italy. Speak with an authentic Italian accent and ` +
      "natural, expressive intonation, the way a real person talks in this situation: varied pitch, small natural " +
      "hesitations, a little emotion. Never sound like someone reading aloud, and never like an English speaker " +
      "reading Italian. " +
      (slow
        ? "Speak slowly and very clearly, as to a beginner, with small pauses between phrases."
        : "Speak at a natural conversational pace.") +
      (o.tone ? ` Deliver this particular line ${o.tone}.` : "");
  }
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Speech ${res.status}: ${await res.text()}`);
  return await res.blob();
}
