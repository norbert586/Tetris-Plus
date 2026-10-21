// A program's sound, tick by tick (docs/re/audio.md §5): the program's sound calls (core
// SoundCall) run through libsnd and the SPU registers (driver.ts) and the CD drive (cd.ts) on one
// clock, CPU cycles since the first tick, so the result can be compared with the original's trace
// (kon, koff, spu, rev, cd, cdr) and played (player.ts).
//
// The clock: tick t ends with its sample, 45,519 cycles into the vblank that closes it; its logic
// starts right after the previous tick's sample, so the program's CD commands start about 50,000
// cycles into that tick's first vblank. Key-ons wait for the flush in the next vblank's interrupt.
import { MUSIC_VOLUME, SETTING_4FC } from '../core/addr';
import type { Mem } from '../core/mem';
import { PAZLE_SOUND, PROGRAM_SOUND, type SoundAddresses, type SoundCall } from '../core/sound';
import { CdDrive, type CdEvent, type Disc } from './cd';
import { CYCLES_PER_VBLANK, SoundDriver, type TickAudio } from './driver';
import type { Vab } from './vab';

/** Where in a vblank the trace's sample is taken, and where the logic's first CD command lands. */
const SAMPLE = 45_519;
const LOGIC_CD = 49_700;
/** In a tick that runs over several vblanks (loading a screen), the calls come at its end. */
const LONG_TICK_CD = -36_400;

/**
 * libsnd's flush counter (its history index, mod 16) at each program's first sample, read from
 * RAM dumps of the original (docs/re/shell.md §10): the flushes since the program's SsStart.
 * What the load takes before SsStart doesn't change it (SW_ON: 12 with first ticks of 27, 99 and
 * 170 vblanks); what follows can by a vblank (SELECT: 8, or 7 with select-card's cards). The
 * first tick spans the load, so the index it starts with is this minus that tick's vblanks.
 * PAZLE's agrees with docs/re/audio.md §3 (14 at tick 2).
 */
export const FIRST_SAMPLE_FLUSHES: Record<string, number> = {
  PAZLE: 13,
  SW_ON: 12,
  TIT_DEMO: 15,
  TITLE: 15,
  SELECT: 8,
  RANKING: 8,
};

export interface TickSound extends TickAudio {
  /** CD commands (command, then Setloc's or Setmode's bytes) and the callback's reports. */
  cd: number[][];
  cdr: number[][];
  /** Every CD event of the tick with its cycle (sectors included), for the player. */
  cdEvents: CdEvent[];
  /** The cycle of this tick's sample. */
  cycle: number;
  /** CdMix's matrix when the tick set it (a program's start, Option mode's stereo row): mono or stereo. */
  mono?: { mono: boolean; cycle: number };
}

export class AudioModel {
  readonly driver: SoundDriver;
  readonly cd: CdDrive;
  /** Vblanks since the start (the trace's `vs` added up). */
  private vblanks = 0;
  /** The running program's sound addresses (set by its `init`). */
  private t: SoundAddresses = PAZLE_SOUND;

  constructor(
    vab: Vab,
    /** The machine's memory: settings and the running program's tables, where the callback sets the watchdog flag. */
    private readonly m: Mem,
    disc: Disc,
  ) {
    this.driver = new SoundDriver(vab, m);
    this.cd = new CdDrive(disc, m);
  }

  /** One tick: its sound calls, then `vblanks` vblanks (the trace's `vs`; 1 when playing live). */
  step(calls: SoundCall[], vblanks = 1): TickSound {
    const start = this.vblanks * CYCLES_PER_VBLANK;
    this.vblanks += vblanks;
    const sample = this.vblanks * CYCLES_PER_VBLANK + SAMPLE;
    const out: TickSound = { kon: [], koff: [], writes: [], cd: [], cdr: [], cdEvents: [], cycle: sample };
    let at = vblanks > 1 ? start + (vblanks - 1) * CYCLES_PER_VBLANK + LONG_TICK_CD : start + LOGIC_CD;
    for (const c of calls) {
      switch (c.kind) {
        case 'init':
          this.programStart(out, c.program, start, vblanks);
          break;
        case 'key':
          this.driver.keyOn(c.prog, c.note, c.vol);
          break;
        case 'play':
          this.drain(out, at);
          this.cd.play(c.track, c.mode, at);
          at = this.lastCommand() + 1;
          break;
        case 'restart':
          // The watchdog runs in the main loop's tail, right after the previous sample; CdReset
          // blocks until the drive has re-initialised, then the commands follow.
          this.drain(out, start + SAMPLE);
          this.cd.restart(start + SAMPLE, at);
          this.drain(out, at);
          at = this.lastCommand() + 1;
          break;
        case 'cdvol':
          this.drain(out, at);
          this.driver.setCdVolume(out, c.vol, at);
          break;
        case 'mono':
          this.driver.libsnd.mono = c.mono;
          out.mono = { mono: c.mono, cycle: at };
          break;
      }
    }
    for (let i = 0; i < vblanks; i++) this.driver.vblankFlush(out);
    this.drain(out, sample);
    return out;
  }

  /**
   * A program's start (`init`, its first tick): CdInit, then its sound set-up at the start of
   * the tick (the load), with its own tables.
   */
  private programStart(out: TickSound, program: string, cycle: number, vblanks: number): void {
    const t = PROGRAM_SOUND[program] ?? PAZLE_SOUND;
    this.t = t;
    this.drain(out, cycle);
    this.cd.programStart(cycle, t.tracks);
    const mono = (this.m.u8(SETTING_4FC) & 1) !== 0;
    this.driver.programStart(out, {
      pitchTable: t.pitchTable,
      mono,
      historyIndex: (((FIRST_SAMPLE_FLUSHES[program] ?? 13) - vblanks) % 16 + 16) % 16,
      cdVolume: this.m.s16(t.musicVol + 2 * this.m.u8(MUSIC_VOLUME)),
      cycle,
    });
    out.mono = { mono, cycle };
  }

  /** Runs the drive up to `cycle` and takes its events into the tick. */
  private drain(out: TickSound, cycle: number): void {
    this.cd.run(cycle);
    // The drive logs commands as they are sent, which can be ahead of the sectors it plays first.
    const ready = this.cd.events.filter((e) => e.cycle < cycle).sort((a, b) => a.cycle - b.cycle);
    this.cd.events.splice(0, this.cd.events.length, ...this.cd.events.filter((e) => e.cycle >= cycle));
    for (const e of ready) {
      out.cdEvents.push(e);
      if (e.kind === 'cd') out.cd.push(e.data);
      else if (e.kind === 'cdr') out.cdr.push(e.data);
      else if (e.kind === 'vol') this.driver.setCdVolume(out, 0, e.cycle);
      else if (e.kind === 'flag') this.m.w32(this.t.cdFlag, 1);
    }
  }

  private lastCommand(): number {
    let last = 0;
    for (const e of this.cd.events) if (e.kind === 'cd') last = Math.max(last, e.cycle);
    return last;
  }

  /** The trace's `spu` and `rev` fields now. */
  globals(): number[] {
    return this.driver.globals();
  }

  reverb(): number[] {
    return this.driver.reverb();
  }
}
