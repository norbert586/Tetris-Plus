// The ceiling, crushing and debris (docs/spec/ceiling.md).
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animTick, objectClear } from '../objects';
import { sePlay } from '../sound';
import * as V from '../vars';
import { BOARD_OBJ, DEBRIS_OBJ } from './objects';
import { cellAddr } from './stage';

const INTERVALS = 0x800d74ec; // int[4][50]
const SHAKE = 0x8009478c; // int[2]: -1 px, +1 px
const DEBRIS_VEL = 0x80094794; // (vx, vy) x 8
const DEBRIS_IMAGE = 0x800947d0; // image by board value (index 0 unused)
const CEIL_OBJ = 0xe5;
const CEIL_TOP_OBJ = 0xf5;
const CHAIN_OBJ = 0xe6; // 15 chain links

const interval = (g: Game) =>
  g.m.s32(INTERVALS + g.m.s32(g.pv(V.CEILING_DROPS)) * 4 + g.m.u8(A.DIFFICULTY) * 200);

/** ceiling_dispatch: state 0 init, 1 tick, 2 nothing. */
export function ceilingDispatch(g: Game): void {
  const s = g.m.s32(g.pv(V.CEILING_STATE));
  if (s === 0) ceilingInit(g);
  else if (s === 1) ceilingTick(g);
}

/** ceiling_init */
function ceilingInit(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.CEILING_SHAKE), 0);
  m.w32(g.pv(V.CEILING_DROPS), 0);
  m.w32(g.pv(V.CEILING_TIMER), 0);
  m.w32(g.pv(0x800f2d08), 0);
  m.w32(g.pv(0x800ee8ec), 0);
  const o = A.obj(g.ob + CEIL_OBJ);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0xa0000);
  m.w32(g.pv(0x800ee908), 0);
  m.w32(g.pv(V.CEILING_Y), 0xa0000);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  const t = A.obj(g.ob + CEIL_TOP_OBJ);
  m.w32(t + A.O_Y, m.s32(o + A.O_Y) - 0x100000);
  m.w32(t + A.O_X, 0x250000);
  m.w32(t + A.O_PLAYER, g.p);
  m.w32(t + A.O_20, 1);
  animSet(g, g.ob + CEIL_OBJ, 1);
  animSet(g, g.ob + CEIL_TOP_OBJ, 6);
  ceilingDrawChain(g);
  m.add32(g.pv(V.CEILING_STATE), 1);
}

/** ceiling_draw_chain: animates the ceiling and draws ceil_row + 2 chain links. */
export function ceilingDrawChain(g: Game): void {
  const m = g.m;
  animTick(g, g.ob + CEIL_OBJ);
  animTick(g, g.ob + CEIL_TOP_OBJ);
  for (let i = 0; i < 0xf; i++) objectClear(g, CHAIN_OBJ + i + g.ob);
  const links = Math.trunc((m.s32(g.pv(V.CEILING_Y)) >> 16) / 10) + 2;
  for (let i = 0; i < links; i++) {
    const o = A.obj(CHAIN_OBJ + i + g.ob);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, 0x10003);
    m.w32(o + A.O_X, 0x2d0000);
    m.w32(o + A.O_Y, ((i - 3) * 10 + 8) * 0x10000);
  }
  m.w32(A.obj(g.ob + CEIL_TOP_OBJ) + A.O_Y, m.s32(A.obj(g.ob + CEIL_OBJ) + A.O_Y) - 0x100000);
}

/** ceiling_tick (docs/spec/ceiling.md §2). */
function ceilingTick(g: Game): void {
  const m = g.m;
  const sprite = A.obj(g.ob + CEIL_OBJ) + A.O_Y;
  if (interval(g) - m.s32(g.pv(V.CEILING_TIMER)) < 100) {
    if ((g.counter & 0x3f) === 0) sePlay(g, 0x15);
    const shake = m.s32(g.pv(V.CEILING_SHAKE));
    m.add32(sprite, m.s32(SHAKE + 4 * shake));
    m.w32(g.pv(V.CEILING_SHAKE), shake ^ 1);
  }
  const push = m.s32(g.pv(V.CEILING_PUSHBACK));
  m.add32(sprite, push);
  m.add32(g.pv(V.CEILING_Y), push);
  if (m.s32(sprite) < 0xa0000) {
    m.w32(sprite, 0xa0000);
    m.w32(g.pv(V.CEILING_Y), 0xa0000);
  }
  m.w32(g.pv(V.CEILING_PUSHBACK), 0);
  const timer = m.add32(g.pv(V.CEILING_TIMER), 1);
  if (interval(g) <= timer) {
    const y = m.add32(g.pv(V.CEILING_Y), 0xa0000);
    m.w32(sprite, y);
    m.w32(g.pv(V.CEILING_TIMER), 0);
    m.w32(g.pv(V.CEILING_SHAKE), 0);
    sePlay(g, 9);
    const drops = m.s32(g.pv(V.CEILING_DROPS));
    if (drops < 0x31) m.w32(g.pv(V.CEILING_DROPS), drops + 1);
  }
  ceilingDrawChain(g);
}

/** debris_find_slot: the first object of the range whose image's low half is 0, else 0. */
function debrisFindSlot(g: Game, first: number, count: number): number {
  for (let n = first; n < first + count; n++) if (g.m.s16(A.obj(n) + A.O_IMAGE) === 0) return n;
  return 0;
}

/** Removes board cell i, making debris with `image` if a slot is free (that costs a rand()). */
function crushCell(g: Game, i: number, image: number): void {
  const m = g.m;
  const cellObj = A.obj(i + g.ob + BOARD_OBJ);
  const slot = debrisFindSlot(g, g.ob + DEBRIS_OBJ, 0x14);
  if (slot !== 0) {
    const o = A.obj(slot);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_28, 0);
    m.w32(o + A.O_IMAGE, image);
    m.w32(o + A.O_X, m.s32(cellObj + A.O_X));
    m.w32(o + A.O_Y, m.s32(cellObj + A.O_Y));
    const r = g.rand() & 7;
    m.w32(o + A.O_VX, m.s32(DEBRIS_VEL + r * 8));
    m.w32(o + A.O_VY, m.s32(DEBRIS_VEL + r * 8 + 4));
  }
  m.w32(cellObj + A.O_PLAYER, g.p);
  m.w32(cellObj + A.O_20, 1);
  m.w32(cellObj + A.O_IMAGE, 0);
  m.w32(cellAddr(g, i), 0);
}

/** ceiling_crush (docs/spec/ceiling.md §4). */
export function ceilingCrush(g: Game): void {
  const m = g.m;
  let crushed = false;
  for (let i = Math.trunc((m.s32(g.pv(V.CEILING_Y)) >> 16) / 10) * 10 + 0x13; i > 9; i--) {
    const v = m.s32(cellAddr(g, i));
    if (v === 0) continue;
    crushCell(g, i, m.s32(DEBRIS_IMAGE + 4 * v) + 0x10000);
    crushed = true;
  }
  for (let i = 6; i > 2; i--) {
    if (m.s32(cellAddr(g, i)) === 0) continue;
    crushCell(g, i, m.s32(A.obj(i + g.ob + BOARD_OBJ) + A.O_IMAGE) + 10);
    crushed = true;
  }
  if (crushed) sePlay(g, 0xf);
}

/** debris_update: every debris object with an image, one step (docs/spec/ceiling.md §4.1). */
export function debrisUpdate(g: Game): void {
  const m = g.m;
  for (let n = g.ob + DEBRIS_OBJ; n < g.ob + 0x131; n++) {
    const o = A.obj(n);
    if (m.s16(o + A.O_IMAGE) === 0) continue;
    m.add32(o + A.O_X, m.s32(o + A.O_VX));
    if (m.s32(o + A.O_28) === 0) {
      // debris_shrink
      m.add32(o + A.O_SCALE_X, -0x80);
      const sy = m.add32(o + A.O_SCALE_Y, -0x80);
      m.add32(o + A.O_Y, m.s32(o + A.O_VY));
      m.add32(o + A.O_VY, 0x10000);
      if (sy === -0x800) {
        m.add32(o + A.O_28, 1);
        m.w32(o + A.O_4C, 0x30);
      }
    } else {
      // debris_fall: blinks with the frame counter
      m.add32(o + A.O_Y, m.s32(o + A.O_VY));
      m.add32(o + A.O_VY, 0x10000);
      const img = m.u32(o + A.O_IMAGE);
      m.w32(o + A.O_IMAGE, g.counter & 4 ? img | 0x80000000 : img & 0x7fffffff);
      if (m.add32(o + A.O_4C, -1) < 0) objectClear(g, n);
    }
  }
}
