// The SPU in an AudioWorklet (docs/re/audio.md §8): renders spu.ts at 44.1 kHz, applying each
// register write at the frame the player scheduled it for.
import { Spu } from './spu';

/** A register write at an audio frame (the context's currentFrame clock). */
export type TimedWrite = [frame: number, offset: number, value: number];

export type WorkletMessage =
  | { type: 'ram'; address: number; data: Uint8Array }
  | { type: 'writes'; writes: TimedWrite[] };

declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

class SpuProcessor extends AudioWorkletProcessor {
  private readonly spu = new Spu();
  private queue: TimedWrite[] = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const m = e.data;
      if (m.type === 'ram') this.spu.ram.set(m.data, m.address);
      else {
        this.queue.push(...m.writes);
        this.queue.sort((a, b) => a[0] - b[0]);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const n = left.length;
    let done = 0;
    while (done < n) {
      const now = currentFrame + done;
      while (this.queue.length && this.queue[0][0] <= now) {
        const [, offset, value] = this.queue.shift()!;
        this.spu.write(offset, value);
      }
      const next = this.queue.length ? this.queue[0][0] - currentFrame : n;
      const run = Math.max(1, Math.min(n, next) - done);
      this.spu.render(left, right ?? left, done, run);
      done += run;
    }
    return true;
  }
}

registerProcessor('tp-spu', SpuProcessor);
