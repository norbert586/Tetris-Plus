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
}

export class Console {
  readonly shared: Shared;
  program: Program;
  /** Programs started so far, in order (for tests and the shell). */
  readonly started: ProgramName[] = [];

  constructor(
    private readonly factories: Partial<Record<ProgramName, ProgramFactory>>,
    opts: ConsoleOptions = {},
  ) {
    const m = new Mem(opts.ram ?? new Uint8Array(0x200000));
    if (!opts.ram) for (const r of POWER_STATE) m.bytes.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
    this.shared = { m, rng: new Rng(opts.seed ?? 0), cards: opts.cards ?? new MemoryCards() };
    this.program = this.start(opts.first ?? 'SW_ON', !opts.ram);
  }

  get m(): Mem {
    return this.shared.m;
  }

  /** One main-loop iteration; first starts the next program if the last one has exited. */
  step(pad: number): void {
    if (this.program.exited) this.startNext();
    this.program.step(pad);
  }

  /**
   * Starts the program the last one named. `seed`: the BIOS seed its main finds (a replay
   * injects the original's, which depends on the skipped loading frames).
   */
  startNext(seed?: number): void {
    if (seed !== undefined) this.shared.rng.seed = seed >>> 0;
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
}
