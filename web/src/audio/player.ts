// Plays the game's sound in the browser (docs/re/audio.md §8, §11). Each tick, the audio model
// (model.ts) turns the running program's sound calls into SPU register writes and CD events on
// the original's clock; the player maps that clock onto the AudioContext's, sends the writes to
// the SPU worklet and plays the CD's sectors from the encoded tracks, through the CD volume. When
// another program starts, the model runs that program's sound set-up, as the console does.
import type { Mem } from '../core/mem';
import type { SoundCall } from '../core/sound';
import { SETTING_4FC } from '../core/addr';
import type { Disc } from './cd';
import { CYCLES_PER_VBLANK } from './driver';
import { AudioModel, tickExtras } from './model';
import { PROGRAM_AUDIO, type ProgramAudio } from './programs';
import { VAB_SPU_BASE, Vab } from './vab';
import type { TimedWrite, WorkletMessage } from './worklet';
import workletUrl from './worklet.ts?worker&url';

/** How far ahead of the audio clock ticks are scheduled, and how late they may run. */
const LEAD = 0.12;
const MIN_LEAD = 0.03;
/** CdMix's attenuation (0x7F of 0x80) and the level a real console's CD path gives (Redux). */
const CD_LEVEL = (0x7f / 0x80) * (31130 / 32768) * (31880 / 32768);

/**
 * What the player follows: the running program (a flow Program or Puzzle Mode's Game): the RAM
 * it runs in (its sound tables and the settings), its name and its sound calls this tick. Another
 * source than the last tick's is a program change.
 */
export interface SoundSource {
  m: Mem;
  sound: SoundCall[];
  name?: string;
}

interface DiscFiles extends Disc {
  fileStart: number[];
  sectors: number[];
}

export class AudioPlayer {
  private model?: AudioModel;
  private vab?: Vab;
  /** The source the last tick came from. */
  private running?: SoundSource;
  private mono?: boolean;
  private cdMatrix: { gain: GainNode; same: boolean }[] = [];
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
  private cdInput?: AudioNode;
  private anchorCycle = 0;
  private anchorTime = -1;
  /** Master volume (the shell's setting), after the SPU and the CD. */
  private master?: GainNode;

  private constructor(
    readonly ctx: AudioContext,
    private readonly base: string,
    private readonly tickSeconds: number,
  ) {}

  /**
   * Creates the player; call `resume` from a user gesture for sound to start. The model starts
   * with the first tick, from the program that tick comes from.
   */
  static async create(base: string, tickSeconds: number): Promise<AudioPlayer> {
    const ctx = new AudioContext({ sampleRate: 44100 });
    const p = new AudioPlayer(ctx, base, tickSeconds);
    await p.init();
    return p;
  }

  private async init(): Promise<void> {
    const get = async (name: string) => new Uint8Array(await (await fetch(`${this.base}${name}`)).arrayBuffer());
    const [vh, vb, disc] = await Promise.all([get('EF.VH'), get('EF.VB'), get('disc.json')]);
    this.disc = JSON.parse(new TextDecoder().decode(disc));
    const vab = new Vab(vh, vb);
    this.vab = vab;
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.ctx, 'tp-spu', { numberOfInputs: 0, outputChannelCount: [2] });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.node.connect(this.master);
    this.node.port.postMessage({ type: 'ram', address: VAB_SPU_BASE, data: vab.body } satisfies WorkletMessage);
    // The CD's path: CdMix (the ATV matrix; mono sends both sides to both), then the SPU's CD volume.
    const split = this.ctx.createChannelSplitter(2);
    const merge = this.ctx.createChannelMerger(2);
    this.cdLeft = this.ctx.createGain();
    this.cdRight = this.ctx.createGain();
    for (const [from, to] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      split.connect(g, from);
      g.connect(to === 0 ? this.cdLeft : this.cdRight);
      this.cdMatrix.push({ gain: g, same: from === to });
    }
    this.cdLeft.connect(merge, 0, 0);
    this.cdRight.connect(merge, 0, 1);
    merge.connect(this.master);
    this.cdInput = split;
  }

  /** CdMix as each program's sound set-up calls it: stereo, or both CD channels to both sides at half level. */
  private setMono(mono: boolean, at: number): void {
    if (mono === this.mono) return;
    this.mono = mono;
    for (const { gain, same } of this.cdMatrix) gain.gain.setValueAtTime((mono ? 0.5 : same ? 1 : 0) * CD_LEVEL, at);
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** Stops the clock while the game is paused (the next tick re-anchors it). */
  suspend(): void {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Master volume, 0-1. */
  set volume(v: number) {
    if (this.master) this.master.gain.value = v;
  }

  /**
   * After each game tick. `extraVblanks`: vblanks the tick waited on the original beyond its
   * own (memory card calls, VSync(n)): the sound runs on through them (libsnd's flushes, the
   * CD's sectors), so the shell holds the next tick back by as long.
   */
  tick(game: SoundSource, extraVblanks = 0): void {
    if (!this.vab || !this.node) return;
    const changed = this.running !== undefined && game !== this.running;
    const program: ProgramAudio | undefined = game.name ? PROGRAM_AUDIO[game.name as keyof typeof PROGRAM_AUDIO] : undefined;
    if (!this.model) this.model = new AudioModel(this.vab, game.m, this.disc!, { program });
    const model = this.model;
    const first = this.running === undefined;
    this.running = game;
    // A program without an entry in PROGRAM_AUDIO keeps the last one's addresses.
    const s = model.step(game.sound, 1 + extraVblanks, changed ? program : undefined, tickExtras(game));
    const now = this.ctx.currentTime;
    if (first || (changed && program)) this.setMono((game.m.u8(SETTING_4FC) & 1) !== 0, now);
    for (const x of s.mix) this.setMono(x.mono, Math.max(now, this.time(x.cycle)));
    if (this.anchorTime < 0 || this.time(s.cycle) < now + MIN_LEAD) {
      this.anchorCycle = s.cycle;
      this.anchorTime = now + LEAD;
    }
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
