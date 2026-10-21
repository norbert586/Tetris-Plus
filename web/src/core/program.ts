// What every program the boot program runs has in common (docs/re/shell.md §5): the main loop
// (logic, draw, pad read, the CD watchdog, rand() once a frame, the soft-reset check), the
// shared state block, the sprite objects, and the per-tick events the renderer, the audio layer
// and the trace take. PAZLE.EXE is game.ts; the others extend this class.
import * as A from './addr';
import type { CardSlots } from './card';
import type { Mem, Rom } from './mem';
import type { Rng } from './rng';
import { PROGRAM_SOUND, bgmRequest, cdWatchdog, sePlay, soundInit, type SoundAddresses, type SoundCall } from './sound';
import type { Box } from './objects';

export interface ProgramContext {
  m: Mem;
  rng: Rng;
  cards: CardSlots;
}

export abstract class Program {
  abstract readonly name: string;
  readonly m: Mem;
  readonly rng: Rng;
  readonly cards: CardSlots;
  se: number[] = [];
  bgm: number[] = [];
  sound: SoundCall[] = [];
  uploads: number[] = [];
  boxes: { box: Box; pri: number }[] = [];
  boxColors: number[] = [];
  /** Ticks run so far; tick 1 is the main loop's first iteration. */
  tick = 0;
  /** Vblanks this tick waited for beyond its own (VSync(n) in the logic): the picture holds. */
  stall = 0;

  /**
   * Loads the program as the boot program does: its data at its addresses over zeroed program
   * memory up to the end of its BSS; the shared state block stays.
   */
  constructor(ctx: ProgramContext, rom: Rom, bssEnd: number) {
    this.m = ctx.m;
    this.rng = ctx.rng;
    this.cards = ctx.cards;
    this.m.fill(0x80094000, bssEnd - 0x80094000);
    this.m.loadRom(rom);
  }

  /** The program's copy of the sound code's tables and variables (sound.ts). */
  get soundAddresses(): SoundAddresses {
    return PROGRAM_SOUND[this.name];
  }

  /** The side se_play and bgm_request act for (always 0 outside Puzzle Mode). */
  get p(): number {
    const a = this.soundAddresses.player;
    return a ? this.m.s32(a) : 0;
  }

  /** se_play(id) (the program's copy). */
  protected sePlay(id: number): void {
    sePlay(this, id, this.soundAddresses);
  }

  /** bgm_request(id) (the program's copy). */
  protected bgmRequest(id: number): void {
    bgmRequest(this, id, this.soundAddresses);
  }

  /**
   * The sound set-up main runs before its loop (CdInit and the program's sound init): the
   * first step's first calls.
   */
  protected soundInit(): void {
    soundInit(this, this.soundAddresses);
  }

  /** The main loop tail's CD watchdog (bgm_poll). */
  protected cdWatchdog(): boolean {
    return cdWatchdog(this, this.soundAddresses);
  }

  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  get counter(): number {
    return this.m.u32(A.COUNTER);
  }

  rand(): number {
    return this.rng.next();
  }

  /** The pad words (held at `held`, newly pressed at held + 2; pad 2 six bytes later). */
  protected padRead(held: number, word: number): void {
    const m = this.m;
    for (let p = 0; p < 2; p++) {
      const now = (word >>> (16 * p)) & 0xffff;
      const a = held + 6 * p;
      m.w16(a + 2, (m.u16(a) ^ now) & now);
      m.w16(a, now);
    }
  }

  /** The soft-reset check: Start+Select held over 120 frames on either pad returns to the title. */
  protected softResetCheck(held: number, counters: number): void {
    const m = this.m;
    const c1 = (m.u16(held) & 0x900) === 0x900 ? m.s32(counters) + 1 : 0;
    const c2 = (m.u16(held + 6) & 0x900) === 0x900 ? m.s32(counters + 4) + 1 : 0;
    m.w32(counters, c1);
    m.w32(counters + 4, c2);
    if (c1 > 0x78 || c2 > 0x78) {
      m.w32(counters, 0);
      m.w32(counters + 4, 0);
      this.exitTo(3, 0, 9);
      m.fill(A.SCREEN, 0x4b538 - 0x4b508);
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

  /** Clears the per-tick events; called at the start of each step (the first also sets up the sound). */
  protected beginTick(): void {
    this.se = [];
    this.bgm = [];
    this.sound = [];
    this.uploads = [];
    this.boxes = [];
    this.boxColors = [];
    this.stall = 0;
    this.rng.calls = 0;
    if (this.tick === 0) this.soundInit();
  }

  /** Runs one logic tick with the pad word (pad 1 low, pad 2 high). */
  abstract step(pad: number): void;

  /** The trace row for the current tick (re/lua/programs.lua's fields). */
  abstract traceRow(): Record<string, number | number[] | string>;
}
