// Groups of the play area's sprite objects, cleared or laid out together. Object numbers are
// within the current player's range (Game.ob + n).
import * as A from '../addr';
import type { Game } from '../game';
import { objectClear } from '../objects';

/** First of the 160 board-cell objects (0x32 + row * 10 + col). */
export const BOARD_OBJ = 0x32;
/** First of the 20 debris objects. */
export const DEBRIS_OBJ = 0x11d;

/** FUN_800ACE54: positions the board-cell objects at their cells (rows 1-15, row 0's opening). */
export function boardObjectsLayout(g: Game): void {
  const m = g.m;
  const base = g.ob + BOARD_OBJ;
  const place = (i: number) => {
    const o = A.obj(base + i);
    m.w32(o + A.O_X, (i % 10) * 0xa0000);
    m.w32(o + A.O_Y, Math.trunc(i / 10) * 0xa0000);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
  };
  for (let i = 10; i < 0xa0; i++) place(i);
  for (let i = 3; i < 7; i++) place(i);
}

/** FUN_800B1928: clears the 160 board-cell objects. */
export function objectsClearBoard(g: Game): void {
  for (let i = 0; i < 0xa0; i++) objectClear(g, i + g.ob + BOARD_OBJ);
}

/** debris_clear_all */
export function debrisClearAll(g: Game): void {
  for (let i = 0; i < 0x14; i++) objectClear(g, i + g.ob + DEBRIS_OBJ);
}

/** FUN_800B19C0: clears objects 0x118-0x11B and 0x108-0x10B (pop-ups, the idle character). */
export function objectsClearPopups(g: Game): void {
  for (let i = 0; i < 4; i++) objectClear(g, i + g.ob + 0x118);
  for (let i = 0x108; i < 0x10c; i++) objectClear(g, g.ob + i);
}

/** FUN_800B1A4C: clears objects 0x101 and 0x102. */
export function objectsClearPieceFlash(g: Game): void {
  objectClear(g, g.ob + 0x101);
  objectClear(g, g.ob + 0x102);
}
