// Sprite objects (docs/re/static-bootstrap.md §3.4). They are presentation, but the logic reads
// some of their fields (animation frames, positions, free debris slots) and drawing a box-fill
// object calls rand(), so the core keeps them as the original does.
import * as A from './addr';
import type { Game } from './game';

/** object_clear: zeroes all 31 words of object n. */
export function objectClear(g: Game, n: number): void {
  g.m.fill(A.obj(n), A.OBJ_SIZE);
}

/** objects_clear_all */
export function objectsClearAll(g: Game): void {
  for (let n = 0; n < A.OBJ_COUNT; n++) objectClear(g, n);
}

/** Clears objects first..last-1. */
export function objectsClear(g: Game, first: number, end: number): void {
  for (let n = first; n < end; n++) objectClear(g, n);
}

/**
 * objects_draw, for what it does to game state: counts live objects (state+0x58) and, for every
 * box-fill object (kind -1), draws a box whose colour takes three rand() calls. Objects are
 * walked from the last to the first; one is live when its image field is positive.
 */
export function objectsDraw(g: Game): void {
  const m = g.m;
  let live = 0;
  for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
    const o = A.obj(n);
    const image = m.s32(o + A.O_IMAGE);
    if (image <= 0) continue;
    live++;
    if (m.s32(o + A.O_KIND) === -1) {
      g.rand();
      g.rand();
      g.rand();
    }
  }
  m.w32(A.S + 0x58, live);
}

/** FUN_800985b4: image and position (whole pixels) of object n. */
export function objectSet(g: Game, n: number, image: number, x: number, y: number): void {
  const o = A.obj(n);
  g.m.w32(o + A.O_IMAGE, image + 0x10000);
  g.m.w32(o + A.O_X, x << 16);
  g.m.w32(o + A.O_Y, y << 16);
}

/** FUN_800985ec: the current player's object n (layer 1), with image and position. */
export function objectPut1(g: Game, n: number, image: number, x: number, y: number): void {
  objectPut(g, n, image, x, y, 1);
}

/** FUN_80098658: the current player's object n (layer 2), with image and position. */
export function objectPut2(g: Game, n: number, image: number, x: number, y: number): void {
  objectPut(g, n, image, x, y, 2);
}

function objectPut(g: Game, n: number, image: number, x: number, y: number, layer: number): void {
  const m = g.m;
  m.w32(A.OBJ_BASE, g.p * 400);
  const k = n + g.ob;
  const o = A.obj(k);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, layer);
  objectSet(g, k, image, x, y);
}

/** FUN_800986c4 / FUN_80098738: objectPut1/2 plus the player's palette (and an image upload). */
export function objectLoad1(g: Game, n: number, image: number, x: number, y: number): void {
  objectPut1(g, n, image, x, y);
  g.m.w32(A.obj(n + g.ob) + A.O_PALETTE, g.p);
}
export function objectLoad2(g: Game, n: number, image: number, x: number, y: number): void {
  objectPut2(g, n, image, x, y);
  g.m.w32(A.obj(n + g.ob) + A.O_PALETTE, g.p);
}

/** FUN_80098200: moves object n by its velocity. */
export function objectMove(g: Game, n: number): void {
  const o = A.obj(n);
  g.m.add32(o + A.O_X, g.m.s32(o + A.O_VX));
  g.m.add32(o + A.O_Y, g.m.s32(o + A.O_VY));
}

/** FUN_800983bc / FUN_80098524: counts the object's word +0x4C up to 64; true once there. */
export function objectFadeUp(g: Game, n: number): boolean {
  const a = A.obj(n) + A.O_4C;
  const v = g.m.add32(a, 1);
  if (v > 0x3f) g.m.w32(a, 0x40);
  return v > 0x3f;
}

/** FUN_80098408 / FUN_80098570: counts +0x4C down to 0; true once below. */
export function objectFadeDown(g: Game, n: number): boolean {
  const a = A.obj(n) + A.O_4C;
  const v = g.m.add32(a, -1);
  if (v < 0) g.m.w32(a, 0);
  return v < 0;
}

/** FUN_8009844c (kind -2) / FUN_800984b8 (kind -3): a full-panel fade box at level `level`. */
export function objectFadeBox(g: Game, n: number, level: number, kind: -2 | -3): void {
  const m = g.m;
  const o = A.obj(n);
  m.w32(o + A.O_KIND, kind);
  m.w32(o + A.O_IMAGE, 0x10000);
  m.w32(o + A.O_4C, level);
  m.w32(o + A.O_X, g.p * 0x9c);
  m.w32(o + A.O_Y, 0x2c);
  m.w32(o + A.O_VX, 0xa0);
  m.w32(o + A.O_VY, 0x60);
}

// ---- sprite animations (table 0x800E2E6C: {frame time, image, image, ..., 0xFFFE loop | 0xFFFF end}) ----

const ANIM_TABLE = 0x800e2e6c;

/** FUN_800aeb30: starts object n's animation (its O_ANIM id) at the first frame. */
export function animStart(g: Game, n: number): void {
  const m = g.m;
  const o = A.obj(n);
  const id = m.s32(o + A.O_ANIM);
  if (id === 0) return;
  const t = m.u32(ANIM_TABLE + 4 * id);
  m.w32(0x800ed3a4, t);
  m.w32(o + A.O_IMAGE, m.s32(t + 4) + 0x10000);
  m.w32(o + A.O_ANIM_TIMER, m.s32(t));
  m.w32(o + A.O_ANIM_FRAME, 0);
}

/** Sets object n's animation and starts it. */
export function animSet(g: Game, n: number, id: number): void {
  g.m.w32(A.obj(n) + A.O_ANIM, id);
  animStart(g, n);
}

/**
 * FUN_800aecb4: advances object n's animation one frame. Returns true on frames where the image
 * changed. At 0xFFFF the animation ends (O_ANIM = 0, image kept); at 0xFFFE it loops.
 */
export function animTick(g: Game, n: number): boolean {
  const m = g.m;
  const o = A.obj(n);
  if (m.s32(o + A.O_ANIM) === 0) return false;
  if (m.add32(o + A.O_ANIM_TIMER, -1) > 0) return false;
  const t = m.u32(ANIM_TABLE + 4 * m.s32(o + A.O_ANIM));
  m.w32(0x800ed3a4, t);
  const i = m.s32(o + A.O_ANIM_FRAME);
  m.w32(o + A.O_ANIM_FRAME, i + 1);
  const next = m.s32(t + 4 * (i + 2));
  if (next === 0xfffe) {
    m.w32(o + A.O_ANIM_FRAME, 0);
  } else if (next === 0xffff) {
    m.w32(o + A.O_ANIM, 0);
    return false;
  }
  m.w32(o + A.O_ANIM_TIMER, m.s32(t));
  m.w32(o + A.O_IMAGE, m.s32(t + 4 * (m.s32(o + A.O_ANIM_FRAME) + 1)) + 0x10000);
  return true;
}
