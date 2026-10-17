// HUD numbers and the stage clock (docs/spec/stages.md §4). Drawing is presentation, but the
// digits are sprite objects and the clock is game state.
import * as A from '../addr';
import type { Game } from '../game';
import { objectClear } from '../objects';
import * as V from '../vars';
import { bestTimeAddr } from './stage';

const POW10 = 0x80094818; // int[9]: [k] = 10^(k-1)
const TIME_X = 0x800e27a0; // int[2]: clock digits' x per player
const TIME_TENTH_X = 0x800e27a8;
const LABEL_X = 0x800940ec; // int[2]

/**
 * number_draw / FUN_800B0620: `digits` digit objects from `first`, leading zeros not drawn
 * (the last digit always is), at (x + i * spacing, y), image = digit + imageBase.
 */
export function numberDraw(
  g: Game, n: number, digits: number, first: number, x: number, y: number, imageBase: number,
  spacing: number, layer = 0,
): void {
  const m = g.m;
  for (let i = 0; i < digits; i++) objectClear(g, first + i);
  let shown = false;
  let obj = first;
  for (let k = digits, i = 0; k > 0; k--, i++) {
    const d = m.s32(POW10 + 4 * k);
    const q = Math.trunc(n / d);
    if (q !== 0 || shown || k === 1) {
      shown = true;
      const o = A.obj(obj);
      m.w32(o + A.O_IMAGE, q + imageBase + 0x10000);
      m.w32(o + A.O_X, (x + i * spacing) * 0x10000);
      m.w32(o + A.O_Y, y << 16);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, layer);
      n %= d;
      obj++;
    }
  }
}

export function scoreDraw(g: Game): void {
  numberDraw(g, g.m.s32(g.pv(V.SCORE)), 7, g.ob + 0xf8, g.p * 0x44 + 0x5f, 0x1d, 0x113, 8);
}

/** stage_timer_reset */
export function stageTimerReset(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.STAGE_TIME_SUB), 6);
  m.w32(g.pv(V.STAGE_TIME), 0);
  const o = A.obj(g.ob + 0xdc);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, 0x10427);
  m.w32(o + A.O_X, m.s32(LABEL_X + 4 * g.p));
  m.w32(o + A.O_Y, 0xd00000);
}

/** stage_timer_tick: a tenth every 7 frames, up to 999.9. */
export function stageTimerTick(g: Game): void {
  const m = g.m;
  if (m.add32(g.pv(V.STAGE_TIME_SUB), -1) < 0) {
    const t = m.s32(g.pv(V.STAGE_TIME));
    if (t < 9999) m.w32(g.pv(V.STAGE_TIME), t + 1);
    m.w32(g.pv(V.STAGE_TIME_SUB), 6);
  }
}

/** stage_timer_draw */
export function stageTimerDraw(g: Game): void {
  const t = g.m.s32(g.pv(V.STAGE_TIME));
  numberDraw(g, Math.trunc(t / 10), 3, g.ob + 0xd9, g.m.s32(TIME_X + 4 * g.p), 0xc6, 0x411, 6);
  numberDraw(g, t % 10, 1, g.ob + 0xdd, g.m.s32(TIME_TENTH_X + 4 * g.p), 0xd0, 0x41b, 6);
}

/** Every step function of screen 5 ends with the clock. */
export function stageClock(g: Game): void {
  stageTimerTick(g);
  stageTimerDraw(g);
}

/** best_time_draw (0x800B58E8): the stage's best time on the HUD. */
export function bestTimeDraw(g: Game): void {
  const m = g.m;
  for (let i = 0; i < 5; i++) objectClear(g, i + g.ob + 0xd4);
  const best = m.s16(bestTimeAddr(g));
  numberDraw(g, (Math.trunc(best / 10) << 16) >> 16, 3, g.ob + 0xd4, m.s32(TIME_X + 4 * g.p), 0xa5, 0x156, 6);
  numberDraw(g, ((best % 10) << 16) >> 16, 1, g.ob + 0xd8, m.s32(TIME_TENTH_X + 4 * g.p), 0xaf, 0x160, 6);
  const o = A.obj(g.ob + 0xd7);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, 0x1016c);
  m.w32(o + A.O_X, m.s32(LABEL_X + 4 * g.p));
  m.w32(o + A.O_Y, 0xaf0000);
}

/** FUN_800B0C04: the best time, after one tick of the stage clock (stage load). */
export function bestTimeDrawTick(g: Game): void {
  for (let i = 0; i < 5; i++) objectClear(g, i + g.ob + 0xd4);
  stageTimerTick(g);
  bestTimeDraw(g);
}
