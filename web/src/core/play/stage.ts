// The board and the stage records (docs/spec/stages.md §1).
import * as A from '../addr';
import type { Game } from '../game';
import { objectClear } from '../objects';
import * as V from '../vars';
import { BOARD_OBJ } from './objects';

const STAGE_INDEX = 0x800d780c; // int[5][20]: zone, stage -> record
const RECORDS = 0x800d79ec; // 0x28 bytes each
const LAYOUTS = 0x800d898c; // 150 bytes each: rows 1-15
export const BLOCK_IMAGE = 0x800e2a20; // image per board value

/** The current player's stage record number (= zone * 20 + stage). */
export function stageRecord(g: Game): number {
  const m = g.m;
  return m.s32(STAGE_INDEX + m.s32(g.pv(V.STAGE)) * 4 + m.s32(g.pv(V.ZONE)) * 0x50);
}
/** Address of a field of the current stage's record. */
export const recordField = (g: Game, offset: number): number => RECORDS + stageRecord(g) * 0x28 + offset;
/** Address of the current stage's best time (u16, tenths). */
export const bestTimeAddr = (g: Game): number => A.BEST_TIMES + stageRecord(g) * 2;

/** Board cell i (row * 10 + col) of the current player. */
export const cellAddr = (g: Game, i: number): number => V.BOARD + g.p * 0x348 + 4 * i;

/** board_reset: empties the board, row 0's walls either side of the opening. */
export function boardReset(g: Game): void {
  const m = g.m;
  m.fill(V.BOARD + g.p * 0x348, 0x348);
  for (const i of [0, 1, 2, 7, 8, 9]) m.w32(cellAddr(g, i), 0xffff);
}

/** board_clear_rows: empties rows 1-15. */
export function boardClearRows(g: Game): void {
  for (let i = 10; i < 0xa0; i++) g.m.w32(cellAddr(g, i), 0);
}

/** stage_load_layout: the stage's layout into rows 1-15. */
export function stageLoadLayout(g: Game): void {
  const m = g.m;
  const layout = LAYOUTS + m.s32(recordField(g, 0x10)) * 0x96;
  for (let i = 0; i < 0x96; i++) m.w32(cellAddr(g, 10 + i), m.u8(layout + i));
}

/** board_sprites_build: an object per block. */
export function boardSpritesBuild(g: Game): void {
  const m = g.m;
  for (let i = 10; i < 0xa0; i++) {
    const v = m.s32(cellAddr(g, i));
    if (v === 0) continue;
    const n = i + g.ob + BOARD_OBJ;
    objectClear(g, n);
    const o = A.obj(n);
    m.w32(o + A.O_X, (i % 10) * 0xa0000);
    m.w32(o + A.O_Y, Math.trunc(i / 10) * 0xa0000);
    m.w32(o + A.O_IMAGE, m.s32(BLOCK_IMAGE + v * 4));
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
  }
}
