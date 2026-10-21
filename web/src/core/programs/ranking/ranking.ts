// RANKING.EXE: the rankings Puzzle Mode (and the other modes) exit to (docs/re/shell.md §7).
// Two panels drop in, the Classic and Puzzle tables are built from the shared state block and
// slide in from the sides, hold for 300 frames, and the program starts TIT_DEMO. No input but
// the soft reset, no sound. Ported from the decompile of RANKING.EXE (main 0x800956C0).
import * as A from '../../addr';
import { objectClear, objectsClearAll } from '../../objects';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800b5300;
const PAD = 0x800b52ee; // P1 held; pressed +2; P2 +6
const RESET = 0x800b24e4; // [2] soft-reset counters
const STEP_A = 0x800b2528; // gp+0x4C..0x5C: step counters (cleared at init and by sub-step 0)
const STEP_B = 0x800b252c;
const STEP_C = 0x800b2530;
const HOLD = 0x800b2534; // frames the finished tables have shown
const PANEL_X = 0x800b2538; // 16.16 offsets the table builder adds
const PANEL_Y = 0x800b253c;
const PANEL_OBJECTS = 0x800b24ec; // [4] the two titles' objects, the two tables' first objects
const RANKING_CLASSIC = A.S + 0x4ae60; // 5 x 12 bytes: name glyphs[3], ?, score, lines (s16), level (s8)
const RANKING_PUZZLE = A.S + 0x4ae9c; // 5 x 12 bytes: name glyphs[3], ?, score, stage (s8), zone (s8)

// Tables in RANKING.EXE's data.
const TITLES = 0x800ac330; // the three panels: image, x, y (16.16)
const ROW_POS = 0x800ac354; // per table and row: image, x, y (12 bytes; Puzzle from 0x800AC390)
const LAYOUTS = 0x800ac3cc; // per layout (0x54 bytes), per column: image base, dx, dy
const ROW_LAYOUT = 0x800ac4c8; // [2][5] the layout of each table's rows
const POWERS = 0x80094010; // 1, 10, ... 10^7
const ZONE_IMAGE = 0x80094050; // [6] image offset by zone

const FIELDS: Field[] = [
  ...commonFields(PAD),
  ['vars', STEP_A, 's32', 6],
  ['reset', RESET, 's32', 2],
];

const obj = A.obj;

export class Ranking extends Program {
  readonly name = 'RANKING';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    const m = this.m;
    // main before its loop: FUN_80095950 (the step counters), the pad words, the exit flag.
    m.fill(STEP_A, 24);
    m.fill(0x800b52ec, 8 * 6);
    m.w32(A.EXIT_FLAG, 0);
  }

  step(pad: number): void {
    this.beginTick();
    if (this.tick > 0) {
      this.padRead(PAD, pad);
      this.cdWatchdog(); // FUN_80094F64 (nothing plays here, so its flag stays clear)
      this.rand();
      this.softResetCheck(PAD, RESET);
      if (this.exited) return;
    }
    this.tick++;
    this.m.add32(A.COUNTER, 1);
    this.logic();
  }

  traceRow() {
    return readFields(this, FIELDS);
  }

  /** FUN_80096840: the top machine on state+0x4C. */
  private logic(): void {
    switch (this.m.s32(A.NEXT_PARAM)) {
      case 0:
        this.show();
        return;
      case 1:
        this.exitTo(2, 0, 0); // FUN_800968C8 (unreachable: step 0 exits itself)
        return;
      default:
        return;
    }
  }

  /** FUN_80096DB0: the sub-machine on state+0x50. */
  private show(): void {
    const m = this.m;
    switch (m.s32(A.PHASE)) {
      case 0: {
        // FUN_80096E34: the two header banners.
        objectsClearAll(this);
        m.w32(STEP_C, 0);
        m.w32(STEP_B, 0);
        m.w32(obj(11) + A.O_IMAGE, 0x10002);
        m.w32(STEP_A, 0);
        m.w32(HOLD, 0);
        m.w32(obj(10) + A.O_IMAGE, 0x10001);
        m.w32(obj(10) + A.O_X, 0);
        m.w32(obj(10) + A.O_Y, 0x80000);
        m.w32(obj(11) + A.O_X, 0xa00000);
        m.w32(obj(11) + A.O_Y, 0x80000);
        m.add32(A.PHASE, 1);
        return;
      }
      case 1: {
        // FUN_80096EA4: the three panels; 20 drops in, 21 and 22 come from the sides.
        const r = (i: number) => m.s32(TITLES + 4 * i);
        m.w32(obj(20) + A.O_IMAGE, r(0));
        m.w32(obj(20) + A.O_X, r(1));
        m.w32(obj(20) + A.O_VY, 0x10000);
        m.w32(obj(20) + A.O_VX, 0);
        m.w32(obj(20) + A.O_Y, r(2) - 0x400000);
        m.w32(obj(21) + A.O_IMAGE, r(3));
        m.w32(obj(21) + A.O_X, r(4) - 0xa00000);
        m.w32(obj(21) + A.O_VX, 0x50000);
        m.w32(obj(21) + A.O_VY, 0);
        m.w32(obj(21) + A.O_Y, r(5));
        m.w32(obj(22) + A.O_IMAGE, r(6));
        m.w32(obj(22) + A.O_X, r(7) + 0xa00000);
        m.w32(obj(22) + A.O_VX, -0x50000);
        m.w32(obj(22) + A.O_VY, 0);
        m.add32(A.PHASE, 1);
        m.w32(obj(22) + A.O_Y, r(8));
        return;
      }
      case 2: {
        // FUN_80096F70: the top panel drops 1 px a frame into place.
        const y = m.add32(obj(20) + A.O_Y, m.s32(obj(20) + A.O_VY));
        if (m.s32(TITLES + 8) <= y) m.add32(A.PHASE, 1);
        return;
      }
      case 3:
        this.buildTables();
        return;
      case 4:
        this.slideIn();
        return;
      case 5:
        // FUN_80097878: hold for 300 frames.
        if (m.add32(HOLD, 1) > 299) m.add32(A.PHASE, 1);
        return;
      case 6:
        // FUN_800978B4: on to TIT_DEMO.
        this.exitTo(2, 0, 0);
        return;
      case 7:
        // FUN_800978E0 (unreachable)
        m.w32(A.PHASE, 0);
        m.w32(A.SUBPHASE, 0);
        m.add32(A.NEXT_PARAM, 1);
        return;
    }
  }

  /** FUN_80096904: object base + row * 32 + index shows column `col` of a row's layout, image + add. */
  private cell(base: number, index: number, row: number, col: number, add: number, table: number): void {
    const m = this.m;
    const layout = m.s32(ROW_LAYOUT + 4 * (table * 5 + row));
    const rec = LAYOUTS + col * 0xc + layout * 0x54;
    const image = m.s32(rec);
    if (image === 0) return;
    const o = obj(base + row * 0x20 + index);
    m.w32(o + A.O_IMAGE, add + image);
    const k = table * 0xf + row * 3;
    m.w32(o + A.O_X, m.s32(rec + 4) + m.s32(ROW_POS + 4 + 4 * k) + m.s32(PANEL_X));
    m.w32(o + A.O_Y, m.s32(rec + 8) + m.s32(ROW_POS + 8 + 4 * k) + m.s32(PANEL_Y));
  }

  /** FUN_80096A54: a name, `count` glyphs `spacing` px apart (0x1F: no glyph). */
  private name3(base: number, index: number, row: number, col: number, table: number, count: number, spacing: number): void {
    const m = this.m;
    for (let i = 0; i < count; i++) {
      const glyph = m.u8((table === 0 ? RANKING_CLASSIC : RANKING_PUZZLE) + row * 0xc + i);
      if ((table === 0 || table === 1) && glyph !== 0x1f) this.cell(base, index + i, row, col, glyph, table);
      m.add32(obj(base + row * 0x20 + index + i) + A.O_X, Math.imul(spacing * 0x10000, i));
    }
  }

  /**
   * FUN_80096BDC: a number in `digits` digit objects from `first`, x advancing by `step` per
   * digit; leading zeros leave their place empty (the objects that would show them are not used).
   */
  private number(value: number, digits: number, first: number, x: number, y: number, image: number, step: number): void {
    const m = this.m;
    for (let i = 0; i < digits; i++) objectClear(this, first + i);
    if (image === 0) return;
    let started = false;
    let n = first;
    for (let d = digits; d > 0; d--) {
      const p = m.s32(POWERS + 4 * (d - 1));
      if (Math.trunc(value / p) !== 0 || started || d === 1) {
        const o = obj(n);
        m.w32(o + A.O_IMAGE, Math.trunc(value / p) + image);
        m.w32(o + A.O_X, x);
        started = true;
        m.w32(o + A.O_PLAYER, 0);
        m.w32(o + A.O_20, 0);
        m.w32(o + A.O_Y, y);
        n++;
        value %= p;
      }
      x = (x + step) | 0;
    }
  }

  /** FUN_80096FBC: both tables, off-screen to the left (Classic) and right (Puzzle). */
  private buildTables(): void {
    const m = this.m;
    const L = (layout: number, off: number) => m.s32(LAYOUTS + off + layout * 0x54);
    m.w32(PANEL_X, -0xc80000);
    m.w32(PANEL_Y, 0);
    for (let i = 0; i < 5; i++) {
      const px = m.s32(ROW_POS + 4 + 0xc * i);
      const py = m.s32(ROW_POS + 8 + 0xc * i);
      const o = obj(100 + 32 * i);
      m.w32(o + A.O_IMAGE, m.s32(ROW_POS + 0xc * i));
      m.w32(o + A.O_X, px + m.s32(PANEL_X));
      m.w32(o + A.O_Y, py + m.s32(PANEL_Y));
      this.name3(100, 3, i, 0, 0, 3, 8);
      const lay = m.s32(ROW_LAYOUT + 4 * i);
      const row = RANKING_CLASSIC + 0xc * i;
      const dx = () => m.s32(PANEL_X);
      const dy = () => m.s32(PANEL_Y);
      this.number(m.s32(row + 4), 7, 0x6a + 0x20 * i, L(lay, 0x10) + px + dx(), L(lay, 0x14) + py + dy(), L(lay, 0xc), 0x80000);
      this.cell(100, 0xd, i, 2, 0, 0);
      this.cell(100, 0x10, i, 3, 0, 0);
      this.number(m.s16(row + 8), 3, 0x79 + 0x20 * i, L(lay, 0x34) + px + dx(), L(lay, 0x38) + py + dy(), L(lay, 0x30), 0x80000);
      this.cell(100, 0x18, i, 5, 0, 0);
      this.number(m.s8(row + 0xa), 2, 0x81 + 0x20 * i, L(lay, 0x4c) + px + dx(), L(lay, 0x50) + py + dy(), L(lay, 0x48), 0x80000);
      m.add32(PANEL_X, -0x280000);
    }
    m.w32(PANEL_X, 0xc80000);
    m.w32(PANEL_Y, 0);
    for (let i = 0; i < 5; i++) {
      const px = m.s32(ROW_POS + 0x40 + 0xc * i);
      const py = m.s32(ROW_POS + 0x44 + 0xc * i);
      const o = obj(260 + 32 * i);
      m.w32(o + A.O_IMAGE, m.s32(ROW_POS + 0x3c + 0xc * i));
      m.w32(o + A.O_X, px + m.s32(PANEL_X));
      m.w32(o + A.O_Y, py + m.s32(PANEL_Y));
      this.name3(0x104, 3, i, 0, 1, 3, 8);
      const lay = m.s32(ROW_LAYOUT + 0x14 + 4 * i);
      const row = RANKING_PUZZLE + 0xc * i;
      const dx = () => m.s32(PANEL_X);
      const dy = () => m.s32(PANEL_Y);
      this.number(m.s32(row + 4), 7, 0x10a + 0x20 * i, L(lay, 0x10) + px + dx(), L(lay, 0x14) + py + dy(), L(lay, 0xc), 0x80000);
      this.cell(0x104, 0xd, i, 2, 0, 1);
      const zone = m.s8(row + 9);
      if (zone !== 5) {
        this.cell(0x104, 0x10, i, 3, 0, 1);
        const stage = (((m.s8(row + 8) % 0x14) << 24) >> 24) + 1;
        this.number(stage, 3, 0x119 + 0x20 * i, L(lay, 0x34) + px + dx(), L(lay, 0x38) + py + dy(), L(lay, 0x30), 0x80000);
      }
      this.cell(0x104, 0x18, i, 5, m.s32(ZONE_IMAGE + 4 * zone), 1);
      m.add32(PANEL_X, 0x280000);
    }
    m.add32(A.PHASE, 1);
  }

  /** FUN_800976D0: the titles and the rows slide in until in place, then the hold. */
  private slideIn(): void {
    const m = this.m;
    const ids = (k: number) => m.s32(PANEL_OBJECTS + 4 * k);
    for (let k = 0; k < 2; k++) {
      const title = obj(ids(k));
      if (m.s32(title + A.O_X) !== m.s32(TITLES + 0x10 + 0xc * k)) m.add32(title + A.O_X, m.s32(title + A.O_VX));
      for (let r = 0; r < 5; r++) {
        const first = r * 0x20 + ids(k + 2);
        if (m.s32(obj(first) + A.O_X) !== m.s32(ROW_POS + 4 + k * 0x3c + r * 0xc)) {
          for (let j = 0; j < 0x20; j++) m.add32(obj(first + j) + A.O_X, m.s32(title + A.O_VX));
        }
      }
    }
    if (m.s32(0x800ac388) <= m.s32(obj(228) + A.O_X) && m.s32(obj(388) + A.O_X) <= m.s32(0x800ac3c4)) m.add32(A.PHASE, 1);
  }
}
