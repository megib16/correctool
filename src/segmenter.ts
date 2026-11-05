// Turns a stream of microphone samples into clips of speech (one WAV per phrase).
// Pure logic, no browser APIs, so it can be tested with recorded audio.

export type CutReason = "pause" | "soft" | "hard" | "flush";
export type SegmentHandler = (wav: Blob, seq: number, reason: CutReason) => void;
export type LevelHandler = (level: number, speaking: boolean) => void;

export const TARGET_RATE = 16000;
const MIN_VOICED_MS = 350; // ignore clicks and very short noises
const PREROLL_MS = 500; // audio kept from before speech was detected, so first words aren't clipped
const TAIL_MS = 400; // silence kept after the last speech (long silence makes models hallucinate)
const MAX_SEGMENT_MS = 10000; // hard cut if there is no gap at all (rare)
const DIP_MS = 250; // a small gap (breath, comma, thinking): good enough to cut at once the clip is long enough

export interface Frame {
  data: Float32Array;
  ms: number;
  loud: boolean;
}

export class Segmenter {
  private preroll: Frame[] = [];
  private prerollMs = 0;
  private segment: Frame[] = [];
  private segmentMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private speaking = false;
  private paused = false;
  private noiseFloor = 0.004;
  private seq = 0;

  constructor(
    private sampleRate: number,
    private onSegment: SegmentHandler,
    private onLevel: LevelHandler = () => {},
    private softCutMs = 4500, // while talking, cut at the next small dip once a clip is this long
    private endSilenceMs = 2500, // a pause this long always ends the clip
  ) {}

  /** While paused, incoming audio is ignored (used while the AI is speaking, so it can't hear itself). */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.reset();
  }

  /** Sends whatever is being said right now without waiting for a pause. */
  flush() {
    if (this.speaking) this.finish("flush");
  }

  push(data: Float32Array) {
    if (this.paused) {
      this.onLevel(0, false);
      return;
    }
    const ms = (data.length / this.sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    // Hysteresis: it takes a clearly loud sound to start, but quieter sound counts as still speaking.
    const startAt = Math.max(0.01, this.noiseFloor * 4);
    const keepAt = Math.max(0.006, this.noiseFloor * 2.2);

    if (!this.speaking) {
      const loud = rms > startAt;
      const frame = { data, ms, loud };
      if (loud) {
        this.speaking = true;
        this.segment = [...this.preroll, frame];
        this.segmentMs = this.prerollMs + ms;
        this.voicedMs = ms;
        this.silenceMs = 0;
        this.preroll = [];
        this.prerollMs = 0;
      } else {
        this.noiseFloor = Math.min(0.02, this.noiseFloor * 0.95 + rms * 0.05);
        this.preroll.push(frame);
        this.prerollMs += ms;
        while (this.prerollMs > PREROLL_MS && this.preroll.length > 1) this.prerollMs -= this.preroll.shift()!.ms;
      }
    } else {
      const loud = rms > keepAt;
      this.segment.push({ data, ms, loud });
      this.segmentMs += ms;
      if (loud) {
        this.voicedMs += ms;
        this.silenceMs = 0;
      } else {
        this.silenceMs += ms;
      }
      if (this.silenceMs >= this.endSilenceMs) this.finish("pause");
      else if (this.segmentMs >= this.softCutMs && this.silenceMs >= DIP_MS) this.finish("soft");
      else if (this.segmentMs >= MAX_SEGMENT_MS) this.finish("hard");
    }
    this.onLevel(rms, this.speaking);
  }

  private reset() {
    this.speaking = false;
    this.segment = [];
    this.segmentMs = 0;
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.preroll = [];
    this.prerollMs = 0;
  }

  private finish(reason: CutReason) {
    const frames = this.segment;
    const voiced = this.voicedMs;
    this.reset();
    this.emit(frames, voiced, reason);
  }

  private emit(frames: Frame[], voiced: number, reason: CutReason) {
    if (voiced < MIN_VOICED_MS) return;
    const wav = encodeWav(downsample(concat(trimTail(frames)), this.sampleRate, TARGET_RATE), TARGET_RATE);
    this.onSegment(wav, this.seq++, reason);
  }
}

/** Drops most of the silence after the last speech. */
export function trimTail(frames: Frame[]): Frame[] {
  let last = frames.length - 1;
  while (last > 0 && !frames[last].loud) last--;
  let end = last + 1;
  let tail = 0;
  while (end < frames.length && tail + frames[end].ms <= TAIL_MS) tail += frames[end++].ms;
  return frames.slice(0, end);
}

function concat(frames: Frame[]): Float32Array {
  const total = frames.reduce((n, f) => n + f.data.length, 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const f of frames) {
    out.set(f.data, pos);
    pos += f.data.length;
  }
  return out;
}

/** Resamples with a windowed-sinc low-pass filter, so sound above the new range does not fold back in as noise. */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const cutoff = (0.46 * to) / from; // cycles per input sample, just under the new Nyquist frequency
  const half = Math.ceil(3 / cutoff); // about 6 zero crossings of the sinc
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const centre = i * ratio;
    const first = Math.ceil(centre - half);
    let sum = 0;
    let norm = 0;
    for (let j = first; j <= centre + half; j++) {
      const x = j - centre;
      const sinc = x === 0 ? 1 : Math.sin(2 * Math.PI * cutoff * x) / (2 * Math.PI * cutoff * x);
      const w = sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / (half + 1))); // Hann window
      norm += w;
      if (j >= 0 && j < input.length) sum += w * input[j];
    }
    out[i] = sum / norm;
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
