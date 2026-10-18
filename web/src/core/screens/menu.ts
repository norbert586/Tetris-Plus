// Screen 0: Puzzle Mode's menu, New Game / Continue / Password (menu_step_dispatch).
import * as A from '../addr';
import { NotPorted, type Game } from '../game';
import { animSet, animTick, itemLoad, objectClear, objectPut2, objectsClear } from '../objects';
import { bgmRequest, sePlay } from '../sound';
import { passwordStep } from './password';
import * as V from '../vars';

const CURSOR = 0x800f2d14; // [2]
const MENU_TABLE = 0x80094128; // int[2] rows by S+0x4B538, then 3 images per cursor position

export function scr00Menu(g: Game): void {
  const m = g.m;
  switch (m.s32(g.pv(A.STEP))) {
    case 0:
      MAIN[m.s32(g.pv(A.SUBSTEP))](g);
      return;
    case 1:
      m.w32(g.pv(A.STEP), 5);
      return;
    case 2:
      throw new NotPorted('menu: Continue (memory card load)');
    case 3:
      passwordStep(g);
      return;
    case 4:
      m.add32(g.pv(A.STEP), 1);
      return;
    case 5:
      newGame(g);
      return;
    case 6:
      startLoadedGame(g);
      return;
    case 7:
      newGameKeepStage(g);
      return;
  }
}

const MAIN: ((g: Game) => void)[] = [
  // 0x80099EF0: draw the menu.
  (g) => {
    const m = g.m;
    bgmRequest(g, 0x2f);
    objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
    objectPut2(g, 0x1e, 300, 0, 8);
    objectPut2(g, 0x186, 4, 0x28, 0x1e);
    objectPut2(g, 0x18b, 0, 0x28, 0x44);
    animSet(g, g.ob + 0x18b, 0x24);
    m.w32(g.pv(CURSOR), 0);
    m.w32(g.pv(V.HUNDRED_AUTO), 0);
    m.w32(g.pv(V.HUNDRED), 0);
    m.w32(g.pv(V.NEW_GAME_FIRST), 0);
    itemLoad(g, 0x4c5);
    m.add32(g.pv(A.SUBSTEP), 1);
  },
  // 0x8009A020: Up/Down move the cursor, Cross picks.
  (g) => {
    const m = g.m;
    const rows = m.s32(MENU_TABLE + 4 * m.s32(A.MENU_ROWS));
    if (g.pressed() & 0x40) {
      m.w32(0x800f2cf4, 0);
      sePlay(g, 0);
      m.add32(g.pv(A.SUBSTEP), 1);
    }
    if (g.pressed() & 0x4000) {
      const c = m.s32(g.pv(CURSOR)) + 1;
      m.w32(g.pv(CURSOR), rows - 1 < c ? 0 : c);
      sePlay(g, 3);
    }
    if (g.pressed() & 0x1000) {
      const c = m.s32(g.pv(CURSOR)) - 1;
      m.w32(g.pv(CURSOR), c < 0 ? rows - 1 : c);
      sePlay(g, 3);
    }
    animTick(g, g.ob + 0x18b);
    const cursor = m.s32(g.pv(CURSOR));
    for (let i = 0; i < rows; i++) {
      objectPut2(g, 400 + i, m.s32(MENU_TABLE + 4 * (cursor * 3 + i + 2)), 0x18, i * 0x28 + 100);
    }
    objectPut2(g, 399, 0x4c6, 0x12, cursor * 0x28 + 0x5e);
    m.w32(A.obj(g.ob + 399) + A.O_PALETTE, g.p);
  },
  // 0x8009A3C0: go to the chosen item's step.
  (g) => {
    const m = g.m;
    objectClear(g, g.ob + 399);
    m.add32(g.pv(A.STEP), 1 + m.s32(g.pv(CURSOR)));
    m.w32(g.pv(A.SUBSTEP), 0);
    m.w32(g.pv(A.STEP4), 0);
  },
  () => {},
];

function toScreen(g: Game, screen: number): void {
  const m = g.m;
  m.w32(g.pv(A.SCREEN), screen);
  m.w32(g.pv(A.STEP), 0);
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** Step 5 (0x800A8764): a new game, to the map. */
function newGame(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.LEVEL), 0);
  m.w32(g.pv(V.SCORE), 0);
  m.w32(g.pv(V.SAVED_STAGE), 0);
  m.w32(g.pv(V.ZONES_CLEARED), 0);
  m.w32(g.pv(V.ZONE), 0);
  m.w32(g.pv(0x800ee738), 0);
  m.fill(0x800eea4c + g.p * 0x1c, 7 * 4);
  m.w32(g.pv(V.NEW_GAME_FIRST), 1);
  toScreen(g, 1);
}

/** Step 6 (0x800A8880): start the game loaded from the card or a password. */
function startLoadedGame(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.LEVEL), 0);
  m.w32(g.pv(V.SCORE), 0);
  const saved = m.s32(g.pv(V.SAVED_STAGE));
  if (saved === 0xff) {
    m.w32(g.pv(A.STEP), 5);
    return;
  }
  if (m.s32(g.pv(V.ZONES_CLEARED)) === 0x1f) {
    m.w32(g.pv(V.ZONE), 0);
    m.w32(g.pv(V.STAGE), 0);
    objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
    m.w32(g.pv(V.HUNDRED_AUTO), 1);
    m.w32(g.pv(V.HUNDRED), 1);
  } else {
    m.w32(g.pv(V.ZONE), Math.trunc(saved / 20));
    m.w32(g.pv(V.STAGE), saved % 20);
    objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
  }
  toScreen(g, 3);
}

/** Step 7 (0x800A8A74) */
function newGameKeepStage(g: Game): void {
  const m = g.m;
  m.w32(g.pv(V.LEVEL), 0);
  m.w32(g.pv(V.SCORE), 0);
  m.w32(g.pv(V.SAVED_STAGE), 0);
  m.w32(g.pv(V.ZONES_CLEARED), 0);
  toScreen(g, 1);
}
