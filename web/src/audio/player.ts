// Plays the programs' sound in the browser (docs/re/audio.md §8, docs/re/shell.md §9). Each
// tick, the audio model (model.ts) turns the running program's sound calls into SPU register
// writes and CD events on the original's clock; the player maps that clock onto the
// AudioContext's, sends the writes to the SPU worklet and plays the CD's sectors from the encoded
// tracks, through CdMix and the CD volume.
import type { Mem } from '../core/mem';
import type { SoundCall } from '../core/sound';
import type { Disc } from './cd';
import { CYCLES_PER_VBLANK } from './driver';
import { AudioModel } from './model';
import { VAB_SPU_BASE, Vab } from './vab';
import type { TimedWrite, WorkletMessage } from './worklet';
import workletUrl from './worklet.ts?worker&url';

/**
 * What the player takes from a program: the machine's memory (settings, the program's tables;
 * the same for every program the machine runs) and each tick's sound calls.
 */
export interface Sounding {
  m: Mem;
  sound: SoundCall[];
}

/** How far ahead of the audio clock ticks are scheduled, and how late they may run. */
const LEAD = 0.12;
const MIN_LEAD = 0.03;
/** The level a real console's CD path gives (Redux), before CdMix's attenuation. */
const CD_LEVEL = (31130 / 32768) * (31880 / 32768);

interface DiscFiles extends Disc {
  fileStart: number[];
  sectors: number[];
}

export class AudioPlayer {
  private model?: AudioModel;
  private node?: AudioWorkletNode;
  private disc?: DiscFiles;
  private readonly tracks = new Map<number, Promise<AudioBuffer | undefined>>();
  private source?: AudioBufferSourceNode;
  private sourceTrack = 0;
  /** Counts CD segments, so a track that finishes decoding late starts only if still wanted. */
  private segment = 0;
  private lastSector = -2;
  private cdLeft?: GainNode;
  private cdRight?: GainNode;
  /** CdMix's matrix: left to left, right to left, left to right, right to right. */
  private cdMix: GainNode[] = [];
  private cdInput?: AudioNode;
  private out?: GainNode;
  private anchorCycle = 0;
  private anchorTime = -1;

  private constructor(
    readonly ctx: AudioContext,
    private readonly base: string,
    private readonly tickSeconds: number,
  ) {}

  /** Creates the player; call `resume` from a user gesture for sound to start. */
  static async create(game: Sounding, base: string, tickSeconds: number): Promise<AudioPlayer> {
    const ctx = new AudioContext({ sampleRate: 44100 });
    const p = new AudioPlayer(ctx, base, tickSeconds);
    await p.init(game);
    return p;
  }

  private async init(game: Sounding): Promise<void> {
    const get = async (name: string) => new Uint8Array(await (await fetch(`${this.base}${name}`)).arrayBuffer());
    const [vh, vb, disc] = await Promise.all([get('EF.VH'), get('EF.VB'), get('disc.json')]);
    this.disc = JSON.parse(new TextDecoder().decode(disc));
    const vab = new Vab(vh, vb);
    this.model = new AudioModel(vab, game.m, this.disc!);
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.node = new AudioWorkletNode(this.ctx, 'tp-spu', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.out);
    this.node.port.postMessage({ type: 'ram', address: VAB_SPU_BASE, data: vab.body } satisfies WorkletMessage);
    // The CD's path: CdMix (the ATV matrix, set by each program's start and Option mode's stereo
    // row), then the SPU's CD volume.
    const split = this.ctx.createChannelSplitter(2);
    const merge = this.ctx.createChannelMerger(2);
    this.cdLeft = this.ctx.createGain();
    this.cdRight = this.ctx.createGain();
    for (const [from, to] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      split.connect(g, from);
      g.connect(to === 0 ? this.cdLeft : this.cdRight);
      this.cdMix.push(g);
    }
    this.cdLeft.connect(merge, 0, 0);
    this.cdRight.connect(merge, 0, 1);
    merge.connect(this.out);
    this.cdInput = split;
  }

  /** CdMix at `at` (ATV values of 0x80): stereo 0x7F, 0, 0x7F, 0; mono 0x40 from each side to both. */
  private setCdMix(mono: boolean, at: number): void {
    const gains = (mono ? [0x40, 0x40, 0x40, 0x40] : [0x7f, 0, 0, 0x7f]).map((v) => v / 0x80);
    this.cdMix.forEach((g, i) => g.gain.setValueAtTime(gains[i] * CD_LEVEL, at));
  }

  /** The shell's master volume, 0-1, after the game's own mix. */
  set volume(v: number) {
    if (this.out) this.out.gain.value = v;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /**
   * After each game tick, with the vblanks it took: 1, or more when the program held the
   * picture (a VSync(n) wait), so the music plays on meanwhile.
   */
  tick(game: Sounding, vblanks = 1): void {
    const model = this.model;
    if (!model || !this.node) return;
    const s = model.step(game.sound, vblanks);
    const now = this.ctx.currentTime;
    if (this.anchorTime < 0 || this.time(s.cycle) < now + MIN_LEAD) {
      this.anchorCycle = s.cycle;
      this.anchorTime = now + LEAD;
    }
    if (s.mono) this.setCdMix(s.mono.mono, Math.max(now, this.time(s.mono.cycle)));
    const writes: TimedWrite[] = [];
    for (const w of s.writes) {
      writes.push([Math.max(0, Math.round(this.time(w.cycle) * this.ctx.sampleRate)), w.offset, w.value]);
      if (w.offset === 0x1b0 || w.offset === 0x1b2) {
        const gain = w.offset === 0x1b0 ? this.cdLeft : this.cdRight;
        gain?.gain.setValueAtTime((w.value & 0x7fff) / 0x8000, Math.max(now, this.time(w.cycle)));
      }
    }
    if (writes.length) this.node.port.postMessage({ type: 'writes', writes } satisfies WorkletMessage);
    for (const e of s.cdEvents) {
      const at = Math.max(now, this.time(e.cycle));
      if (e.kind === 'cd' && e.data[0] === 2) {
        // Setloc: start fetching the track it seeks to.
        const msf = (bcd(e.data[1]) * 60 + bcd(e.data[2])) * 75 + bcd(e.data[3]);
        void this.track(this.trackAt(msf));
      } else if (e.kind === 'cd' && e.data[0] === 3) {
        this.stopSource(at);
      } else if (e.kind === 'sector') {
        const pos = e.data[0];
        if (pos !== this.lastSector + 1 || this.trackAt(pos) !== this.sourceTrack) this.startSource(pos, at);
        this.lastSector = pos;
      }
    }
  }

  /** The audio clock's time for a cycle of the model's clock (one vblank per tick). */
  private time(cycle: number): number {
    return this.anchorTime + ((cycle - this.anchorCycle) / CYCLES_PER_VBLANK) * this.tickSeconds;
  }

  private trackAt(msf: number): number {
    const d = this.disc!;
    for (let n = d.fileStart.length - 1; n >= 1; n--) if (d.fileStart[n] <= msf) return n;
    return 1;
  }

  private track(n: number): Promise<AudioBuffer | undefined> {
    if (n < 2 || n > 51) return Promise.resolve(undefined);
    let p = this.tracks.get(n);
    if (!p) {
      p = fetch(`${this.base}music/${String(n).padStart(2, '0')}.opus`)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .catch(() => undefined);
      this.tracks.set(n, p);
      // Keep a few decoded tracks (a minute of CD audio is ~20 MB as floats).
      if (this.tracks.size > 4) this.tracks.delete(this.tracks.keys().next().value!);
    }
    return p;
  }

  private stopSource(at: number): void {
    this.source?.stop(at);
    this.source = undefined;
    this.sourceTrack = 0;
    this.segment++;
    this.lastSector = -2;
  }

  private startSource(pos: number, at: number): void {
    this.stopSource(at);
    const n = this.trackAt(pos);
    this.sourceTrack = n;
    const offset = (pos - this.disc!.fileStart[n]) / 75;
    const startedAt = at;
    const segment = this.segment;
    void this.track(n).then((buffer) => {
      if (!buffer || segment !== this.segment) return;
      const now = this.ctx.currentTime;
      const late = Math.max(0, now - startedAt);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.cdInput!);
      src.start(Math.max(now, startedAt), offset + late);
      this.source = src;
    });
  }
}

const bcd = (b: number) => (b >> 4) * 10 + (b & 15);
