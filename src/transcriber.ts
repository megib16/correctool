// Listens to the microphone, detects pauses (simple energy-based VAD) and hands
// over one 16 kHz mono WAV clip per spoken sentence/phrase.

export type SegmentHandler = (wav: Blob, seq: number) => void;
export type LevelHandler = (level: number, speaking: boolean) => void;

const TARGET_RATE = 16000;
const MIN_VOICED_MS = 350; // ignore clicks / very short noises
const PREROLL_MS = 400; // audio kept from before speech was detected
const MAX_SEGMENT_MS = 12000; // hard cut if there is no dip at all (rare)
const DIP_MS = 250; // a tiny gap between words/phrases, good enough to cut at once the chunk is long enough

const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("tap", Tap);
`;

export class PauseTranscriber {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private workletUrl?: string;

  private preroll: Float32Array[] = [];
  private prerollMs = 0;
  private segment: Float32Array[] = [];
  private segmentMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private speaking = false;
  private noiseFloor = 0.004;
  private seq = 0;

  constructor(
    private onSegment: SegmentHandler,
    private onLevel: LevelHandler = () => {},
    private softCutMs = 4500, // while talking, cut at the next small dip once a chunk is this long
    private endSilenceMs = 800, // a real pause always ends the chunk
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "tap");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
    source.connect(this.node); // not connected to destination: no echo
  }

  /** Stops listening and flushes any sentence still in progress. */
  async stop(): Promise<void> {
    if (this.speaking) this.finishSegment();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.onLevel(0, false);
  }

  private onFrame(frame: Float32Array) {
    const rate = this.ctx!.sampleRate;
    const ms = (frame.length / rate) * 1000;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const threshold = Math.max(0.012, this.noiseFloor * 3.5);
    const loud = rms > threshold;

    if (!this.speaking) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      this.preroll.push(frame);
      this.prerollMs += ms;
      while (this.prerollMs > PREROLL_MS && this.preroll.length > 1) {
        this.prerollMs -= (this.preroll.shift()!.length / rate) * 1000;
      }
      if (loud) {
        this.speaking = true;
        this.segment = [...this.preroll];
        this.segmentMs = this.prerollMs;
        this.voicedMs = ms;
        this.silenceMs = 0;
        this.preroll = [];
        this.prerollMs = 0;
      }
    } else {
      this.segment.push(frame);
      this.segmentMs += ms;
      if (loud) {
        this.voicedMs += ms;
        this.silenceMs = 0;
      } else {
        this.silenceMs += ms;
      }
      const softCut = this.segmentMs >= this.softCutMs && this.silenceMs >= DIP_MS;
      if (this.silenceMs >= this.endSilenceMs || softCut || this.segmentMs >= MAX_SEGMENT_MS) {
        this.finishSegment();
      }
    }
    this.onLevel(rms, this.speaking);
  }

  private finishSegment() {
    const frames = this.segment;
    const voiced = this.voicedMs;
    this.segment = [];
    this.segmentMs = 0;
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.speaking = false;
    if (voiced < MIN_VOICED_MS) return;
    const samples = concat(frames);
    const wav = encodeWav(downsample(samples, this.ctx!.sampleRate, TARGET_RATE), TARGET_RATE);
    this.onSegment(wav, this.seq++);
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const f of frames) {
    out.set(f, pos);
    pos += f.length;
  }
  return out;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
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
