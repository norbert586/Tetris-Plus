// Screen 0: Puzzle Mode's menu, New Game / Continue / Password (menu_step_dispatch).
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animTick, itemLoad, objectClear, objectLoad2, objectPut2, objectsClear } from '../objects';
import * as C from '../card';
import { CARD_TIMER, SLOT_PICK, slotList, substepNext, substepSet } from './after';
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
      CONTINUE[m.s32(g.pv(A.SUBSTEP))](g);
      return;
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

// ---- step 2: Continue, a game saved on the memory card (table 0x8009417C) ----

const v = (g: Game, a: number) => g.m.s32(g.pv(a));

/** FUN_800B6DD4: the card slot chooser: the cursor on the player's slot, "which slot?". */
function cardSlotAsk(g: Game): void {
  const m = g.m;
  objectPut2(g, 0x1a2, 0, v(g, C.CARD_SLOT) * 0x2e + 0x27, 0x7d);
  const n = g.ob + 0x1a2;
  m.w32(A.obj(n) + A.O_PALETTE, g.p);
  m.w32(A.obj(n) + A.O_ANIM, v(g, C.CARD_SLOT) + 0x34);
  animStartUpload(g, n);
  objectLoad2(g, 0x1a1, 0x43f, 0x10, 0x50);
}

/** FUN_800B6EF4: Cross 1, Circle 2, Left/Right switch the slot, else 0. */
function cardSlotInput(g: Game): number {
  const m = g.m;
  const pressed = g.pressed();
  if (pressed & 0x40) {
    sePlay(g, 0);
    return 1;
  }
  if (pressed & 0x20) {
    sePlay(g, 0x12);
    return 2;
  }
  if ((pressed & 0xa000) === 0) {
    animTickUpload(g, g.ob + 0x1a2);
    return 0;
  }
  const c = v(g, C.CARD_SLOT) ^ 1;
  m.w32(g.pv(C.CARD_SLOT), c);
  objectPut2(g, 0x1a2, 0, c * 0x2e + 0x27, 0x7d);
  m.w32(A.obj(g.ob + 0x1a2) + A.O_ANIM, v(g, C.CARD_SLOT) + 0x34);
  animStartUpload(g, g.ob + 0x1a2);
  sePlay(g, 3);
  return 0;
}

/** FUN_800AEB9C: animStart, uploading the first image now. */
function animStartUpload(g: Game, n: number): void {
  if (g.m.s32(A.obj(n) + A.O_ANIM) === 0) return;
  animSet(g, n, g.m.s32(A.obj(n) + A.O_ANIM));
  itemLoad(g, g.m.s32(A.obj(n) + A.O_IMAGE) - 0x10001);
}

/** FUN_800AEDFC: animTick, uploading the new image now whenever it changes. */
function animTickUpload(g: Game, n: number): void {
  if (animTick(g, n)) itemLoad(g, g.m.s32(A.obj(n) + A.O_IMAGE) - 0x10001);
}

/** A card error: the message (object 0x1A1) for 120 ticks, then the slot chooser again (8). */
function continueError(g: Game, image: number): void {
  objectLoad2(g, 0x1a1, image, 0x10, 0x44);
  objectClear(g, g.ob + 0x1a2);
  objectClear(g, g.ob + 0x1a3);
  g.m.w32(g.pv(CARD_TIMER), 0x78);
  substepSet(g, 8);
}

const CONTINUE: ((g: Game) => void)[] = [
  // 0 (0x8009AF70): the screen and the card slot chooser.
  (g) => {
    const m = g.m;
    objectLoad2(g, 0x1e, 0x407, 0, 8);
    objectPut2(g, 0x186, 4, 0x22, 0x12);
    objectPut2(g, 0x187, 0x3c7, 0x1b, 0x32);
    objectPut2(g, 0x18b, 0, 0xe, 0x51);
    m.w32(A.obj(g.ob + 0x18b) + A.O_ANIM, 0x33);
    for (let i = 0; i < 3; i++) objectPut2(g, i + 400, i + 0x3cc, 0x16, i * 0x28 + 0x6c);
    m.w32(g.pv(C.CARD_SLOT), 0);
    m.w32(g.pv(SLOT_PICK), -1);
    cardSlotAsk(g);
    substepNext(g);
  },
  // 1 (0x8009B104): Cross picks the card slot; Circle goes back to the menu.
  (g) => {
    const r = cardSlotInput(g);
    if (r === 1) {
      substepNext(g);
    } else if (r === 2) {
      g.m.w32(g.pv(A.STEP), 0);
      substepSet(g, 0);
    }
  },
  // 2 (0x8009B1B4): the card lock.
  (g) => {
    if (C.cardLock(g)) {
      substepNext(g);
      return;
    }
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    objectLoad2(g, 0x1a1, 0x4d3, 0xd, 99);
    g.m.w32(g.pv(CARD_TIMER), 0x78);
    substepSet(g, 10);
  },
  // 3 (0x8009B290): check the card.
  (g) => {
    const m = g.m;
    m.w32(C.CARD_INDEX, v(g, C.CARD_SLOT));
    const r = C.cardStatus(g);
    m.w32(C.CARD_RESULT, r);
    if (r === 1) substepNext(g);
    else if (r !== 2) continueError(g, r === 0 ? 0x440 : r === 3 ? 0x441 : 0x442);
  },
  // 4 (0x8009B444): read the save file; its three slots into the state.
  (g) => {
    if (!C.saveRead(g)) {
      continueError(g, 0x441);
      return;
    }
    C.saveToState(g, 4);
    substepNext(g);
  },
  // 5 (0x8009B574): the slots.
  (g) => {
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    objectClear(g, g.ob + 0x1a3);
    slotList(g, 0, 0x6c);
    itemLoad(g, 0x4c5);
    g.m.w32(g.pv(SLOT_PICK), 0);
    substepNext(g);
  },
  // 6 (0x8009B61C): Up/Down pick a slot, Cross loads it; Circle: back to the menu (the best
  // times read from the card are kept).
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x20) {
      sePlay(g, 0x12);
      C.saveToState(g, 1);
      const o = A.obj(g.ob + 399);
      m.w32(o + A.O_SCALE_Y, 0);
      m.w32(o + A.O_SCALE_X, 0);
      C.cardUnlock(g);
      m.w32(g.pv(A.STEP), 0);
      substepSet(g, 0);
      return;
    }
    if (pressed & 0x40) {
      const slot = C.SAVE_SLOTS + 2 * v(g, SLOT_PICK);
      m.w32(g.pv(V.SAVED_STAGE), m.u8(slot));
      m.w32(g.pv(V.ZONES_CLEARED), m.u8(slot + 1));
      sePlay(g, 0);
      substepNext(g);
      return;
    }
    if (pressed & 0x1000) {
      const c = v(g, SLOT_PICK) - 1;
      m.w32(g.pv(SLOT_PICK), c < 0 ? 2 : c);
      slotList(g, v(g, SLOT_PICK), 0x6c);
      sePlay(g, 3);
    }
    if (pressed & 0x4000) {
      const c = v(g, SLOT_PICK) + 1;
      m.w32(g.pv(SLOT_PICK), c > 2 ? 0 : c);
      slotList(g, v(g, SLOT_PICK), 0x6c);
      sePlay(g, 3);
    }
    animTick(g, g.ob + 0x18b);
  },
  // 7 (0x8009B910): an empty slot starts a new game (step 5), else the saved one (6).
  (g) => {
    C.cardUnlock(g);
    g.m.w32(g.pv(A.STEP), v(g, V.SAVED_STAGE) === 0xff ? 5 : 6);
    substepSet(g, 0);
  },
  // 8 (0x8009B9C4): after a card error's 120 ticks, the slot chooser again.
  (g) => {
    if (g.m.add32(g.pv(CARD_TIMER), -1) < 1) {
      objectClear(g, g.ob + 0x1a1);
      C.cardUnlock(g);
      substepSet(g, 0);
    }
  },
  // 9 (0x8009BA48: unused)
  (g) => {
    g.m.add32(g.pv(A.STEP), 1);
    substepSet(g, 0);
  },
  // 10 (0x8009BA94): after "busy", the slot chooser again.
  (g) => {
    if (g.m.add32(g.pv(CARD_TIMER), -1) < 1) {
      objectClear(g, g.ob + 0x1a1);
      substepSet(g, 0);
    }
  },
];
