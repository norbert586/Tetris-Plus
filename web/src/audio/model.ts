// The game's sound, tick by tick (docs/re/audio.md §5, §11): the running program's sound calls
// (core SoundCall) run through libsnd and the SPU registers (driver.ts) and the CD drive (cd.ts)
// on one clock, CPU cycles since the first tick, so the result can be compared with the
// original's trace (kon, koff, spu, rev, cd, cdr) and played (player.ts). The SPU and the drive
// carry over from one program to the next, as on the console; each program's own sound set-up
// runs on its first tick (`step`'s `start`).
//
// The clock: tick t ends with its sample, 45,519 cycles into the vblank that closes it; its logic
// starts right after the previous tick's sample, so the program's CD commands start about 50,000
// cycles into that tick's first vblank. Key-ons wait for the flush in the next vblank's interrupt.
import { MUSIC_VOLUME, SETTING_4FC } from '../core/addr';
import type { Mem } from '../core/mem';
import type { SoundCall } from '../core/sound';
import { PAZLE_PUZZLE_ROUTE, soundTables, type ProgramAudio } from './programs';
import { CdDrive, type CdEvent, type Disc } from './cd';
import { CYCLES_PER_VBLANK, SoundDriver, type TickAudio } from './driver';
import type { Vab } from './vab';

/** Where in a vblank the trace's sample is taken, and where the logic's first CD command lands. */
const SAMPLE = 45_519;
const LOGIC_CD = 49_700;
/** In a tick that runs over several vblanks (loading a screen), the calls come at its end. */
const LONG_TICK_CD = -36_400;
/**
 * From the last sample of a program to the moment the boot program's loader stops the CD for the
 * next program's files (FUN_80096604's VSync(60), then the loader's first read; fitted to the
 * reports the trace's loading ticks hold).
 */
export const EXIT_CD_STOP = 64 * CYCLES_PER_VBLANK;

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

  /** The running program's addresses. */
  program: ProgramAudio;
  /** The programs' sound tables at their addresses (programs.ts); settings come from `m`. */
  private readonly tables = soundTables();

  /**
   * `m`: the RAM the running program runs in (the settings are read from there).
   * `program`: the first program (default Puzzle Mode as the "puzzle" route starts it, with the
   * head at the start of the disc); a program from `PROGRAM_AUDIO` starts with the head where
   * loading it left it.
   */
  constructor(
    vab: Vab,
    private readonly m: Mem,
    disc: Disc,
    opts: { program?: ProgramAudio; mono?: boolean } = {},
  ) {
    this.program = opts.program ?? PAZLE_PUZZLE_ROUTE;
    const mono = opts.mono ?? (m.u8(SETTING_4FC) & 1) !== 0;
    this.driver = new SoundDriver(vab, this.tables, mono, this.program.pitchTable);
    this.cd = new CdDrive(disc, this.tables, this.program.loadEnd);
    this.cd.trackTable = this.program.trackTable;
  }

  /** The CD volume the music volume setting gives (SsSetSerialVol in the sound set-up). */
  private musicVolume(): number {
    return this.tables.s16(this.program.musicVolume + 2 * this.m.u8(MUSIC_VOLUME));
  }

  /**
   * One tick: its sound calls, then `vblanks` vblanks (the trace's `vs`; 1 when playing live).
   * `start`: this is the first tick of another program, loaded since the last tick: the drive
   * plays on until the loader stops it, then the new program's sound set-up runs.
   */
  step(calls: SoundCall[], vblanks = 1, start?: ProgramAudio): TickSound {
    const begin = this.vblanks * CYCLES_PER_VBLANK;
    this.vblanks += vblanks;
    const sample = this.vblanks * CYCLES_PER_VBLANK + SAMPLE;
    const out: TickSound = { kon: [], koff: [], writes: [], cd: [], cdr: [], cdEvents: [], cycle: sample };
    const first = start ?? (this.booted ? undefined : this.program);
    let at = vblanks <= 1 ? begin + LOGIC_CD
      : first?.firstCd !== undefined ? sample - first.firstCd
        : begin + (vblanks - 1) * CYCLES_PER_VBLANK + LONG_TICK_CD;
    if (start && this.booted) {
      // The previous program's last sample was at begin + SAMPLE. Live (one vblank), it all
      // happens before this tick's logic.
      const stop = Math.min(begin + SAMPLE + (this.program.exitCdStop ?? EXIT_CD_STOP), at - 2);
      this.drain(out, stop);
      this.cd.load(stop, start.loadEnd, start.trackTable);
      this.program = start;
      const boot = this.driver.boot(this.musicVolume(), {
        cycle: at - 1,
        historyIndex: start.historyAtSample === undefined ? undefined : (start.historyAtSample - vblanks) & 15,
        restart: { program: start, mono: (this.m.u8(SETTING_4FC) & 1) !== 0 },
      });
      out.koff.push(...boot.koff);
      out.writes.push(...boot.writes);
    } else if (!this.booted) {
      if (start && start !== this.program) {
        this.program = start;
        this.cd.load(begin, start.loadEnd, start.trackTable);
      }
      const h = this.program.historyAtSample;
      const boot = this.driver.boot(this.musicVolume(), {
        historyIndex: h === undefined ? undefined : (h - vblanks) & 15,
        restart: start ? { program: start, mono: (this.m.u8(SETTING_4FC) & 1) !== 0 } : undefined,
      });
      out.koff.push(...boot.koff);
      out.writes.push(...boot.writes);
    }
    this.booted = true;
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
