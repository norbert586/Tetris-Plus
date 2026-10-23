// The whole game: the boot program's loop around the mode programs (docs/re/flow.md;
// SLUS_003.38's boot_dispatch, docs/re/static-bootstrap.md §5). One `step` is one main-loop
// iteration of the running program. When a program sets the exit flag, the next one named in
// state+0x48 is started at once: the port doesn't reproduce loading (docs/RESEARCH_AND_PLAN.md
// §9), so the boot program's own frames, and the rand() calls it makes in them, are skipped.
import * as A from '../core/addr';
import { decodeBase64, Mem } from '../core/mem';
import { Rng } from '../core/rng';
import { MemoryCards } from './memcard';
import { POWER_STATE } from './power-state';
import { runStandIn, STAND_INS } from './stand-ins';
import { PROGRAM_NAMES, type Program, type ProgramFactory, type ProgramName, type Shared } from './program';

export interface ConsoleOptions {
  /** The BIOS rand() seed when the first program starts (power-on: loading times decide it). */
  seed?: number;
  /** The first program (default SW_ON, after the Jaleco logo, which the shell plays as video). */
  first?: ProgramName;
  /** Start from this RAM image (an emulator dump at the first program's main) instead of power-on. */
  ram?: Uint8Array;
  /** The memory cards (default: a formatted empty card in slot 1, slot 2 empty, kept in memory). */
  cards?: MemoryCards;
  /** The browser's mode select: Puzzle, Option and Stats (Shared.browserMenu). */
  browserMenu?: boolean;
  /**
   * Resume this program from `ram` (a saved game, src/flow/snapshot.ts) at this tick, instead of
   * starting one: `seed` is the rand() seed it had. Only a program whose factory can resume (it
   * then starts with this tick) is accepted.
   */
  resume?: { program: ProgramName; tick: number };
}

/** The pad buttons that leave the ranking screen when it was opened from Stats: Start, Cross, Circle. */
const STATS_LEAVE = 0x800 | 0x40 | 0x20;
const PRG_SELECT = 8;

export class Console {
  readonly shared: Shared;
  program: Program;
  /** The last pad word (for the Stats visit's button presses). */
  private lastPad = 0;
  /** Programs started so far, in order (for tests and the shell). */
  readonly started: ProgramName[] = [];

  constructor(
    private readonly factories: Partial<Record<ProgramName, ProgramFactory>>,
    opts: ConsoleOptions = {},
  ) {
    const m = new Mem(opts.ram ?? new Uint8Array(0x200000));
    if (!opts.ram) for (const r of POWER_STATE) m.bytes.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
    this.shared = {
      m,
      rng: new Rng(opts.seed ?? 0),
      cards: opts.cards ?? new MemoryCards(),
      browserMenu: opts.browserMenu,
    };
    this.program = opts.resume ? this.resume(opts.resume.program, opts.resume.tick) : this.start(opts.first ?? 'SW_ON', !opts.ram);
  }

  get m(): Mem {
    return this.shared.m;
  }

  /** One main-loop iteration; first starts the next program if the last one has exited. */
  step(pad: number): void {
    if (this.program.exited) this.startNext();
    if (this.shared.statsVisit && this.program.name === 'RANKING' && this.program.tick > 0 && pad & ~this.lastPad & STATS_LEAVE) {
      // Leaving the ranking screen opened from Stats with a button (it has no input of its own).
      this.m.w32(A.EXIT_FLAG, 1);
      this.startNext();
    }
    this.lastPad = pad;
    this.program.step(pad);
  }

  /**
   * Starts the program the last one named. `seed`: the BIOS seed its main finds (a replay
   * injects the original's, which depends on the skipped loading frames).
   */
  startNext(seed?: number): void {
    if (seed !== undefined) this.shared.rng.seed = seed >>> 0;
    if (this.shared.statsVisit && this.program.name === 'RANKING') {
      // The ranking screen opened from Stats goes back to the mode select: at its end it names
      // TIT_DEMO, and left with a button it still names itself. A soft reset still goes to TITLE.
      this.shared.statsVisit = false;
      if (this.next !== 'TITLE') {
        this.m.w32(A.NEXT_PROGRAM, PRG_SELECT);
        this.m.w32(A.NEXT_PARAM, 0);
        this.m.w32(A.PHASE, 0);
        this.m.w32(A.SUBPHASE, 0);
      }
    }
    this.program = this.start(this.next);
  }

  /** The name of the program that runs next if the current one has exited. */
  get next(): ProgramName {
    return PROGRAM_NAMES[this.m.s32(A.NEXT_PROGRAM)];
  }

  private start(name: ProgramName, settle = true): Program {
    // Programs the port skips (stand-ins.ts) run to their end at once, as boot_settle and
    // the stand-in leave the state, and the program they name starts instead.
    for (let s = STAND_INS[name]; s && !this.factories[name]; s = STAND_INS[name]) {
      if (settle) this.m.fill(A.S + 0x4b508, 0x4b538 - 0x4b508);
      this.started.push(name);
      runStandIn(this.m, s);
      name = this.next;
    }
    const factory = this.factories[name];
    if (!factory) throw new Error(`program ${name} is not ported`);
    // boot_settle (0x80024C2C): both players' screen, step and sub-step words are cleared.
    if (settle) this.m.fill(A.S + 0x4b508, 0x4b538 - 0x4b508);
    this.started.push(name);
    return factory(this.shared);
  }

  /** Makes `name` carry on from the RAM already in place (a saved game). */
  private resume(name: ProgramName, tick: number): Program {
    const factory = this.factories[name];
    if (!factory) throw new Error(`program ${name} is not ported`);
    const p = factory(this.shared, { tick });
    if (p.tick !== tick) throw new Error(`program ${name} can't resume a saved game`);
    this.started.push(name);
    return p;
  }
}
