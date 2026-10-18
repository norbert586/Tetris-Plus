// Plays Puzzle Mode's sound in the browser (docs/re/audio.md §8). Each tick, the audio model
// (model.ts) turns the program's sound calls into SPU register writes and CD events on the
// original's clock; the player maps that clock onto the AudioContext's, sends the writes to the
// SPU worklet and plays the CD's sectors from the encoded tracks, through the CD volume.
import type { Game } from '../core/game';
import { MUSIC_VOLUME, SETTING_4FC } from '../core/addr';
import type { Disc } from './cd';
import { CYCLES_PER_VBLANK } from './driver';
import { AudioModel } from './model';
import { VAB_SPU_BASE, Vab } from './vab';
import type { TimedWrite, WorkletMessage } from './worklet';
import workletUrl from './worklet.ts?worker&url';

/** The music volume table (0x800DC45C) the CD volume starts from. */
const MUSIC_VOLUME_TABLE = 0x800dc45c;
/** How far ahead of the audio clock ticks are scheduled, and how late they may run. */
const LEAD = 0.12;
const MIN_LEAD = 0.03;
/** CdMix's attenuation (0x7F of 0x80) and the level a real console's CD path gives (Redux). */
const CD_LEVEL = (0x7f / 0x80) * (31130 / 32768) * (31880 / 32768);

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
  private cdInput?: AudioNode;
  private anchorCycle = 0;
  private anchorTime = -1;

  private constructor(
    readonly ctx: AudioContext,
    private readonly base: string,
    private readonly tickSeconds: number,
  ) {}

  /** Creates the player; call `resume` from a user gesture for sound to start. */
  static async create(game: Game, base: string, tickSeconds: number): Promise<AudioPlayer> {
    const ctx = new AudioContext({ sampleRate: 44100 });
    const p = new AudioPlayer(ctx, base, tickSeconds);
    await p.init(game);
    return p;
  }

  private async init(game: Game): Promise<void> {
    const get = async (name: string) => new Uint8Array(await (await fetch(`${this.base}${name}`)).arrayBuffer());
    const [vh, vb, disc] = await Promise.all([get('EF.VH'), get('EF.VB'), get('disc.json')]);
    this.disc = JSON.parse(new TextDecoder().decode(disc));
    const vab = new Vab(vh, vb);
    const mono = (game.m.u8(SETTING_4FC) & 1) !== 0;
    this.model = new AudioModel(vab, game.m, this.disc!,
      () => game.m.s16(MUSIC_VOLUME_TABLE + 2 * game.m.u8(MUSIC_VOLUME)), mono);
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.ctx, 'tp-spu', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.ctx.destination);
    this.node.port.postMessage({ type: 'ram', address: VAB_SPU_BASE, data: vab.body } satisfies WorkletMessage);
    // The CD's path: CdMix (the ATV matrix; mono sends both sides to both), then the SPU's CD volume.
    const split = this.ctx.createChannelSplitter(2);
    const merge = this.ctx.createChannelMerger(2);
    this.cdLeft = this.ctx.createGain();
    this.cdRight = this.ctx.createGain();
    for (const [from, to, gain] of mono ? [[0, 0, 0.5], [1, 0, 0.5], [0, 1, 0.5], [1, 1, 0.5]] : [[0, 0, 1], [1, 1, 1]]) {
      const g = this.ctx.createGain();
      g.gain.value = gain * CD_LEVEL;
      split.connect(g, from);
      g.connect(to === 0 ? this.cdLeft : this.cdRight);
    }
    this.cdLeft.connect(merge, 0, 0);
    this.cdRight.connect(merge, 0, 1);
    merge.connect(this.ctx.destination);
    this.cdInput = split;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** After each game tick. */
  tick(game: Game): void {
    const model = this.model;
    if (!model || !this.node) return;
    const s = model.step(game.sound, 1);
    const now = this.ctx.currentTime;
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
