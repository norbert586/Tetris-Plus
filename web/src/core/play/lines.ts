// Line clears and score (docs/spec/lines.md).
import * as A from '../addr';
import type { Game } from '../game';
import { objectClear } from '../objects';
import { sePlay } from '../sound';
import * as V from '../vars';
import { scoreDraw, stageClock } from './hud';
import { BOARD_OBJ } from './objects';
import { cellAddr } from './stage';

const SCRATCH_A = A.S + 0x18;
const SCRATCH_C = A.S + 0x20;
const FLASH_SCALE = 0x800946e0; // (x, y) per clear-animation frame
const SCORE_TABLE = 0x800d61c8; // LEVELS[0]: lock, then the score per lines cleared
const PUSHBACK = 0x80094388; // int[5] by lines cleared (index 0 unused)
const FLASH_OBJ = 0xde; // 4 objects: the full rows' flashes
const POPUP_OBJ = 0x131;
const POPUP_TIMER = 0x78; // object word used as the pop-up's timer

const fullRow = (g: Game, i: number) => V.FULL_ROWS + g.p * 0x14 + 4 * i;

/** lines_find_full (docs/spec/lines.md §1); returns the OR of the five flags. */
export function linesFindFull(g: Game): number {
  const m = g.m;
  const top = m.s32(g.pv(V.LOCK_TOP_ROW));
  for (let i = 0; i < 5; i++) m.w32(fullRow(g, i), 1);
  for (let i = 0; i < 5; i++) {
    const row = top + 4 - i;
    m.w32(SCRATCH_A, row);
    if ((row - 1) >>> 0 < 0xf) {
      for (let c = 0; c < 10; c++) if (m.s32(cellAddr(g, row * 10 + c)) === 0) m.w32(fullRow(g, i), 0);
    } else {
      m.w32(fullRow(g, i), 0);
    }
  }
  m.w32(SCRATCH_A, top - 1);
  let any = 0;
  for (let i = 0; i < 5; i++) any |= m.s32(fullRow(g, i));
  return any;
}

/** Step 2, play_line_check */
export function playLineCheck(g: Game): void {
  const m = g.m;
  if (m.s32(g.pv(V.LINES_FOUND)) === 0) {
    m.w32(g.pv(A.STEP), 5);
  } else {
    m.w32(g.pv(V.CLEAR_ANIM_STATE), 0);
    m.w32(g.pv(V.CLEAR_ANIM_FRAME), 0);
    let n = 0;
    for (let i = 0; i < 5; i++) n += m.s32(fullRow(g, i));
    m.w32(g.pv(V.LINES_THIS_CLEAR), n);
    sePlay(g, n + 0x2b);
    m.add32(g.pv(A.STEP), 1);
  }
  stageClock(g);
}

/** FUN_800ACF84: resets the full rows' cell objects to their positions. */
function fullRowObjectsReset(g: Game): void {
  const m = g.m;
  let row = m.s32(g.pv(V.LOCK_TOP_ROW)) + 4;
  m.w32(SCRATCH_A, row);
  for (let i = 0; i < 5; i++) {
    if (m.s32(fullRow(g, i)) !== 0) {
      for (let c = row * 10; c < row * 10 + 10; c++) {
        const n = c + g.ob + BOARD_OBJ;
        objectClear(g, n);
        const o = A.obj(n);
        m.w32(o + A.O_X, (c % 10) * 0xa0000);
        m.w32(o + A.O_Y, Math.trunc(c / 10) * 0xa0000);
        m.w32(o + A.O_PLAYER, g.p);
        m.w32(o + A.O_20, 1);
      }
    }
    row--;
    m.w32(SCRATCH_A, row);
  }
}

/** clear_anim_start; returns false (not done). */
function clearAnimStart(g: Game): boolean {
  const m = g.m;
  for (let i = 0; i < 4; i++) objectClear(g, g.ob + FLASH_OBJ + i);
  let n = 0;
  const top = m.s32(g.pv(V.LOCK_TOP_ROW));
  for (let i = 0; i < 5; i++) {
    if (m.s32(fullRow(g, i)) === 0) continue;
    const o = A.obj(n + g.ob + FLASH_OBJ);
    m.w32(o + A.O_X, 0);
    m.w32(o + A.O_Y, (top - (i - 4)) * 0xa0000);
    m.w32(o + A.O_IMAGE, 0x1000c);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    n++;
  }
  fullRowObjectsReset(g);
  m.w32(g.pv(V.CLEAR_ANIM_FRAME), 0);
  m.add32(g.pv(V.CLEAR_ANIM_STATE), 1);
  return false;
}

/** clear_anim_tick: 8 frames, advancing only on even frame counters (lines.md §2). */
function clearAnimTick(g: Game): boolean {
  const m = g.m;
  const frame = m.s32(g.pv(V.CLEAR_ANIM_FRAME));
  if (frame < 8) {
    if ((g.counter & 1) === 0) {
      for (let i = 0; i < 4; i++) {
        const o = A.obj(i + g.ob + FLASH_OBJ);
        if (m.s32(o + A.O_IMAGE) !== 0) {
          m.w32(o + A.O_SCALE_X, m.s32(FLASH_SCALE + frame * 8) << 5);
          m.w32(o + A.O_SCALE_Y, m.s32(FLASH_SCALE + frame * 8 + 4) << 5);
        }
      }
      m.add32(g.pv(V.CLEAR_ANIM_FRAME), 1);
    }
    return false;
  }
  for (let i = 0; i < 4; i++) objectClear(g, g.ob + FLASH_OBJ + i);
  return true;
}

/** Step 3, play_clear_anim */
export function playClearAnim(g: Game): void {
  const state = g.m.s32(g.pv(V.CLEAR_ANIM_STATE));
  const done = state === 0 ? clearAnimStart(g) : state === 1 ? clearAnimTick(g) : false;
  if (done) g.m.add32(g.pv(A.STEP), 1);
  stageClock(g);
}

/** lines_clear_cells */
function linesClearCells(g: Game): void {
  const m = g.m;
  let row = m.s32(g.pv(V.LOCK_TOP_ROW)) + 4;
  for (let i = 0; i < 5; i++) {
    if (m.s32(fullRow(g, i)) !== 0) for (let c = 0; c < 10; c++) m.w32(cellAddr(g, row * 10 + c), 0);
    row--;
  }
  m.w32(SCRATCH_A, row);
}

/** Moves cell `src`'s block and object to `dst`; src < 0 empties dst. */
function moveCell(g: Game, dst: number, src: number): void {
  const m = g.m;
  const od = A.obj(g.ob + BOARD_OBJ + dst);
  if (src < 0) {
    m.w32(cellAddr(g, dst), 0);
    m.w32(od + A.O_PLAYER, g.p);
    m.w32(od + A.O_20, 1);
    m.w32(od + A.O_IMAGE, 0);
    return;
  }
  const os = A.obj(g.ob + BOARD_OBJ + src);
  m.w32(cellAddr(g, dst), m.s32(cellAddr(g, src)));
  m.w32(od + A.O_PLAYER, m.s32(os + A.O_PLAYER));
  m.w32(od + A.O_20, m.s32(os + A.O_20));
  m.w32(od + A.O_IMAGE, m.s32(os + A.O_IMAGE));
}

/** lines_collapse: compacts the five grid rows (docs/spec/lines.md §4, first pass). */
function linesCollapse(g: Game): void {
  const m = g.m;
  m.w32(A.OBJ_BASE, g.p * 400);
  fullRowObjectsReset(g);
  m.w32(g.pv(V.LINES_CLEARED), 0);
  const top = m.s32(g.pv(V.LOCK_TOP_ROW));
  let dst = top + 4;
  for (let i = 0; i < 5; i++) {
    if (m.s32(fullRow(g, i)) === 1) {
      m.add32(g.pv(V.LINES_CLEARED), 1);
      continue;
    }
    const src = (top - (i - 4)) * 10;
    for (let c = 0; c < 10; c++) moveCell(g, dst * 10 + c, src < 0xb ? -1 : src + c);
    m.w32(SCRATCH_C, dst * 10 + 10);
    m.w32(SCRATCH_A, src + 10);
    dst--;
  }
  m.w32(g.pv(V.LINES_FOR_PROFESSOR), m.s32(g.pv(V.LINES_CLEARED)));
}

/** lines_remove: the first pass, then everything above falls (second pass). */
function linesRemove(g: Game): void {
  const m = g.m;
  m.w32(A.OBJ_BASE, g.p * 400);
  linesCollapse(g);
  const n = m.s32(g.pv(V.LINES_CLEARED));
  const top = m.s32(g.pv(V.LOCK_TOP_ROW));
  if (n === 0 || top <= 0) return;
  let d = (top + n) * 10 - 1;
  let s = top * 10 - 1;
  m.w32(SCRATCH_A, d);
  m.w32(SCRATCH_C, s);
  if (d <= 0x1d) return;
  do {
    if (s < 10) {
      moveCell(g, d, -1);
    } else {
      moveCell(g, d, s);
      moveCell(g, s, -1);
    }
    s--;
    d--;
    m.w32(SCRATCH_A, d);
    m.w32(SCRATCH_C, s);
  } while (d > 0x1d);
}

/** score_add_lines: 100/400/800/1600, capped at 9,999,999. */
function scoreAddLines(g: Game): void {
  const m = g.m;
  const s = m.s32(g.pv(V.SCORE)) + m.s32(SCORE_TABLE + m.s32(g.pv(V.LINES_CLEARED)) * 4);
  m.w32(g.pv(V.SCORE), s > 9999999 ? 9999999 : s);
}

/** Step 4, play_collapse */
export function playCollapse(g: Game): void {
  const m = g.m;
  linesClearCells(g);
  linesRemove(g);
  scoreAddLines(g);
  scoreDraw(g);
  m.w32(g.pv(V.CEILING_PUSHBACK), m.s32(PUSHBACK + 4 * m.s32(g.pv(V.LINES_CLEARED))));
  m.add32(g.pv(A.STEP), 1);
  sePlay(g, 0xd);
  stageClock(g);
}

/** Step 5, play_next */
export function playNext(g: Game): void {
  const m = g.m;
  m.w32(g.pv(0x800f35f4), 10);
  m.w32(g.pv(V.LINES_FOUND), 0);
  m.w32(g.pv(A.STEP), 0);
  stageClock(g);
}

/** lines_popup_dispatch: the "3 LINES" / "4 LINES" pop-up; 1 or 2 lines reset at once. */
export function linesPopup(g: Game): void {
  const m = g.m;
  const lines = m.s32(g.pv(V.LINES_THIS_CLEAR));
  if (lines < 3) {
    m.w32(g.pv(V.LINES_THIS_CLEAR), 0);
    m.w32(g.pv(V.POPUP_STATE), 0);
    return;
  }
  const image = lines === 3 ? 0x10024 : 0x10025;
  const o = A.obj(g.ob + POPUP_OBJ);
  switch (m.s32(g.pv(V.POPUP_STATE))) {
    case 0:
      m.w32(o + A.O_IMAGE, image);
      m.w32(o + A.O_X, 0);
      m.w32(o + A.O_Y, 0x1e0000);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, lines === 3 ? 1 : g.p);
      m.w32(o + POPUP_TIMER, 0x3c);
      m.add32(g.pv(V.POPUP_STATE), 1);
      return;
    case 1:
      if (m.add32(o + POPUP_TIMER, -1) < 0x1f) m.add32(g.pv(V.POPUP_STATE), 1);
      else m.add32(o + A.O_Y, -0x8000);
      if (m.s32(o + POPUP_TIMER) === 0x32) sePlay(g, 0x17);
      return;
    case 2:
      if (m.add32(o + POPUP_TIMER, -1) === 0) {
        objectClear(g, g.ob + POPUP_OBJ);
        m.w32(g.pv(V.LINES_THIS_CLEAR), 0);
        m.w32(g.pv(V.POPUP_STATE), 0);
      } else {
        m.w32(o + A.O_IMAGE, (g.counter & 1) * image);
        m.add32(o + A.O_Y, -0x8000);
      }
      return;
  }
}
