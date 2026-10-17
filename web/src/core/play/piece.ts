// The falling piece and the preview queue (docs/spec/piece.md).
import * as A from '../addr';
import type { Game } from '../game';
import { objectClear } from '../objects';
import { sePlay } from '../sound';
import * as V from '../vars';
import { stageClock } from './hud';
import { linesFindFull } from './lines';
import { BOARD_OBJ } from './objects';
import { BLOCK_IMAGE, cellAddr } from './stage';

const SHAPES = 0x800d5544; // int[8][4][25]
const QUEUE_TABLE = 0x80094720; // int[16]
const NEXT_POS = 0x80094760; // per player: next1 (x, y), next2 (x, y)
const NEXT2_X = 0x800ee508; // [2]
const NEXT2_Y = 0x800ee520; // [2]
const LEVEL_LOCK = 0x800d61c8; // LEVELS[level].lock, stride 0x18
const PIECE_OBJ = 0x118; // 4 objects: the falling piece
const FLASH_OBJ = 0x108; // 4 objects: its flashing outline
/** Scratch words of the shared block the original uses as loop variables. */
const SCRATCH_A = A.S + 0x18;
const SCRATCH_B = A.S + 0x24;

const shapeCell = (g: Game, kind: number, rot: number, i: number) =>
  g.m.s32(SHAPES + kind * 400 + rot * 100 + i * 4);

/** piece_collides (docs/spec/piece.md §6). */
export function pieceCollides(g: Game): boolean {
  const m = g.m;
  const kind = m.s32(g.pv(V.PIECE_KIND));
  const rot = m.s32(g.pv(V.PIECE_ROT));
  let col = Math.trunc((m.s32(g.pv(V.PIECE_X)) >> 16) / 10);
  let row = Math.trunc((m.s32(g.pv(V.PIECE_Y)) >> 16) / 10);
  m.w32(SCRATCH_A, col);
  m.w32(SCRATCH_B, row);
  for (let i = 0, k = 0; i < 25; i++) {
    const solid = shapeCell(g, kind, rot, i);
    if (col >>> 0 < 10 && row < 16) {
      if (solid !== 0 && row >= 0 && m.s32(cellAddr(g, row * 10 + col)) !== 0) return true;
    } else if (solid !== 0) {
      return true;
    }
    col++;
    if (++k === 5) {
      k = 0;
      col -= 5;
      row++;
    }
    m.w32(SCRATCH_A, col);
    m.w32(SCRATCH_B, row);
  }
  return false;
}

/** piece_draw: the piece's four objects. */
export function pieceDraw(g: Game): void {
  const m = g.m;
  const kind = m.s32(g.pv(V.PIECE_KIND));
  const rot = m.s32(g.pv(V.PIECE_ROT));
  let n = 0;
  for (let i = 0; i < 25; i++) {
    if (shapeCell(g, kind, rot, i) === 0) continue;
    const o = A.obj(n + g.ob + PIECE_OBJ);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, kind + 0x10004);
    m.w32(o + A.O_X, (i % 5) * 0xa0000 + m.s32(g.pv(V.PIECE_X)));
    m.w32(o + A.O_Y, Math.trunc(i / 5) * 0xa0000 + m.s32(g.pv(V.PIECE_Y)));
    n++;
  }
}

/** piece_flash_draw: the outline, shown on odd frames while a piece falls. */
export function pieceFlashDraw(g: Game): void {
  const m = g.m;
  const kind = m.s32(g.pv(V.PIECE_KIND));
  if (kind === 0 || (g.counter & 1) === 0) {
    for (let i = 0; i < 4; i++) objectClear(g, g.ob + FLASH_OBJ + i);
    return;
  }
  const rot = m.s32(g.pv(V.PIECE_ROT));
  let n = 0;
  for (let i = 0; i < 25; i++) {
    if (shapeCell(g, kind, rot, i) === 0) continue;
    const o = A.obj(n + g.ob + FLASH_OBJ);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, 0x10021);
    m.w32(o + A.O_X, (i % 5) * 0xa0000 + m.s32(g.pv(V.PIECE_X)) - 0x10000);
    m.w32(o + A.O_Y, Math.trunc(i / 5) * 0xa0000 + m.s32(g.pv(V.PIECE_Y)) - 0x10000);
    n++;
  }
}

/** queue_init: two previews, no re-roll (docs/spec/piece.md §3). */
export function queueInit(g: Game): void {
  const m = g.m;
  const pos = NEXT_POS + g.p * 16;
  m.w32(g.pv(V.NEXT1_X), m.s32(pos));
  m.w32(g.pv(V.NEXT1_Y), m.s32(pos + 4));
  m.w32(g.pv(V.SPAWN_ROT), 0);
  m.w32(g.pv(V.NEXT1), m.s32(QUEUE_TABLE + 4 * (g.rand() & 15)));
  m.w32(g.pv(NEXT2_X), m.s32(pos + 8));
  m.w32(g.pv(NEXT2_Y), m.s32(pos + 12));
  m.w32(g.pv(0x800ee360), 0);
  m.w32(g.pv(V.NEXT2), m.s32(QUEUE_TABLE + 4 * (g.rand() & 15)));
}

/** queue_advance: next2 moves up; a new next2 differs from next1 and the falling piece. */
export function queueAdvance(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.NEXT1), m.s32(g.pv(V.NEXT2)));
  let k: number;
  do k = m.s32(QUEUE_TABLE + 4 * (g.rand() & 15));
  while (m.s32(g.pv(V.NEXT1)) === k || m.s32(g.pv(V.PIECE_KIND)) === k);
  m.w32(g.pv(V.NEXT2), k);
}

/** queue_draw */
export function queueDraw(g: Game): void {
  const m = g.m;
  let o = A.obj(g.ob + 0x101);
  m.w32(o + A.O_IMAGE, m.s32(g.pv(V.NEXT1)) + 0x10015);
  m.w32(o + A.O_X, m.s32(g.pv(V.NEXT1_X)));
  m.w32(o + A.O_Y, m.s32(g.pv(V.NEXT1_Y)));
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  o = A.obj(g.ob + 0x102);
  m.w32(o + A.O_IMAGE, m.s32(g.pv(V.NEXT2)) + 0x10015);
  m.w32(o + A.O_X, m.s32(g.pv(NEXT2_X)));
  m.w32(o + A.O_Y, m.s32(g.pv(NEXT2_Y)));
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_SCALE_X, -0x800);
  m.w32(o + A.O_SCALE_Y, -0x800);
}

/** Step 0, play_spawn (docs/spec/piece.md §2). */
export function playSpawn(g: Game): void {
  const m = g.m;
  if (m.add32(g.pv(V.SPAWN_DELAY), -1) >= 1) return;
  m.w32(g.pv(V.SPAWN_DELAY), 0);
  m.w32(g.pv(V.PIECE_KIND), m.s32(g.pv(V.NEXT1)));
  m.w32(g.pv(V.PIECE_X), m.s32(g.pv(V.NEXT1_X)));
  m.w32(g.pv(V.PIECE_Y), m.s32(g.pv(V.NEXT1_Y)) + 0x140000);
  m.w32(g.pv(V.PIECE_ROT), m.s32(g.pv(V.SPAWN_ROT)));
  m.add32(g.pv(V.CEILING_TIMER), 0x3c);
  m.w32(g.pv(V.PIECE_HAS_DROPPED), 0);
  m.w32(g.pv(V.GRAVITY_COUNT), 0);
  m.w32(g.pv(V.LOCK_COUNT), 0);
  pieceDraw(g);
  queueAdvance(g);
  queueDraw(g);
  m.add32(g.pv(V.PIECES_SPAWNED), 1);
  m.add32(g.pv(A.STEP), 1);
  stageClock(g);
}

/** One direction of piece_input: a press moves and loads the counters; holding repeats. */
function inputDirection(g: Game, bit: number, dx: number): void {
  const m = g.m;
  if (!((g.pressed() & bit) || (g.held() & bit))) return;
  if (g.pressed() & bit) {
    m.w32(g.pv(V.INPUT_DX), dx);
    m.w32(g.pv(V.DAS_DELAY), 0x14);
    m.w32(g.pv(V.DAS_REPEAT), 4);
  }
  if (g.held() & bit) {
    if (m.s32(g.pv(V.DAS_DELAY)) !== 0) {
      m.add32(g.pv(V.DAS_DELAY), -1);
    } else if (m.s32(g.pv(V.DAS_REPEAT)) !== 0) {
      m.add32(g.pv(V.DAS_REPEAT), -1);
    } else {
      m.w32(g.pv(V.INPUT_DX), dx);
      m.w32(g.pv(V.DAS_REPEAT), 4);
    }
  }
}

/** piece_input (docs/spec/piece.md §4). */
function pieceInput(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.INPUT_DX), 0);
  m.w32(g.pv(V.GRAVITY_DY), 0);
  m.w32(g.pv(V.INPUT_ROT), 0);
  inputDirection(g, 0x2000, 0xa0000);
  inputDirection(g, 0x8000, -0xa0000);
  const pressed = g.pressed();
  const cw = m.u32(g.pv(A.ROT_CW_MASK));
  if (pressed & m.u32(g.pv(A.ROT_CCW_MASK)) || pressed & cw) {
    m.w32(g.pv(V.INPUT_ROT), pressed & cw ? 1 : -1);
  }
}

/** piece_gravity: thresholds 8 before the first drop, then 50, or 3 with Down held. */
function pieceGravity(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.GRAVITY_DY), 0);
  const count = m.add32(g.pv(V.GRAVITY_COUNT), 1);
  let threshold = 0x32;
  if (m.s32(g.pv(V.PIECE_HAS_DROPPED)) === 0) threshold = 8;
  else if (g.held() & 0x4000) threshold = 3;
  m.w32(SCRATCH_A, threshold);
  if (threshold <= count) m.w32(g.pv(V.GRAVITY_DY), 0xa0000);
}

/** piece_lock: the piece's cells on rows 0-15 go into the board. */
function pieceLock(g: Game): void {
  const m = g.m;
  m.w32(A.OBJ_BASE, g.p * 400);
  const kind = m.s32(g.pv(V.PIECE_KIND));
  const rot = m.s32(g.pv(V.PIECE_ROT));
  let col = Math.trunc((m.s32(g.pv(V.PIECE_X)) >> 16) / 10);
  let row = Math.trunc((m.s32(g.pv(V.PIECE_Y)) >> 16) / 10);
  m.w32(g.pv(V.LOCK_TOP_ROW), row);
  for (let i = 0, k = 0; i < 25; i++) {
    if (col >>> 0 < 10 && row >>> 0 < 16 && shapeCell(g, kind, rot, i) !== 0) {
      const cell = row * 10 + col;
      m.w32(cellAddr(g, cell), kind);
      const o = A.obj(cell + BOARD_OBJ + g.ob);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 1);
      m.w32(o + A.O_IMAGE, m.s32(BLOCK_IMAGE + kind * 4));
    }
    col++;
    if (++k === 5) {
      k = 0;
      col -= 5;
      row++;
    }
  }
  m.w32(SCRATCH_A, col);
  m.w32(SCRATCH_B, row);
}

/** Step 1, play_fall (docs/spec/piece.md §5). */
export function playFall(g: Game): void {
  const m = g.m;
  if (m.s32(g.pv(V.PIECE_HAS_DROPPED)) !== 0) {
    pieceInput(g);
    m.add32(g.pv(V.PIECE_X), m.s32(g.pv(V.INPUT_DX)));
    if (pieceCollides(g)) m.add32(g.pv(V.PIECE_X), -m.s32(g.pv(V.INPUT_DX)));
    const r = m.s32(g.pv(V.INPUT_ROT));
    m.w32(g.pv(V.PIECE_ROT), (m.s32(g.pv(V.PIECE_ROT)) - r) & 3);
    if (pieceCollides(g)) m.w32(g.pv(V.PIECE_ROT), (m.s32(g.pv(V.PIECE_ROT)) + r) & 3);
    else if (r !== 0) sePlay(g, 0xe);
  }
  pieceGravity(g);
  const dy = m.s32(g.pv(V.GRAVITY_DY));
  if (dy !== 0) {
    m.add32(g.pv(V.PIECE_Y), dy);
    if (pieceCollides(g)) {
      m.add32(g.pv(V.PIECE_Y), -dy);
      const count = m.add32(g.pv(V.LOCK_COUNT), 1);
      const lock = m.s32(LEVEL_LOCK + m.s32(g.pv(V.LEVEL)) * 0x18);
      m.w32(SCRATCH_A, lock);
      if (lock <= count) {
        pieceLock(g);
        for (let i = 0; i < 4; i++) objectClear(g, g.ob + PIECE_OBJ + i);
        m.w32(g.pv(V.PIECE_KIND), 0);
        m.w32(g.pv(V.LINES_FOUND), linesFindFull(g));
        m.add32(g.pv(A.STEP), 1);
        sePlay(g, 0xc);
        return;
      }
    } else {
      m.w32(g.pv(V.PIECE_HAS_DROPPED), 1);
      m.w32(g.pv(V.GRAVITY_COUNT), 0);
      m.w32(g.pv(V.LOCK_COUNT), 0);
    }
  }
  pieceDraw(g);
  stageClock(g);
}
