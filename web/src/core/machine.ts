// The boot program (SLUS_003.38) as the port runs it (docs/re/static-bootstrap.md §5,
// docs/re/shell.md §6): one program at a time on the shared memory; when a program exits, the
// one it named in state+0x48 starts. The loading itself (CD reads, "Now Loading") is not
// reproduced; boot_settle's clearing of the players' screen words is.
import * as A from './addr';
import { BOOT_STATE_BASE64, BOOT_STATE_OFFSET } from './boot-state';
import { CardSlots } from './card';
import { Game, NotPorted } from './game';
import { decodeBase64, Mem } from './mem';
import type { Program, ProgramContext } from './program';
import { Ranking } from './programs/ranking/ranking';
import { Select } from './programs/select/select';
import { SwOn } from './programs/sw_on/sw_on';
import { TitDemo } from './programs/tit_demo/tit_demo';
import { Title } from './programs/title/title';
import { Rng } from './rng';
import { POWER_ON_STATE } from './power-on';

/** Program numbers (state+0x48) and names (docs/re/static-bootstrap.md §5). */
export const PROGRAM_NAMES = [
  'JLOGO', 'SW_ON', 'TIT_DEMO', 'TITLE', 'HOW_N', 'HOW_P', 'HOW_VS', 'RANKING', 'SELECT', 'NOMAL', 'PAZLE', 'VSPUZ', 'EDIT',
];

export type AnyProgram = Game | Program;

/**
 * rand() calls the boot program makes while it loads a program (its own main loop calls rand()
 * once a frame), by "FROM>TO", measured on the original (docs/re/shell.md §6). The loading isn't
 * shown, but its random numbers are used, so the port's sequence stays the original's.
 */
export const LOADER_RAND: Record<string, number> = {
  'SW_ON>TIT_DEMO': 200,
  'TIT_DEMO>TITLE': 260,
  'TITLE>SELECT': 214,
  'SELECT>PAZLE': 414,
  'PAZLE>RANKING': 194,
  'RANKING>TIT_DEMO': 200,
};

/**
 * The attract demos TITLE starts after 1,800 idle frames (HOW_N, then HOW_VS the next time) are
 * not ported (they play the other modes). What each leaves, measured on the original (movie
 * attract, docs/re/shell.md §6): the frames it and the loads around it take, its rand() calls
 * (TITLE's last one included), the shared words it writes, and RANKING as the next program.
 */
export const DEMO_STAND_IN: Record<number, { frames: number; rand: number; words: [number, number][] }> = {
  4: { frames: 6835, rand: 20850, words: [[0x18, 50], [0x20, 19], [0x24, 4], [0x58, 102], [0x4b540, 1]] },
  6: { frames: 2980, rand: 3433, words: [[0x18, 50], [0x20, -11], [0x24, 5], [0x58, 102], [0x4b540, 0]] },
};

export interface MachineOptions {
  /** Global frame counter when the first program starts. */
  counter: number;
  /** BIOS rand() seed when the first program starts. */
  seed: number;
  cards?: CardSlots;
  /** The first program (default PAZLE, 10). */
  first?: number;
  difficulty?: number;
}

export class Machine {
  readonly ctx: ProgramContext;
  program: AnyProgram;

  constructor(opts: MachineOptions) {
    const m = new Mem();
    const first = opts.first ?? 10;
    if (first === 10) {
      // Puzzle Mode first: the block as the menus leave it (boot-state.ts).
      m.bytes.set(decodeBase64(BOOT_STATE_BASE64), (A.S + BOOT_STATE_OFFSET) & 0x1fffff);
    } else {
      // From power-on: the block as SW_ON.EXE finds it (power-on.ts).
      for (const [off, b64] of POWER_ON_STATE) m.bytes.set(decodeBase64(b64), (A.S + off) & 0x1fffff);
    }
    if (opts.difficulty !== undefined) m.w8(A.DIFFICULTY, opts.difficulty);
    m.w32(A.COUNTER, opts.counter);
    m.w32(A.PHASE, 0);
    m.w32(A.SUBPHASE, 0);
    this.ctx = { m, rng: new Rng(opts.seed), cards: opts.cards ?? new CardSlots() };
    this.program = this.load(first);
  }

  get m(): Mem {
    return this.ctx.m;
  }

  /**
   * The program that state+0x48 names: the exiting program's main loop finishes its iteration
   * (one more rand()), the boot program loads the next (its rand() calls) and boot_settle
   * clears the players' screen words.
   */
  next(): AnyProgram {
    const m = this.m;
    const demo = DEMO_STAND_IN[m.s32(A.NEXT_PROGRAM)];
    if (demo) {
      for (let i = 0; i < demo.rand; i++) this.ctx.rng.next();
      m.add32(A.COUNTER, demo.frames);
      for (const [off, v] of demo.words) m.w32(A.S + off, v);
      m.w32(A.NEXT_PROGRAM, 7);
      m.w32(A.NEXT_PARAM, 0);
      m.w32(A.PHASE, 0);
      m.w32(A.SUBPHASE, 0);
      m.fill(A.SCREEN, 0x4b538 - 0x4b508);
      m.w32(A.EXIT_FLAG, 0);
      this.program = this.load(7);
      return this.program;
    }
    const from = this.program.name;
    const to = PROGRAM_NAMES[m.s32(A.NEXT_PROGRAM)];
    this.ctx.rng.next();
    for (let i = LOADER_RAND[`${from}>${to}`] ?? 0; i > 0; i--) this.ctx.rng.next();
    m.fill(A.SCREEN, 0x4b538 - 0x4b508);
    m.w32(A.EXIT_FLAG, 0);
    this.program = this.load(m.s32(A.NEXT_PROGRAM));
    return this.program;
  }

  private load(n: number): AnyProgram {
    switch (n) {
      case 1:
        return new SwOn(this.ctx);
      case 2:
        return new TitDemo(this.ctx);
      case 3:
        return new Title(this.ctx);
      case 7:
        return new Ranking(this.ctx);
      case 8:
        return new Select(this.ctx);
      case 10:
        return new Game({ counter: 0, seed: 0, ctx: this.ctx });
      default:
        throw new NotPorted(`program ${n} (${PROGRAM_NAMES[n] ?? '?'})`);
    }
  }
}
