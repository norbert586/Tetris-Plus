// One Puzzle Mode program: the main loop of PAZLE.EXE (pazle_main, docs/spec/frame.md §1) and
// the phase and screen dispatchers (docs/re/static-bootstrap.md §4). Game state lives in a
// model of main RAM at the original's addresses (mem.ts, addr.ts).
import * as A from './addr';
import { BOOT_STATE_BASE64, BOOT_STATE_OFFSET } from './boot-state';
import { decodeBase64, Mem } from './mem';
import { Rng } from './rng';
import { SCREENS } from './screens';
import { pauseCheck } from './pause';
import { objectsClearAll, objectsDraw, uploadQueueFlush, type Box } from './objects';
import { traceRow } from './trace';
import type { SoundCall } from './sound';
import { MemoryCards } from '../flow/memcard';

export interface GameOptions {
  /** Global frame counter when pazle_main starts (it carries over from earlier programs). */
  counter: number;
  /** BIOS rand() seed when pazle_main starts. */
  seed: number;
  /** Ceiling speed setting, 0-3 (default 1). */
  difficulty?: number;
  /** Start from this RAM image instead of a fresh program (debugging aid: emulator dumps). */
  ram?: Uint8Array;
  /**
   * Run inside the whole game (src/flow/console.ts): this RAM and rand(), with the shared state
   * block as earlier programs left it. PAZLE.EXE's data is loaded and its BSS cleared, as the
   * boot program's loader and `start` do; `counter` and `seed` are then ignored.
   */
  shared?: { m: Mem; rng: Rng; cards?: MemoryCards };
  /** The memory cards (default: a formatted empty card in slot 1, slot 2 empty). */
  cards?: MemoryCards;
}

/** PAZLE.EXE's BSS, cleared by `start` (docs/re/static-bootstrap.md §1). */
const PAZLE_BSS = 0x800ed800;
const PAZLE_BSS_END = 0x800f3704;

/** Thrown when the original reaches code the port doesn't have. */
export class NotPorted extends Error {}

export class Game {
  readonly name = 'PAZLE' as const;
  m: Mem;
  rng: Rng;
  /** Sound effects started this tick (se_play arguments). */
  se: number[] = [];
  /** Music requested this tick (bgm_request arguments). */
  bgm: number[] = [];
  /** Sound library and CD calls this tick, for the audio layer (sound.ts SoundCall). */
  sound: SoundCall[] = [];
  /**
   * Image uploads this tick, for the renderer and the trace (`up`): item + 0x10000 * player,
   * plus 0x100000 for the ones queued for the end of the frame (objects.ts itemLoad, itemQueue).
   */
  uploads: number[] = [];
  /** Box fills drawn this tick outside objects_draw (GsSortBoxFill calls during the logic). */
  boxes: { box: Box; pri: number }[] = [];
  /** The rand() colours objects_draw gave this tick's box-fill objects: r, g, b per object. */
  boxColors: number[] = [];
  /** Ticks run so far; tick 1 is the main loop's first iteration. */
  tick = 0;
  /** The memory cards (the save screen and the menu's Continue; card.ts). */
  readonly cards: MemoryCards;
  /** Set when the program leaves Puzzle Mode (exit flag). */
  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  constructor(opts: GameOptions) {
    this.cards = opts.shared?.cards ?? opts.cards ?? new MemoryCards();
    if (opts.shared) {
      this.rng = opts.shared.rng;
      this.m = opts.shared.m;
      this.m.loadRom();
      this.m.fill(PAZLE_BSS, PAZLE_BSS_END - PAZLE_BSS);
      this.startup();
      return;
    }
    this.rng = new Rng(opts.seed);
    if (opts.ram) {
      this.m = new Mem(opts.ram);
      return;
    }
    this.m = new Mem();
    const boot = decodeBase64(BOOT_STATE_BASE64);
    this.m.bytes.set(boot, (A.S + BOOT_STATE_OFFSET) & 0x1fffff);
    if (opts.difficulty !== undefined) this.m.w8(A.DIFFICULTY, opts.difficulty);
    this.m.w32(A.COUNTER, opts.counter);
    this.m.w32(A.PHASE, 0);
    this.m.w32(A.SUBPHASE, 0);
    this.startup();
  }

  /** pazle_main before its loop: globals_init's zeroes are the fresh BSS; pad_init. */
  private startup(): void {
    const m = this.m;
    m.w32(A.EXIT_FLAG, 0);
    m.w32(0x800ed348, 1);
    m.w32(0x800ed34c, 0);
  }

  // ---- helpers used throughout the port ----

  /** Current player (0x800EEAD0). */
  get p(): number {
    return this.m.s32(A.PLAYER);
  }
  /** Player p's first sprite object (0x800EE410: 0 or 400). */
  get ob(): number {
    return this.m.s32(A.OBJ_BASE);
  }
  /** Address of the current player's word in a per-player int array. */
  pv(addr: number): number {
    return addr + 4 * this.p;
  }
  /** Current player's held / newly pressed pad bits. */
  held(): number {
    return this.m.u16(A.PAD_HELD + 6 * this.p);
  }
  pressed(): number {
    return this.m.u16(A.PAD_PRESSED + 6 * this.p);
  }
  get counter(): number {
    return this.m.u32(A.COUNTER);
  }
  rand(): number {
    return this.rng.next();
  }

  // ---- the main loop ----

  /**
   * Runs one logic tick with the pad word (pad 1 low, pad 2 high) the logic of this tick sees.
   * The previous iteration's tail (pad_read, bgm_poll, rand, soft_reset_check) runs first,
   * which is where the tracer samples (docs/re/oracle-harness.md §3).
   */
  step(pad: number): void {
    const m = this.m;
    this.se = [];
    this.bgm = [];
    this.sound = [];
    this.uploads = [];
    this.boxes = [];
    this.boxColors = [];
    this.rng.calls = 0;
    if (this.tick > 0) {
      this.padRead(pad);
      this.rand();
      this.softResetCheck();
      if (this.exited) return;
    }
    this.tick++;
    m.add32(A.COUNTER, 1);
    this.phaseDispatch();
    objectsDraw(this);
    uploadQueueFlush(this);
  }

  private padRead(word: number): void {
    const m = this.m;
    for (let p = 0; p < 2; p++) {
      const now = (word >>> (16 * p)) & 0xffff;
      const a = A.PAD_HELD + 6 * p;
      m.w16(a + 2, (m.u16(a) ^ now) & now);
      m.w16(a, now);
    }
  }

  private softResetCheck(): void {
    const m = this.m;
    const c1 = (m.u16(A.PAD_HELD) & 0x900) === 0x900 ? m.s32(0x800e2674) + 1 : 0;
    const c2 = (m.u16(A.PAD_HELD + 6) & 0x900) === 0x900 ? m.s32(0x800e2678) + 1 : 0;
    m.w32(0x800e2674, c1);
    m.w32(0x800e2678, c2);
    if (c1 > 0x78 || c2 > 0x78) {
      m.w32(0x800e2674, 0);
      m.w32(0x800e2678, 0);
      this.exitTo(3, 0, 9);
      for (let p = 0; p < 2; p++) {
        m.w32(A.SCREEN + 4 * p, 0);
        m.w32(A.STEP + 4 * p, 0);
        m.w32(A.SUBSTEP + 4 * p, 0);
        m.w32(A.STEP4 + 4 * p, 0);
      }
      m.fill(A.S + 0x4b528, 16);
    }
  }

  /** Ends the program and names the next one for the boot loader. */
  exitTo(program: number, param: number, phase: number): void {
    const m = this.m;
    m.w32(A.EXIT_FLAG, 1);
    m.w32(A.NEXT_PROGRAM, program);
    m.w32(A.NEXT_PARAM, param);
    m.w32(A.PHASE, phase);
    m.w32(A.SUBPHASE, 0);
  }

  private phaseDispatch(): void {
    switch (this.m.s32(A.PHASE)) {
      case 0:
        if (this.m.s32(A.SUBPHASE) === 0) this.phase0Setup();
        return;
      case 1:
        this.phase1Players();
        return;
      default:
        return;
    }
  }

  /** phase0_setup: player 1 on the menu, player 2 idle. */
  private phase0Setup(): void {
    const m = this.m;
    objectsClearAll(this);
    m.w32(0x800eebb4, 0);
    m.w32(0x800eebb0, 0); // zone
    m.w32(0x800eeb08, 0);
    m.w32(0x800eeb04, 0); // stage
    m.w32(A.SCREEN, 0);
    m.w32(A.SCREEN + 4, 8);
    for (const a of [A.STEP, A.SUBSTEP, A.STEP4]) {
      m.w32(a, 0);
      m.w32(a + 4, 0);
    }
    const o = A.obj(870);
    m.w32(o + A.O_IMAGE, 0x101f6);
    m.w32(o + A.O_X, 0x9c0000);
    m.w32(o + A.O_SCALE_X, 0x40);
    m.w32(o + A.O_Y, 0x80000);
    m.w32(o + A.O_PLAYER, 0);
    m.w32(o + A.O_20, 0);
    m.w32(0x800eea0c, 0);
    m.w32(0x800ee9e8, 0);
    m.w32(A.SUBPHASE, 0);
    m.add32(A.PHASE, 1);
  }

  private phase1Players(): void {
    const m = this.m;
    for (let p = 0; p < 2; p++) {
      m.w32(A.PLAYER, p);
      m.w32(A.OBJ_BASE, p * 400);
      this.screenDispatch();
      pauseCheck(this);
    }
    const s1 = m.s32(A.SCREEN);
    const s2 = m.s32(A.SCREEN + 4);
    m.w32(A.TWO_PLAYER, s1 === 8 || s2 === 8 ? 0 : 1);
    if (s1 === 8 && s2 === 8) this.exitTo(7, 0, 0);
  }

  screenDispatch(): void {
    const screen = this.m.s32(this.pv(A.SCREEN));
    const fn = SCREENS[screen];
    if (!fn) throw new NotPorted(`screen ${screen}`);
    fn(this);
  }

  /** The trace row for the current tick, in re/lua/trace_fields.lua's field names. */
  traceRow() {
    return traceRow(this);
  }
}
