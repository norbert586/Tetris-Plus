// The memory-card screens: the menu's Continue (menu step 2, table 0x8009417C) and the save
// screen's card steps (screen 13 substeps 4-37, table 0x800941A8). docs/re/shell.md §2.
import * as A from '../addr';
import {
  cardBlocksUsed, cardCheck, cardCreate, cardDefaults, cardFormat, cardLoad, cardRewrite, cardToState,
  stateToCard, CARD_PORT, CARD_RESULT,
} from '../card';
import type { Game } from '../game';
import { animStart, animTick, itemLoad, objectClear, objectLoad2, objectPut2 } from '../objects';
import { sePlay } from '../sound';
import * as V from '../vars';

const SLOT_CURSOR = 0x800ed320; // [2] save slot 0-2 (-1 while choosing the port)
const TIMER = 0x800f35b0; // [2] message countdown
const YES_NO = 0x800ee43c; // [2] 0 yes, 1 no
const CARD_FLAGS = 0x800f2ac8; // bit 0: a player is using the card; bit 4: a new file is being made
const CARD_PORT_CUR = 0x800ee9a0;
const SLOTS = A.S + 0x4aed8; // [3] zone*20+stage (0xFF empty), zones cleared
const SLOT_IMAGES = 0x80094968; // int[12] slot panel images, by highlighted or not

const v = (g: Game, a: number) => g.m.s32(g.pv(a));
const sub = (g: Game) => g.pv(A.SUBSTEP);
const setSub = (g: Game, n: number) => g.m.w32(sub(g), n);
const nextSub = (g: Game, n = 1) => g.m.add32(sub(g), n);

/** Sets the player's step and substep. */
function toStep(g: Game, step: number): void {
  g.m.w32(g.pv(A.STEP), step);
  g.m.w32(sub(g), 0);
}

/** A message panel (image) at (16, y) with the player's palette, uploaded now; then a countdown. */
function message(g: Game, n: number, image: number, y = 0x44): void {
  objectLoad2(g, n, image, 0x10, y);
}

function messageFor(g: Game, n: number, image: number, then: number): void {
  message(g, n, image);
  g.m.w32(g.pv(TIMER), 0x78);
  setSub(g, then);
}

/** FUN_800aeb9c: animStart, uploading the first image now. */
function animStartNow(g: Game, n: number): void {
  if (g.m.s32(A.obj(n) + A.O_ANIM) === 0) return;
  animStart(g, n);
  itemLoad(g, g.m.s32(A.obj(n) + A.O_IMAGE) - 0x10001);
}

/** FUN_800aedfc: animTick, uploading the new image now. */
function animTickNow(g: Game, n: number): void {
  if (animTick(g, n)) itemLoad(g, g.m.s32(A.obj(n) + A.O_IMAGE) - 0x10001);
}

/** FUN_800b6dd4: the port selector (object 0x1A2, animation 0x34 + port) and its prompt. */
function portPrompt(g: Game): void {
  const m = g.m;
  const port = v(g, CARD_PORT);
  objectPut2(g, 0x1a2, 0, port * 0x2e + 0x27, 0x7d);
  const n = g.ob + 0x1a2;
  m.w32(A.obj(n) + A.O_PALETTE, g.p);
  m.w32(A.obj(n) + A.O_ANIM, port + 0x34);
  animStartNow(g, n);
  message(g, 0x1a1, 0x43f, 0x50);
}

/** FUN_800b6ef4: Left/Right choose the port. 1 Cross, 2 Circle, else 0. */
function portInput(g: Game): number {
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
  if (pressed & 0xa000) {
    const port = v(g, CARD_PORT) ^ 1;
    m.w32(g.pv(CARD_PORT), port);
    objectPut2(g, 0x1a2, 0, port * 0x2e + 0x27, 0x7d);
    const n = g.ob + 0x1a2;
    m.w32(A.obj(n) + A.O_ANIM, port + 0x34);
    animStartNow(g, n);
    sePlay(g, 3);
  } else {
    animTickNow(g, g.ob + 0x1a2);
  }
  return 0;
}

/** FUN_800b709c: takes the card for this player; false if it is taken. */
function cardLock(g: Game): boolean {
  const free = g.m.s32(CARD_FLAGS) === 0;
  if (free) g.m.w32(CARD_FLAGS, 1);
  return free;
}

/** FUN_800b7118 */
function cardUnlock(g: Game): void {
  g.m.w32(CARD_FLAGS, 0);
}

/** FUN_800b8918: the three save slots at y, slot `cursor` highlighted: stage or empty or cleared. */
function slotsDraw(g: Game, cursor: number, y: number): void {
  const m = g.m;
  const img = (k: number) => m.s32(SLOT_IMAGES + 4 * k);
  for (let i = 0; i < 3; i++) {
    const saved = m.u8(SLOTS + 2 * i);
    const zones = m.u8(SLOTS + 2 * i + 1);
    const hi = cursor === i ? 1 : 0;
    if (hi) {
      objectPut2(g, 399, 0x4c6, 0x10, i * 0x28 + y - 6);
      m.w32(A.obj(g.ob + 399) + A.O_PALETTE, g.p);
    }
    const row = i * 0x28;
    objectPut2(g, i + 400, i + img(hi), 0x16, row + y);
    const k = i * 4;
    const ty = y + row + 0x14;
    let last = 0;
    if (saved === 0xff) {
      objectPut2(g, k + 0x195, img(hi + 2), 0x41, y + row + 0x13);
      objectPut2(g, k + 0x196, 0, 0x52, ty);
      objectPut2(g, k + 0x197, 0, 0x73, ty);
    } else if ((zones & 0x1f) === 0x1f) {
      objectPut2(g, k + 0x195, img(hi + 4), 0x5a, y + row + 0x13);
      objectPut2(g, k + 0x196, 0, 0x52, ty);
      objectPut2(g, k + 0x197, 0, 0x73, ty);
    } else {
      objectPut2(g, k + 0x195, Math.trunc(saved / 0x14) + img(hi + 6), 0x1b, ty);
      objectPut2(g, k + 0x196, img(hi + 8), 0x50, y + row + 0x13);
      objectPut2(g, k + 0x197, Math.trunc(((saved % 0x14) + 1) / 10) + img(hi + 10), 0x73, ty);
      last = ((saved + 1) % 10) + img(hi + 10);
    }
    objectPut2(g, k + 0x198, last, 0x7b, ty);
  }
}

/**
 * Up/Down move the slot cursor (0-2, wrapping) and redraw the slots at y. The Continue screen
 * (FUN_8009B61C) takes both on one frame; the save screen (FUN_8009C628) only one, Up first.
 */
function slotMove(g: Game, y: number, both: boolean): void {
  const m = g.m;
  const pressed = g.pressed();
  const a = g.pv(SLOT_CURSOR);
  for (const [bit, d] of [[0x1000, -1], [0x4000, 1]] as const) {
    if (!(pressed & bit)) continue;
    let c = m.s32(a) + d;
    if (c < 0) c = 2;
    if (c > 2) c = 0;
    m.w32(a, c);
    slotsDraw(g, c, y);
    sePlay(g, 3);
    if (!both) return;
  }
}

/** FUN_800b921c / FUN_800b8c78: a yes/no prompt (yes chosen first... cursor 1 = no). */
function yesNoStart(g: Game, x: number, y: number, prompt: number, px: number, py: number): void {
  const m = g.m;
  m.w32(g.pv(YES_NO), 1);
  objectPut2(g, 0x1a2, 0, x, y);
  const n = g.ob + 0x1a2;
  m.w32(A.obj(n) + A.O_ANIM, v(g, YES_NO) + 0x36);
  animStart(g, n);
  objectPut2(g, 0x1a1, prompt, px, py);
}

/** FUN_800b9334 / FUN_800b8d80: Left/Right toggle; 1 yes, 2 no or Circle, else 0. */
function yesNoInput(g: Game, x0: number, dx: number, y: number): number {
  const m = g.m;
  const pressed = g.pressed();
  if (pressed & 0x40) {
    sePlay(g, 0);
    if (v(g, YES_NO) === 0) return 1;
    if (v(g, YES_NO) === 1) return 2;
  }
  if (pressed & 0x20) {
    sePlay(g, 0x12);
    return 2;
  }
  if (pressed & 0xa000) {
    const c = v(g, YES_NO) ^ 1;
    m.w32(g.pv(YES_NO), c);
    objectPut2(g, 0x1a2, 0, c * dx + x0, y);
    const n = g.ob + 0x1a2;
    m.w32(A.obj(n) + A.O_ANIM, c + 0x36);
    animStart(g, n);
    sePlay(g, 3);
  } else {
    animTick(g, g.ob + 0x1a2);
  }
  return 0;
}

/** VSync(90) before a card access: the picture holds for 90 vblanks; logic ticks don't run. */
function cardWait(g: Game): void {
  g.stall += 90;
}

// ---- the menu's Continue (FUN_800a86e8 -> FUN_8009aec0, table 0x8009417C) ----

const CONTINUE: ((g: Game) => void)[] = [
  // 0 (0x8009AF70): the panel, the three slots' frames, the port prompt.
  (g) => {
    const m = g.m;
    objectLoad2(g, 0x1e, 0x407, 0, 8);
    objectPut2(g, 0x186, 4, 0x22, 0x12);
    objectPut2(g, 0x187, 0x3c7, 0x1b, 0x32);
    objectPut2(g, 0x18b, 0, 0xe, 0x51);
    m.w32(A.obj(g.ob + 0x18b) + A.O_ANIM, 0x33);
    for (let i = 0; i < 3; i++) objectPut2(g, i + 400, i + 0x3cc, 0x16, i * 0x28 + 0x6c);
    m.w32(g.pv(CARD_PORT), 0);
    m.w32(g.pv(SLOT_CURSOR), -1);
    portPrompt(g);
    nextSub(g);
  },
  // 1 (0x8009B104): choose the port; Circle back to the menu.
  (g) => {
    const r = portInput(g);
    if (r === 1) nextSub(g);
    else if (r === 2) toStep(g, 0);
  },
  // 2 (0x8009B1B4): take the card, or say the other player has it.
  (g) => {
    if (cardLock(g)) {
      nextSub(g);
      return;
    }
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    objectLoad2(g, 0x1a1, 0x4d3, 0xd, 99);
    g.m.w32(g.pv(TIMER), 0x78);
    setSub(g, 10);
  },
  // 3 (0x8009B290): check the card.
  (g) => {
    const m = g.m;
    cardWait(g);
    m.w32(CARD_PORT_CUR, v(g, CARD_PORT));
    const r = cardCheck(g);
    m.w32(CARD_RESULT, r);
    if (r === 1) {
      nextSub(g);
      return;
    }
    if (r === 2) return; // a new card: check again next frame
    continueError(g, r === 0 ? 0x440 : r === 3 ? 0x441 : 0x442);
  },
  // 4 (0x8009B444): load the file; take its save slots.
  (g) => {
    if (!cardLoad(g)) {
      continueError(g, 0x441);
      return;
    }
    cardToState(g, 4);
    nextSub(g);
  },
  // 5 (0x8009B574): show the slots.
  (g) => {
    for (const n of [0x1a1, 0x1a2, 0x1a3]) objectClear(g, g.ob + n);
    slotsDraw(g, 0, 0x6c);
    itemLoad(g, 0x4c5);
    g.m.w32(g.pv(SLOT_CURSOR), 0);
    nextSub(g);
  },
  // 6 (0x8009B61C): choose a slot; Circle back to the menu (the card's best times are kept).
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x20) {
      sePlay(g, 0x12);
      cardToState(g, 1);
      const o = A.obj(g.ob + 399);
      m.w32(o + A.O_SCALE_Y, 0);
      m.w32(o + A.O_SCALE_X, 0);
      cardUnlock(g);
      toStep(g, 0);
      return;
    }
    if (pressed & 0x40) {
      const slot = SLOTS + 2 * v(g, SLOT_CURSOR);
      m.w32(g.pv(V.SAVED_STAGE), m.u8(slot));
      m.w32(g.pv(V.ZONES_CLEARED), m.u8(slot + 1));
      sePlay(g, 0);
      nextSub(g);
      return;
    }
    slotMove(g, 0x6c, true);
    animTick(g, g.ob + 0x18b);
  },
  // 7 (0x8009B910): an empty slot starts a new game, a saved one continues.
  (g) => {
    cardUnlock(g);
    toStep(g, v(g, V.SAVED_STAGE) === 0xff ? 5 : 6);
  },
  // 8 (0x8009B9C4): the message shows for 120 frames, then the port prompt again.
  (g) => {
    if (g.m.add32(g.pv(TIMER), -1) < 1) {
      objectClear(g, g.ob + 0x1a1);
      cardUnlock(g);
      setSub(g, 0);
    }
  },
  // 9 (0x8009BA48)
  (g) => {
    g.m.add32(g.pv(A.STEP), 1);
    setSub(g, 0);
  },
  // 10 (0x8009BA94): "in use" shows for 120 frames.
  (g) => {
    if (g.m.add32(g.pv(TIMER), -1) < 1) {
      objectClear(g, g.ob + 0x1a1);
      setSub(g, 0);
    }
  },
];

/** The Continue screen's error message (0x440 no card, 0x441 no file / not formatted, 0x442 error). */
function continueError(g: Game, image: number): void {
  message(g, 0x1a1, image);
  objectClear(g, g.ob + 0x1a2);
  objectClear(g, g.ob + 0x1a3);
  g.m.w32(g.pv(TIMER), 0x78);
  setSub(g, 8);
}

export function menuContinue(g: Game): void {
  CONTINUE[g.m.s32(sub(g))]?.(g);
}

// ---- the save screen's card steps (screen 13, table 0x800941A8 from substep 4) ----

const nop = () => {};

/** Substeps 6, 33, 35 (0x8009C328): the message's countdown, then the next substep. */
function messageWait(g: Game): void {
  if (g.m.add32(g.pv(TIMER), -1) < 1) {
    objectClear(g, g.ob + 0x1a4);
    nextSub(g);
  }
}

/** FUN_8009CEA8: the format prompt. */
function formatPrompt(g: Game): void {
  yesNoStart(g, 0x59, 0x92, 0x445, 0x12, 0x50);
  g.m.w32(A.obj(g.ob + 0x1a1) + A.O_PALETTE, g.p);
  itemLoad(g, 0x444);
  nextSub(g);
}

/** FUN_8009CF00: yes formats (after checking the card again), no goes back. */
function formatAnswer(g: Game): void {
  const m = g.m;
  const r = yesNoInput(g, 0x30, 0x29, 0x92);
  m.w32(CARD_RESULT, r);
  if (r === 1) {
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    const c = cardCheck(g);
    m.w32(CARD_RESULT, c);
    if (c === 3) {
      message(g, 0x1a4, 0x446);
      nextSub(g);
      return;
    }
    messageFor(g, 0x1a4, 0x447, 6);
  } else if (r === 2) {
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    setSub(g, 7);
  }
}

/** FUN_8009D13C: format. */
function formatRun(g: Game): void {
  const r = cardFormat(g);
  g.m.w32(CARD_RESULT, r);
  if (r === 0) {
    messageFor(g, 0x1a4, 0x447, 6);
    return;
  }
  objectClear(g, g.ob + 0x1a4);
  nextSub(g);
}

/** "Saving" (0x44A) with the selectors cleared. */
function savingMessage(g: Game, clear: number[]): void {
  message(g, 0x1a4, 0x44a);
  for (const n of clear) objectClear(g, g.ob + n);
}

const SAVE_CARD: ((g: Game) => void)[] = [
  // 4 (0x8009C108): take the card, or say the other player has it.
  (g) => {
    if (cardLock(g)) {
      nextSub(g);
      return;
    }
    objectLoad2(g, 0x1a4, 0x4d3, 0x15, 99);
    g.m.w32(g.pv(TIMER), 0x78);
    setSub(g, 0x21);
  },
  // 5 (0x8009C1C4): check the card.
  (g) => {
    const m = g.m;
    cardWait(g);
    m.w32(CARD_PORT_CUR, v(g, CARD_PORT));
    const r = cardCheck(g);
    m.w32(CARD_RESULT, r);
    if (r === 1) setSub(g, 8);
    else if (r === 3) setSub(g, 0x1c);
    else if (r !== 2) {
      objectLoad2(g, 0x1a4, r === 0 ? 0x440 : 0x444, 0x10, 0x44);
      m.w32(g.pv(TIMER), 0x78);
      setSub(g, 6);
    }
  },
  // 6 (0x8009C328)
  messageWait,
  // 7 (0x8009C3B4): give the card back; the options again.
  (g) => {
    cardUnlock(g);
    setSub(g, 1);
  },
  // 8 (0x8009C400): load the file; without one, see whether a new one fits.
  (g) => {
    if (!cardLoad(g)) {
      setSub(g, 0x1a);
      return;
    }
    cardToState(g, 4);
    nextSub(g);
  },
  // 9 (0x8009C49C): the slot screen.
  (g) => {
    const m = g.m;
    objectClear(g, g.ob + 0x194);
    for (let i = 0; i < 6; i++) objectClear(g, i + g.ob + 0x196);
    objectPut2(g, 0xd2, m.s32(0x80094240 + 4 * v(g, CARD_PORT)), 0x17, 0x16);
    objectPut2(g, 0xd3, 0x3b0, 0x2d, 0xd4);
    objectPut2(g, 0xd4, 0, 0x11, 0x41);
    m.w32(A.obj(g.ob + 0xd4) + A.O_ANIM, 0x33);
    animStart(g, g.ob + 0xd4);
    objectClear(g, g.ob + 0xd5);
    objectClear(g, g.ob + 0xd6);
    slotsDraw(g, 0, 0x5d);
    itemLoad(g, 0x4c5);
    m.w32(g.pv(SLOT_CURSOR), 0);
    nextSub(g);
  },
  // 10 (0x8009C628): choose a slot; a used one asks to overwrite.
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x20) {
      sePlay(g, 0x12);
      for (let i = -1; i < 0x15; i++) objectClear(g, i + g.ob + 400);
      setSub(g, 7);
      return;
    }
    if (pressed & 0x40) {
      sePlay(g, 0);
      objectClear(g, g.ob + 399);
      if (m.s8(SLOTS + 2 * v(g, SLOT_CURSOR)) !== -1) {
        yesNoStart(g, 0x5a, v(g, SLOT_CURSOR) * 0x28 + 0x69, 0x4c7, 0xe, v(g, SLOT_CURSOR) * 0x28 + 0x59);
        nextSub(g);
        return;
      }
      if (m.s32(CARD_FLAGS) & 0x10) {
        setSub(g, 0x18);
        return;
      }
      savingMessage(g, [0x1a1, 0x1a2, 0x1a6]);
      nextSub(g, 2);
      return;
    }
    slotMove(g, 0x5d, false);
    animTick(g, g.ob + 0xd4);
  },
  // 11 (0x8009C9DC): overwrite? yes saves, no back to the slots.
  (g) => {
    const r = yesNoInput(g, 0x25, 0x35, v(g, SLOT_CURSOR) * 0x28 + 0x69);
    if (r === 1) {
      g.m.w32(g.pv(TIMER), 2);
      setSub(g, 0x25);
    } else if (r === 2) {
      itemLoad(g, 0x4c5);
      slotsDraw(g, v(g, SLOT_CURSOR), 0x5d);
      objectClear(g, g.ob + 0x1a1);
      objectClear(g, g.ob + 0x1a2);
      nextSub(g, -1);
    }
  },
  // 12 (0x8009CAF0)
  (g) => nextSub(g),
  // 13 (0x8009CB68): the game into the slot, the slots and best times into the file, write it.
  (g) => {
    const m = g.m;
    const slot = SLOTS + 2 * v(g, SLOT_CURSOR);
    m.w8(slot, v(g, V.SAVED_STAGE));
    m.w8(slot + 1, v(g, V.ZONES_CLEARED));
    stateToCard(g, v(g, SLOT_CURSOR) + 5);
    stateToCard(g, 1);
    if (cardRewrite(g) === 0) {
      messageFor(g, 0x1a4, 0x44b, 6);
      return;
    }
    nextSub(g);
  },
  // 14 (0x8009CD48)
  (g) => {
    for (const n of [0x1a1, 0x1a2, 0x1a3, 0x1a4]) objectClear(g, g.ob + n);
    cardUnlock(g);
    nextSub(g);
  },
  // 15 (0x8009CDE0): done: the player leaves (screen 8).
  (g) => toScreen(g, 8),
  // 16 (0x8009CE38)
  (g) => toScreen(g, 1),
  nop, nop, nop,
  // 20 (0x8009CEA8)
  formatPrompt,
  // 21 (0x8009CF00)
  formatAnswer,
  // 22 (0x8009D100)
  (g) => nextSub(g),
  // 23 (0x8009D13C)
  formatRun,
  // 24 (0x8009D25C): check the card again before making the file.
  (g) => {
    const m = g.m;
    const r = cardCheck(g);
    m.w32(CARD_RESULT, r);
    if (r === 1) {
      savingMessage(g, [0x1a2, 0x1a6]);
      nextSub(g);
      m.w32(g.pv(TIMER), 3);
      return;
    }
    messageFor(g, 0x1a4, 0x44b, 6);
  },
  // 25 (0x8009D404): after 3 frames, make the file; then the slot is written as an overwrite.
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(TIMER), -1) >= 1) return;
    const r = cardCreate(g);
    m.w32(CARD_RESULT, r);
    if (r === 0) nextSub(g);
    else setSub(g, 0xd);
  },
  // 26 (0x8009D4C8): no file: room for one (under 15 blocks used)?
  (g) => {
    const r = cardBlocksUsed(g);
    g.m.w32(CARD_RESULT, r);
    if (r < 0xf) setSub(g, 0x20);
    else messageFor(g, 0x1a4, 0x448, 6);
  },
  nop,
  // 28 (0x8009CEA8): not formatted: offer to format.
  formatPrompt,
  // 29
  formatAnswer,
  // 30
  (g) => nextSub(g),
  // 31
  formatRun,
  // 32 (0x8009D5F8): a fresh file's contents; its empty slots; mark the file new.
  (g) => {
    cardDefaults(g);
    cardToState(g, 4);
    g.m.w32(CARD_FLAGS, g.m.s32(CARD_FLAGS) | 0x10);
    setSub(g, 9);
  },
  // 33 (0x8009C328)
  messageWait,
  // 34 (0x8009D66C)
  (g) => setSub(g, 1),
  // 35 (0x8009C328)
  messageWait,
  // 36 (0x8009D6A8)
  nop,
  // 37 (0x8009D6B0): after the overwrite prompt, check the card and write.
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(TIMER), -1) >= 1) return;
    if (cardCheck(g) === 1) {
      savingMessage(g, [0x1a1, 0x1a2, 0x1a6]);
      setSub(g, 0xc);
    } else {
      messageFor(g, 0x1a4, 0x44b, 6);
    }
  },
];

function toScreen(g: Game, screen: number): void {
  const m = g.m;
  m.w32(g.pv(A.SCREEN), screen);
  m.w32(g.pv(A.STEP), 0);
  m.w32(sub(g), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** Screen 13 substeps 4-37. */
export function saveCard(g: Game, s: number): void {
  SAVE_CARD[s - 4]?.(g);
}
