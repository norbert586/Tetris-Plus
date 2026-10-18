// RANKING.EXE (program 7): the two ranking tables of the attract loop (docs/re/ranking.md).
// One main-loop iteration of its main (0x800956C0) per `step`, state at the original's
// addresses in the shared RAM. Its param (state+0x4C) picks the mode: 0 shows the tables (the
// only one any program names), 1 leaves for TIT_DEMO at once, 2 and 3 do nothing.
import * as A from '../../core/addr';
import { decodeBase64, type Mem } from '../../core/mem';
import type { Rng } from '../../core/rng';
import type { SoundCall } from '../../core/sound';
import type { Program, Shared } from '../../flow/program';
import { ROM } from './rom';

/** Thrown when the original would reach code the port doesn't have. */
export class NotPorted extends Error {}

// RANKING.EXE's BSS (cleared by `start`, 0x80097900) and the globals in it.
const BSS = 0x800b24fc;
const BSS_END = 0x800b5300;
export const STATE_PTR = 0x800b2524; // the state block's address, as main keeps it
const RESET_COUNT = 0x800b24e4; // [2] ticks Start + Select held, per pad
export const WAIT = 0x800b2534; // phase 5: ticks the tables have been shown
const OFF_X = 0x800b2538; // phase 3: the x offset of the row being built (16.16)
const OFF_Y = 0x800b253c;
export const ACTIVE_BUFF = 0x800b25c8; // GsGetActiveBuff this tick
const PAD = 0x800b52ec; // 8 x 6 bytes; pad 1 held +2, pressed +4; pad 2 held +8, pressed +10
export const PAD_HELD = PAD + 2;
export const PAD_PRESSED = PAD + 4;
export const PAD2_HELD = PAD + 8;
export const PAD2_PRESSED = PAD + 10;

// Data (rom.ts).
const POW10 = 0x80094010; // s32[8]: 1, 10, ... 10,000,000
const ZONE_MARK = 0x80094050; // s32[6]: the zone mark's image for a record's zone byte
const TITLE_OBJECTS = 0x800ac330; // 3 x {image, x, y}: the heading and the two table titles
const ROW_HEADERS = 0x800ac354; // 2 tables x 5 rows x {image, x, y}: the rank numbers
const LAYOUTS = 0x800ac3cc; // layouts of 0x54 bytes: 7 x {image, x, y} per column kind
const ROW_LAYOUT = 0x800ac4c8; // s32[2][5]: the layout of each row
const SLIDE_OBJECTS = 0x800b24ec; // s32[4]: the titles (21, 22) and the tables' first objects (100, 260)

// Records in the shared state block: 2 tables x 5 entries x 12 bytes.
export const RECORDS = A.S + 0x4ae60;
const RECORDS_PUZZLE = A.S + 0x4ae9c;
const BLANK = 0x1f; // a name letter that isn't drawn

const PRG_TIT_DEMO = 2;
const PRG_TITLE = 3;

let romImage: { address: number; bytes: Uint8Array }[] | null = null;
function romRanges() {
  romImage ??= ROM.map((r) => ({ address: r.address, bytes: decodeBase64(r.base64) }));
  return romImage;
}

export class Ranking implements Program {
  readonly name = 'RANKING' as const;
  readonly m: Mem;
  readonly rng: Rng;
  tick = 0;
  uploads: number[] = [];
  /** RANKING makes no sound calls in its loop (its sound init is the audio layer's boot). */
  sound: SoundCall[] = [];

  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  constructor(shared: Shared) {
    this.m = shared.m;
    this.rng = shared.rng;
    const m = this.m;
    // The boot program's loader puts the image at 0x80094000; `start` clears the BSS.
    m.loadImage(romRanges());
    m.fill(BSS, BSS_END - BSS);
    // main (0x800956C0) before its loop.
    m.w32(STATE_PTR, A.S);
    // FUN_8009586C: the ordering-table headers (GsOT: length 11, the tags in the state block).
    m.w32(0x800b25d8, 0xb);
    m.w32(0x800b25ec, 0xb);
    m.w32(0x800b25dc, A.S + 0x26c74);
    m.w32(0x800b25f0, A.S + 0x28c74);
    // FUN_800954EC, the sound init: the VAB's id (SsVabOpenHead's first: 0) in the state block,
    // and bgm_request's bookkeeping (nothing playing: 0x34).
    m.w16(A.S + 0x1fd34, 0);
    m.w32(0x800b254c, 0);
    m.w32(0x800b2550, 0x34);
    m.w32(0x800b2554, 0x34);
    m.w32(0x800b2558, 0x34);
    // FUN_80095B44: SetSemiTrans on a primitive in the state block (its code byte |= 2), then
    // the sprite templates from RANKINGE.BIN (drawing: the renderer builds them from the pack).
    m.w8(A.S + 0x4a92b, m.u8(A.S + 0x4a92b) | 2);
    m.w32(A.EXIT_FLAG, 0);
  }

  /**
   * One main-loop iteration with the pad word (pad 1 low, pad 2 high) this tick's logic sees.
   * The previous iteration's tail (pad read, the CD poll, rand(), the soft-reset check) runs
   * first: the tracer samples right after the main loop's PadRead.
   */
  step(pad: number): void {
    const m = this.m;
    this.sound = [];
    this.uploads = [];
    this.rng.calls = 0;
    if (this.tick > 0) {
      this.tail(pad);
      if (this.exited) return;
    }
    this.tick++;
    m.add32(A.COUNTER, 1);
    m.w32(ACTIVE_BUFF, (this.tick - 1) & 1);
    this.paramDispatch();
  }

  /** The end of the previous iteration: FUN_80094B54, FUN_80094F64, rand(), FUN_8009640C. */
  tail(pad: number): void {
    this.padRead(pad);
    // FUN_80094F64 polls the CD player's error flag, which only its music calls set: none here.
    this.rng.next();
    this.softResetCheck();
  }

  /** FUN_80094B54 */
  private padRead(word: number): void {
    const m = this.m;
    const p1 = word & 0xffff;
    const p2 = (word >>> 16) & 0xffff;
    m.w16(PAD_PRESSED, (m.u16(PAD_HELD) ^ p1) & p1);
    m.w16(PAD_HELD, p1);
    m.w16(PAD2_PRESSED, (m.u16(PAD2_HELD) ^ p2) & p2);
    m.w16(PAD2_HELD, p2);
  }

  /** FUN_8009640C: Start + Select held on either pad for over 120 ticks goes to the title. */
  private softResetCheck(): void {
    const m = this.m;
    const c1 = (m.u16(PAD_HELD) & 0x900) === 0x900 ? m.s32(RESET_COUNT) + 1 : 0;
    const c2 = (m.u16(PAD2_HELD) & 0x900) === 0x900 ? m.s32(RESET_COUNT + 4) + 1 : 0;
    m.w32(RESET_COUNT, c1);
    m.w32(RESET_COUNT + 4, c2);
    if (c1 > 0x78 || c2 > 0x78) {
      m.w32(RESET_COUNT, 0);
      m.w32(RESET_COUNT + 4, 0);
      this.exitTo(PRG_TITLE, 9);
      m.fill(A.S + 0x4b508, 0x4b538 - 0x4b508);
    }
  }

  /** Ends the program, naming the next one (param 0). */
  private exitTo(program: number, phase: number): void {
    const m = this.m;
    m.w32(A.EXIT_FLAG, 1);
    m.w32(A.NEXT_PROGRAM, program);
    m.w32(A.NEXT_PARAM, 0);
    m.w32(A.PHASE, phase);
    m.w32(A.SUBPHASE, 0);
  }

  /** FUN_80096840: the table at 0x80094000 by param. */
  private paramDispatch(): void {
    const param = this.m.s32(A.NEXT_PARAM);
    switch (param) {
      case 0:
        this.phaseDispatch();
        return;
      case 1: // FUN_800968C8
        this.exitTo(PRG_TIT_DEMO, 0);
        return;
      case 2: // FUN_800968F4, FUN_800968FC: empty
      case 3:
        return;
      default:
        throw new NotPorted(`RANKING param ${param}`);
    }
  }

  /** FUN_80096DB0: the table at 0x80094030 by phase. */
  private phaseDispatch(): void {
    const m = this.m;
    const phase = m.s32(A.PHASE);
    switch (phase) {
      case 0:
        return this.phase0Clear();
      case 1:
        return this.phase1Titles();
      case 2:
        return this.phase2Drop();
      case 3:
        return this.phase3Tables();
      case 4:
        return this.phase4Slide();
      case 5: // FUN_80097878: show the tables for 300 ticks
        if (m.add32(WAIT, 1) > 299) m.add32(A.PHASE, 1);
        return;
      case 6: // FUN_800978B4
        this.exitTo(PRG_TIT_DEMO, 0);
        return;
      case 7: // FUN_800978E0 (never reached: phase 6 leaves)
        m.w32(A.PHASE, 0);
        m.w32(A.SUBPHASE, 0);
        m.add32(A.NEXT_PARAM, 1);
        return;
      default:
        throw new NotPorted(`RANKING phase ${phase}`);
    }
  }

  /** FUN_80096E34: every object cleared; the background halves (objects 10, 11). */
  private phase0Clear(): void {
    const m = this.m;
    m.fill(A.obj(0), A.OBJ_COUNT * A.OBJ_SIZE);
    m.w32(0x800b2530, 0);
    m.w32(0x800b252c, 0);
    m.w32(A.obj(11) + A.O_IMAGE, 0x10002);
    m.w32(0x800b2528, 0);
    m.w32(WAIT, 0);
    m.w32(A.obj(10) + A.O_IMAGE, 0x10001);
    m.w32(A.obj(10) + A.O_X, 0);
    m.w32(A.obj(10) + A.O_Y, 0x80000);
    m.w32(A.obj(11) + A.O_X, 0xa00000);
    m.w32(A.obj(11) + A.O_Y, 0x80000);
    m.add32(A.PHASE, 1);
  }

  /** FUN_80096EA4: the heading above the screen, the two titles off its sides. */
  private phase1Titles(): void {
    const m = this.m;
    const t = (i: number) => m.s32(TITLE_OBJECTS + 4 * i);
    const o20 = A.obj(20);
    const o21 = A.obj(21);
    const o22 = A.obj(22);
    m.w32(o20 + A.O_IMAGE, t(0));
    m.w32(o20 + A.O_X, t(1));
    m.w32(o20 + A.O_VY, 0x10000);
    m.w32(o20 + A.O_VX, 0);
    m.w32(o20 + A.O_Y, t(2) - 0x400000);
    m.w32(o21 + A.O_IMAGE, t(3));
    m.w32(o21 + A.O_X, t(4) - 0xa00000);
    m.w32(o21 + A.O_VX, 0x50000);
    m.w32(o21 + A.O_VY, 0);
    m.w32(o21 + A.O_Y, t(5));
    m.w32(o22 + A.O_IMAGE, t(6));
    m.w32(o22 + A.O_X, t(7) + 0xa00000);
    m.w32(o22 + A.O_VX, -0x50000);
    m.w32(o22 + A.O_VY, 0);
    m.add32(A.PHASE, 1);
    m.w32(o22 + A.O_Y, t(8));
  }

  /** FUN_80096F70: the heading comes down 1 pixel a tick. */
  private phase2Drop(): void {
    const m = this.m;
    const o = A.obj(20);
    const y = m.add32(o + A.O_Y, m.s32(o + A.O_VY));
    if (m.s32(TITLE_OBJECTS + 8) <= y) m.add32(A.PHASE, 1);
  }

  /**
   * FUN_80096FBC: both tables, each row 40 pixels further out than the one above. Table 1
   * (Classic: name, score, lines, level) starts 200 pixels left of its place, table 2 (Puzzle:
   * name, score, stage, zone) 200 pixels right.
   */
  private phase3Tables(): void {
    const m = this.m;
    m.w32(OFF_X, -0xc80000);
    m.w32(OFF_Y, 0);
    for (let i = 0; i < 5; i++) {
      const hx = m.s32(ROW_HEADERS + 12 * i + 4);
      const hy = m.s32(ROW_HEADERS + 12 * i + 8);
      const head = A.obj(100 + 32 * i);
      m.w32(head + A.O_IMAGE, m.s32(ROW_HEADERS + 12 * i));
      m.w32(head + A.O_X, hx + m.s32(OFF_X));
      m.w32(head + A.O_Y, hy + m.s32(OFF_Y));
      this.letters(100, 3, i, 0, 0, 3, 8);
      const L = LAYOUTS + 0x54 * m.s32(ROW_LAYOUT + 4 * i);
      const rec = RECORDS + 12 * i;
      this.digits(m.s32(rec + 4), 7, 0x6a + 32 * i, m.s32(L + 0x10) + hx + m.s32(OFF_X), m.s32(L + 0x14) + hy + m.s32(OFF_Y), m.s32(L + 0x0c), 0x80000);
      this.column(100, 0xd, i, 2, 0, 0);
      this.column(100, 0x10, i, 3, 0, 0);
      this.digits(m.s16(rec + 8), 3, 0x79 + 32 * i, m.s32(L + 0x34) + hx + m.s32(OFF_X), m.s32(L + 0x38) + hy + m.s32(OFF_Y), m.s32(L + 0x30), 0x80000);
      this.column(100, 0x18, i, 5, 0, 0);
      this.digits(m.s8(rec + 10), 2, 0x81 + 32 * i, m.s32(L + 0x4c) + hx + m.s32(OFF_X), m.s32(L + 0x50) + hy + m.s32(OFF_Y), m.s32(L + 0x48), 0x80000);
      m.add32(OFF_X, -0x280000);
    }
    m.w32(OFF_X, 0xc80000);
    m.w32(OFF_Y, 0);
    for (let i = 0; i < 5; i++) {
      const hx = m.s32(ROW_HEADERS + 60 + 12 * i + 4);
      const hy = m.s32(ROW_HEADERS + 60 + 12 * i + 8);
      const head = A.obj(260 + 32 * i);
      m.w32(head + A.O_IMAGE, m.s32(ROW_HEADERS + 60 + 12 * i));
      m.w32(head + A.O_X, hx + m.s32(OFF_X));
      m.w32(head + A.O_Y, hy + m.s32(OFF_Y));
      this.letters(0x104, 3, i, 0, 1, 3, 8);
      const L = LAYOUTS + 0x54 * m.s32(ROW_LAYOUT + 20 + 4 * i);
      const rec = RECORDS_PUZZLE + 12 * i;
      this.digits(m.s32(rec + 4), 7, 0x10a + 32 * i, m.s32(L + 0x10) + hx + m.s32(OFF_X), m.s32(L + 0x14) + hy + m.s32(OFF_Y), m.s32(L + 0x0c), 0x80000);
      this.column(0x104, 0xd, i, 2, 0, 1);
      const zone = m.s8(rec + 9);
      if (zone !== 5) {
        // The stage within the zone (zone 5 is the 100-stage mode: no stage shown).
        this.column(0x104, 0x10, i, 3, 0, 1);
        const stage = (((m.s8(rec + 8) % 20) << 24) >> 24) + 1;
        this.digits(stage, 3, 0x119 + 32 * i, m.s32(L + 0x34) + hx + m.s32(OFF_X), m.s32(L + 0x38) + hy + m.s32(OFF_Y), m.s32(L + 0x30), 0x80000);
      }
      if (zone < 0 || zone > 5) throw new NotPorted(`RANKING: zone byte ${zone} reads the stack`);
      this.column(0x104, 0x18, i, 5, m.s32(ZONE_MARK + 4 * zone), 1);
      m.add32(OFF_X, 0x280000);
    }
    m.add32(A.PHASE, 1);
  }

  /**
   * FUN_80096904: object base + 32 * row + col shows column kind k of the row's layout (image
   * + add) at the layout's offset from the row's rank number, if the layout has that column.
   */
  private column(base: number, col: number, row: number, k: number, add: number, table: number): void {
    const m = this.m;
    const L = LAYOUTS + 0x54 * m.s32(ROW_LAYOUT + 4 * (table * 5 + row)) + 12 * k;
    const image = m.s32(L);
    if (image === 0) return;
    const o = A.obj(base + row * 32 + col);
    const h = ROW_HEADERS + 4 * (table * 15 + row * 3);
    m.w32(o + A.O_IMAGE, add + image);
    m.w32(o + A.O_X, m.s32(L + 4) + m.s32(h + 4) + m.s32(OFF_X));
    m.w32(o + A.O_Y, m.s32(L + 8) + m.s32(h + 8) + m.s32(OFF_Y));
  }

  /** FUN_80096A54: the name's letters (0x1F: blank), `step` pixels apart. */
  private letters(base: number, col: number, row: number, k: number, table: number, count: number, step: number): void {
    const m = this.m;
    for (let i = 0; i < count; i++) {
      const at = table === 0 ? RECORDS : table === 1 ? RECORDS_PUZZLE : 0;
      if (at) {
        const c = m.u8(at + row * 12 + i);
        if (c !== BLANK) this.column(base, col + i, row, k, c, table);
      }
      m.add32(A.obj(base + row * 32 + col + i) + A.O_X, Math.imul(step * 0x10000, i));
    }
  }

  /**
   * FUN_80096BDC: `value` in `count` digit objects from `first` (cleared first), leading zeros
   * left out (the last digit always shown), each digit `stepX` further right; the digits used
   * are packed from `first`. imageBase 0 draws nothing.
   */
  private digits(value: number, count: number, first: number, x: number, y: number, imageBase: number, stepX: number): void {
    const m = this.m;
    for (let i = 0; i < count; i++) m.fill(A.obj(first + i), A.OBJ_SIZE);
    if (imageBase === 0) return;
    let started = false;
    let o = first;
    for (let d = count; d > 0; d--) {
      const pow = m.s32(POW10 + 4 * (d - 1));
      const q = (value / pow) | 0;
      if (q !== 0 || started || d === 1) {
        const a = A.obj(o);
        m.w32(a + A.O_IMAGE, q + imageBase);
        m.w32(a + A.O_X, x);
        m.w32(a + A.O_PLAYER, 0);
        m.w32(a + A.O_20, 0);
        m.w32(a + A.O_Y, y);
        started = true;
        o++;
        value = value % pow | 0;
      }
      x = (x + stepX) | 0;
    }
  }

  /** FUN_800976D0: the titles and the rows slide in 5 pixels a tick until the last rows are in. */
  private phase4Slide(): void {
    const m = this.m;
    for (let k = 0; k < 2; k++) {
      const title = A.obj(m.s32(SLIDE_OBJECTS + 4 * k));
      if (m.s32(title + A.O_X) !== m.s32(TITLE_OBJECTS + 12 + 12 * k + 4)) m.add32(title + A.O_X, m.s32(title + A.O_VX));
      const first = m.s32(SLIDE_OBJECTS + 8 + 4 * k);
      for (let r = 0; r < 5; r++) {
        if (m.s32(A.obj(first + 32 * r) + A.O_X) === m.s32(ROW_HEADERS + 60 * k + 12 * r + 4)) continue;
        for (let j = 0; j < 32; j++) m.add32(A.obj(first + 32 * r + j) + A.O_X, m.s32(title + A.O_VX));
      }
    }
    if (m.s32(ROW_HEADERS + 48 + 4) <= m.s32(A.obj(228) + A.O_X) && m.s32(A.obj(388) + A.O_X) <= m.s32(ROW_HEADERS + 60 + 48 + 4)) {
      m.add32(A.PHASE, 1);
    }
  }

  /** The trace row (re/lua/fields/RANKING.lua). */
  traceRow(): Record<string, number | number[]> {
    const m = this.m;
    const arr = (a: number, n: number, stride: number, read: (x: number) => number) => Array.from({ length: n }, (_, i) => read(a + i * stride));
    const s32 = (x: number) => m.s32(x);
    return {
      ctr: m.u32(A.COUNTER),
      seed: this.rng.seed,
      next: m.u32(A.NEXT_PROGRAM),
      param: m.u32(A.NEXT_PARAM),
      phase: m.u32(A.PHASE),
      subphase: m.u32(A.SUBPHASE),
      exit: m.u32(A.EXIT_FLAG),
      scr: arr(A.S + 0x4b508, 2, 4, (x) => m.u32(x)),
      step: arr(A.S + 0x4b510, 2, 4, (x) => m.u32(x)),
      pad: m.u16(PAD_HELD),
      padp: m.u16(PAD_PRESSED),
      pad2: m.u16(PAD2_HELD),
      padp2: m.u16(PAD2_PRESSED),
      reset: arr(RESET_COUNT, 2, 4, s32),
      wait: m.s32(WAIT),
      off: arr(OFF_X, 2, 4, s32),
      buf: m.s32(ACTIVE_BUFF),
      rec: arr(RECORDS, 30, 4, (x) => m.u32(x)),
      oimg: arr(A.obj(0) + A.O_IMAGE, 420, A.OBJ_SIZE, s32),
      ox: arr(A.obj(0) + A.O_X, 420, A.OBJ_SIZE, s32),
      oy: arr(A.obj(0) + A.O_Y, 420, A.OBJ_SIZE, s32),
      ovx: arr(A.obj(0) + A.O_VX, 32, A.OBJ_SIZE, s32),
      rand: this.rng.calls,
    };
  }
}
