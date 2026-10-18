// Puzzle Mode's sound, tick by tick (docs/re/audio.md §5): the program's sound calls (core
// SoundCall) run through libsnd and the SPU registers (driver.ts) and the CD drive (cd.ts) on one
// clock, CPU cycles since the first tick, so the result can be compared with the original's trace
// (kon, koff, spu, rev, cd, cdr) and played (player.ts).
//
// The clock: tick t ends with its sample, 45,519 cycles into the vblank that closes it; its logic
// starts right after the previous tick's sample, so the program's CD commands start about 50,000
// cycles into that tick's first vblank. Key-ons wait for the flush in the next vblank's interrupt.
import type { Mem } from '../core/mem';
import type { SoundCall } from '../core/sound';
import { CdDrive, type CdEvent, type Disc } from './cd';
import { CYCLES_PER_VBLANK, SoundDriver, type TickAudio } from './driver';
import type { Vab } from './vab';

/** Where in a vblank the trace's sample is taken, and where the logic's first CD command lands. */
const SAMPLE = 45_519;
const LOGIC_CD = 49_700;
/** In a tick that runs over several vblanks (loading a screen), the calls come at its end. */
const LONG_TICK_CD = -36_400;
/** Where the head rests when Puzzle Mode starts (fitted to the first Play's timing). */
const BOOT_POSITION = 150;

export interface TickSound extends TickAudio {
  /** CD commands (command, then Setloc's or Setmode's bytes) and the callback's reports. */
  cd: number[][];
  cdr: number[][];
  /** Every CD event of the tick with its cycle (sectors included), for the player. */
  cdEvents: CdEvent[];
  /** The cycle of this tick's sample. */
  cycle: number;
}

export class AudioModel {
  readonly driver: SoundDriver;
  readonly cd: CdDrive;
  /** Vblanks since the start (the trace's `vs` added up). */
  private vblanks = 0;
  private booted = false;

  constructor(
    vab: Vab,
    rom: Mem,
    disc: Disc,
    private readonly musicVolume: () => number,
    mono = false,
  ) {
    this.driver = new SoundDriver(vab, rom, mono);
    this.cd = new CdDrive(disc, rom, BOOT_POSITION);
  }

  /** One tick: its sound calls, then `vblanks` vblanks (the trace's `vs`; 1 when playing live). */
  step(calls: SoundCall[], vblanks = 1): TickSound {
    const start = this.vblanks * CYCLES_PER_VBLANK;
    this.vblanks += vblanks;
    const sample = this.vblanks * CYCLES_PER_VBLANK + SAMPLE;
    const out: TickSound = { kon: [], koff: [], writes: [], cd: [], cdr: [], cdEvents: [], cycle: sample };
    if (!this.booted) {
      this.booted = true;
      const boot = this.driver.boot(this.musicVolume());
      out.koff.push(...boot.koff);
      out.writes.push(...boot.writes);
    }
    let at = vblanks > 1 ? start + (vblanks - 1) * CYCLES_PER_VBLANK + LONG_TICK_CD : start + LOGIC_CD;
    for (const c of calls) {
      if (c.kind === 'key') this.driver.keyOn(c.prog, c.note, c.vol);
      else if (c.kind === 'play') {
        this.drain(out, at);
        this.cd.play(c.track, c.mode, at);
        at = this.lastCommand() + 1;
      } else {
        this.drain(out, at);
        this.driver.setCdVolume(out, c.vol, at);
      }
    }
    for (let i = 0; i < vblanks; i++) this.driver.vblankFlush(out);
    this.drain(out, sample);
    return out;
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
