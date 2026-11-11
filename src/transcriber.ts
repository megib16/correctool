// Listens to the microphone and hands over one WAV clip per spoken phrase.
// The pause detection itself lives in segmenter.ts.
import { Segmenter } from "./segmenter";
import type { LevelHandler, SegmentHandler } from "./segmenter";

export type { CutReason, LevelHandler, SegmentHandler } from "./segmenter";

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
  private static owner: PauseTranscriber | null = null;
  private stopped = false;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private workletUrl?: string;
  private seg?: Segmenter;

  constructor(
    private onSegment: SegmentHandler,
    private onLevel: LevelHandler = () => {},
    private softCutMs = 4500, // while talking, cut at the next small dip once a clip is this long
    private endSilenceMs = 2500, // a pause this long always ends the clip
  ) {}

  async start(): Promise<void> {
    if (PauseTranscriber.owner) throw new Error("Another recording is active. Stop it before starting a new one.");
    PauseTranscriber.owner = this;
    this.stopped = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.stopped) {
        this.stream.getTracks().forEach((track) => track.stop());
        throw new Error("Recording was stopped.");
      }
      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.seg = new Segmenter(this.ctx.sampleRate, this.onSegment, this.onLevel, this.softCutMs, this.endSilenceMs);
      this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
      await this.ctx.audioWorklet.addModule(this.workletUrl);
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, "tap");
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.seg?.push(e.data);
      source.connect(this.node); // not connected to destination: no echo
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  setPaused(paused: boolean) {
    this.seg?.setPaused(paused);
  }

  flush() {
    this.seg?.flush();
  }

  /** Stops listening and flushes any phrase still in progress. */
  async stop(): Promise<void> {
    this.stopped = true;
    try {
      this.seg?.flush();
    } finally {
      this.node?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
      if (PauseTranscriber.owner === this) PauseTranscriber.owner = null;
      this.seg = undefined;
      this.node = undefined;
      this.stream = undefined;
      this.workletUrl = undefined;
      const ctx = this.ctx;
      this.ctx = undefined;
      this.onLevel(0, false);
      if (ctx && ctx.state !== "closed") await ctx.close().catch(() => {});
    }
  }
}
