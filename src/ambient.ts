// Background sound for role-play (café chatter, a market, traffic...), to make listening harder and more realistic.
// It plays real recordings that you put in public/ambient/ (see the README there). Nothing is generated.

export type AmbientKind = "cafe" | "market" | "street" | "indoor";
export type AmbientLevel = "low" | "medium" | "high";

/** How loud each setting is compared with the other person's voice. */
export const LEVEL_GAIN: Record<AmbientLevel, number> = { low: 0.25, medium: 0.55, high: 1 };

/** If a scene has no recording of its own, the next best one is used, so one or two files are enough. */
const FALLBACKS: Record<AmbientKind, AmbientKind[]> = {
  cafe: ["cafe"],
  market: ["market", "street", "cafe"],
  street: ["street"],
  indoor: ["indoor", "cafe"],
};
const EXTENSIONS = ["mp3", "m4a", "ogg", "wav"];

export class NoRecordingError extends Error {}

const recordings = new Map<AmbientKind, ArrayBuffer>(); // only recordings that were found are remembered

async function fetchRecording(kind: AmbientKind): Promise<ArrayBuffer | null> {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  for (const name of FALLBACKS[kind]) {
    for (const ext of EXTENSIONS) {
      try {
        const res = await fetch(`${base}ambient/${name}.${ext}`);
        // the dev server answers unknown paths with the web page itself, so make sure it really is audio
        if (res.ok && !(res.headers.get("content-type") ?? "").startsWith("text/")) return await res.arrayBuffer();
      } catch {
        /* try the next one */
      }
    }
  }
  return null;
}

/** Is there a recording (or a fallback) for this kind of scene? */
export async function hasRecording(kind: AmbientKind): Promise<boolean> {
  if (!recordings.has(kind)) {
    const data = await fetchRecording(kind);
    if (data) recordings.set(kind, data);
  }
  return recordings.has(kind);
}

export class Ambient {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private source?: AudioBufferSourceNode;
  private kind?: AmbientKind;
  private level: AmbientLevel = "medium";
  private active = false;
  private decoded = new Map<AmbientKind, AudioBuffer>();

  /** Starts the loop silently. Use setActive to make it audible. Throws NoRecordingError if there is no recording. */
  async start(kind: AmbientKind, level: AmbientLevel) {
    this.level = level;
    if (this.source && this.kind === kind) {
      this.ramp();
      return;
    }
    if (!(await hasRecording(kind))) throw new NoRecordingError(`No recording for ${kind}`);
    this.stop();
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
    let buffer = this.decoded.get(kind);
    if (!buffer) {
      buffer = await this.ctx.decodeAudioData(recordings.get(kind)!.slice(0));
      this.decoded.set(kind, buffer);
    }
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.ctx.destination);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.gain = gain;
    this.source = source;
    this.kind = kind;
    this.ramp();
  }

  setActive(on: boolean) {
    this.active = on;
    this.ramp();
  }

  setLevel(level: AmbientLevel) {
    this.level = level;
    this.ramp();
  }

  stop() {
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.source = undefined;
    this.gain = undefined;
    this.kind = undefined;
    this.active = false;
  }

  private ramp() {
    if (!this.gain || !this.ctx) return;
    const target = this.active ? LEVEL_GAIN[this.level] : 0;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }
}
