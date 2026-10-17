// Pausing (pause_check, after each player's screen; docs/re/static-bootstrap.md §4) and hiding
// the play area while paused.
import * as A from './addr';
import type { Game } from './game';
import { bgmRequest, BGM_STOP } from './sound';

const PAUSE_GUARD = 0x800ee6a0; // [2] blocks Start-to-pause while set
const HUNDRED_AUTO = 0x800ee340; // [2]
const PAUSABLE = 0x800dc424; // int[14] by screen
export const SAVED_SCREEN = 0x800eeb10; // [2] and the step words below
export const SAVED_STEP = 0x800ee400;
export const SAVED_SUBSTEP = 0x800ee6b0;
export const SAVED_STEP4 = 0x800ee9b4;
export const SAVED_BGM = 0x800ed350; // [2] the music to restore

export function pauseCheck(g: Game): void {
  const m = g.m;
  const screen = m.s32(g.pv(A.SCREEN));
  const start = (g.pressed() & 0x800) !== 0 && m.s32(g.pv(PAUSE_GUARD)) === 0;
  const forced = m.s32(g.pv(HUNDRED_AUTO)) !== 0 && screen === 5;
  if (!(start || forced) || m.s32(PAUSABLE + 4 * screen) === 0) return;
  hidePlayArea(g);
  m.w32(g.pv(SAVED_SCREEN), m.s32(g.pv(A.SCREEN)));
  m.w32(g.pv(SAVED_STEP), m.s32(g.pv(A.STEP)));
  m.w32(g.pv(SAVED_SUBSTEP), m.s32(g.pv(A.SUBSTEP)));
  m.w32(g.pv(SAVED_STEP4), m.s32(g.pv(A.STEP4)));
  m.w32(g.pv(A.SCREEN), 12);
  m.w32(g.pv(A.STEP), 0);
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
  m.w32(g.pv(SAVED_BGM), m.s32(g.p === 0 ? 0x800ed340 : 0x800ed344));
  bgmRequest(g, BGM_STOP);
}

/** The play area's objects, hidden by setting their image's sign bit (FUN_800B1D28). */
function playAreaObjects(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 0xa0; i++) list.push(0x32 + i);
  list.push(0xe5, 0xf5);
  for (let i = 0; i < 0xf; i++) list.push(0xe6 + i);
  for (let i = 0; i < 0x14; i++) list.push(0x11d + i);
  for (let i = 0; i < 4; i++) list.push(0x118 + i);
  list.push(0x108, 0x109, 0x10a, 0x10b, 0x101, 0x102, 0xde, 0xdf, 0xe0, 0xe1, 0x28, 0x100, 0x131);
  return list;
}
const PLAY_AREA = playAreaObjects();

/** FUN_800B1D28 */
export function hidePlayArea(g: Game): void {
  g.m.w32(A.OBJ_BASE, g.p * 400);
  for (const n of PLAY_AREA) {
    const a = A.obj(g.ob + n) + A.O_IMAGE;
    g.m.w32(a, g.m.u32(a) | 0x80000000);
  }
}

/** FUN_800B20E4: shows the play area again. */
export function showPlayArea(g: Game): void {
  g.m.w32(A.OBJ_BASE, g.p * 400);
  for (const n of PLAY_AREA) {
    const a = A.obj(g.ob + n) + A.O_IMAGE;
    g.m.w32(a, g.m.u32(a) & 0x7fffffff);
  }
}
