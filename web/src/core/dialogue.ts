// Text boxes (FUN_800BA188): the assistant's and the professor's lines on the map, in the
// story scenes and on the zone-clear screens. Characters appear one every 2 frames, or one per
// frame while Cross is held; each is a sprite object. Message n's text is a list of words at
// table 0x800E70EC[n]: a character (image index, top nibble = font), 0xF0000000 a space,
// 0xFFFFFFFE a new line, 0xFFFFFFFF the end (followed by 0x33333333 "more" or 0x44444444
// "last" for a page that waits for Cross).
import * as A from './addr';
import type { Game } from './game';
import { animSet, animTick, objectClear } from './objects';

export const DLG_STATE = 0x800ee6e0; // [2]
export const DLG_MESSAGE = 0x800f35ec; // [2] message number
export const DLG_BOX = 0x800ee6b8; // [2] text origin (table 0x800E72D4: x, y)
export const DLG_PAGES = 0x800ee6a8; // [2] messages left in this run
const DLG_POS = 0x800ee488; // [2] word index in the message
const DLG_CHARS = 0x800ee568; // [2] character objects used
const DLG_TIMER = 0x800ee6d0; // [2]
const DLG_X = 0x800f3658; // [2] 16.16
const DLG_Y = 0x800f3664; // [2] 16.16
const MESSAGES = 0x800e70ec;
const ORIGINS = 0x800e72d4;
const FONT_BASE = 0x800e3634; // int per font (top nibble)

/**
 * The two text boxes. Box A (FUN_800BA188) is used on the map, in the story scenes and on the
 * zone-clear screens; box B (FUN_800BFF24) in the ending. They differ in where the characters
 * go, which buttons speed them up, the spacing of two-part characters and the prompts.
 */
export interface TextBox {
  firstChar: number; // first of 100 character objects
  fastButtons: number; // held: one character per frame
  wideFirst: number; // pen advance after a two-part character's first half
  wideSecond: number; // and after its second half
  more: { obj: number; x: (p: number) => number; y: number; layer: number }; // 0x33333333
  last: { obj: number; layer: number }; // 0x44444444
  blink: number; // the prompt object animated while waiting
}

export const BOX_A: TextBox = {
  firstChar: 0x37,
  fastButtons: 0x40,
  wideFirst: 0xc0000,
  wideSecond: 0xe0000,
  more: { obj: 0x9a, x: (p) => (p * 5 + 0x91) * 0x10000, y: 0xd10000, layer: 4 },
  last: { obj: 0x9a, layer: 2 },
  blink: 0x9a,
};

export const BOX_B: TextBox = {
  firstChar: 0xca,
  fastButtons: 0x60,
  wideFirst: 0x90000,
  wideSecond: 0x90000,
  more: { obj: 0x12d, x: () => 0x910000, y: 0xcf0000, layer: 4 },
  last: { obj: 0x9a, layer: 4 },
  blink: 0x12d,
};

/** Starts message `n` from text origin `box`, `pages` messages long. */
export function dialogueStart(g: Game, n: number, box = 0, pages = 0): void {
  const m = g.m;
  m.w32(g.pv(DLG_MESSAGE), n);
  m.w32(g.pv(DLG_STATE), 0);
  m.w32(g.pv(DLG_BOX), box);
  m.w32(g.pv(DLG_PAGES), pages);
}

/** Runs the text box one frame. Returns true once the text has ended. */
export function dialogueRun(g: Game, box: TextBox = BOX_A): boolean {
  switch (g.m.s32(g.pv(DLG_STATE))) {
    case 0: return dlgInit(g, box);
    case 1: return dlgType(g, box);
    case 2: return dlgWait(g, box);
    case 3: return dlgClose(g, box);
  }
  throw new Error('bad dialogue state');
}

/** 0x800BA208 / 0x800BFFA4 */
function dlgInit(g: Game, box: TextBox): boolean {
  const m = g.m;
  for (let i = 0; i < 100; i++) objectClear(g, box.firstChar + i + g.ob);
  const origin = m.s32(g.pv(DLG_BOX));
  m.w32(g.pv(DLG_X), m.s32(ORIGINS + origin * 8));
  m.w32(g.pv(DLG_Y), m.s32(ORIGINS + origin * 8 + 4));
  m.w32(g.pv(DLG_POS), 0);
  m.w32(g.pv(DLG_CHARS), 0);
  m.w32(g.pv(DLG_TIMER), 2);
  m.add32(g.pv(DLG_STATE), 1);
  return false;
}

const word = (g: Game, k: number) =>
  g.m.u32(g.m.u32(MESSAGES + 4 * g.m.s32(g.pv(DLG_MESSAGE))) + 4 * k);

/** Writes one character object at the pen and advances the object count. */
function putChar(g: Game, box: TextBox, image: number, dx: number): void {
  const m = g.m;
  const p = g.p;
  const n = g.ob + box.firstChar + m.s32(g.pv(DLG_CHARS));
  const o = A.obj(n);
  m.w32(o + A.O_IMAGE, image + 0x10000);
  m.w32(o + A.O_X, dx + m.s32(g.pv(DLG_X)) + p * 0x100000);
  m.w32(o + A.O_Y, m.s32(g.pv(DLG_Y)));
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 4);
}

/** 0x800BA320 / 0x800C00BC: one character every 2 frames (every frame with the button held). */
function dlgType(g: Game, box: TextBox): boolean {
  const m = g.m;
  if (g.held() & box.fastButtons) m.w32(g.pv(DLG_TIMER), 0);
  if (m.add32(g.pv(DLG_TIMER), -1) >= 1) return false;
  m.w32(g.pv(DLG_TIMER), 2);
  const pos = m.s32(g.pv(DLG_POS));
  let w = word(g, pos);
  if (w === 0xffffffff) {
    const next = word(g, pos + 1);
    let prompt: number;
    if (next === 0x33333333) {
      prompt = g.ob + box.more.obj;
      const o = A.obj(prompt);
      m.w32(o + A.O_X, box.more.x(g.p));
      m.w32(o + A.O_Y, box.more.y);
      m.w32(o + A.O_ANIM, 0x1b);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, box.more.layer);
    } else if (next === 0x44444444) {
      prompt = g.ob + box.last.obj;
      const o = A.obj(prompt);
      m.w32(o + A.O_X, 0x910000);
      m.w32(o + A.O_Y, 0xcf0000);
      m.w32(o + A.O_ANIM, 0x1b);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, box.last.layer);
    } else {
      return true;
    }
    animSet(g, prompt, 0x1b);
    m.add32(g.pv(DLG_POS), 1);
    m.add32(g.pv(DLG_STATE), 1);
    m.w32(g.pv(DLG_TIMER), -1);
    return false;
  }
  if (w === 0xfffffffe) {
    m.w32(g.pv(DLG_X), m.s32(ORIGINS + m.s32(g.pv(DLG_BOX)) * 8));
    m.add32(g.pv(DLG_Y), 0xc0000);
    m.add32(g.pv(DLG_POS), 1);
    return false;
  }
  if (w === 0xf0000000) {
    m.add32(g.pv(DLG_X), 0x90000);
    m.add32(g.pv(DLG_POS), 1);
    m.w32(g.pv(DLG_TIMER), 0);
    return false;
  }
  let dx = 0;
  if ((w & 0xf0000000) >>> 0 === 0x50000000) {
    // A two-object character: its first half, 2 px left of the pen.
    putChar(g, box, (w & 0xfffffff) + m.s32(FONT_BASE + 5 * 4), -0x20000);
    m.add32(g.pv(DLG_X), box.wideFirst);
    m.add32(g.pv(DLG_POS), 1);
    m.add32(g.pv(DLG_CHARS), 1);
    w = word(g, m.s32(g.pv(DLG_POS)));
    dx = -0x20000;
  }
  putChar(g, box, (w & 0xfffffff) + m.s32(FONT_BASE + ((w >>> 0x1a) & 0x3c)), dx);
  if ((w & 0xf0000000) >>> 0 === 0x50000000) m.add32(g.pv(DLG_X), box.wideSecond);
  else m.add32(g.pv(DLG_X), 0x90000);
  m.add32(g.pv(DLG_POS), 1);
  m.add32(g.pv(DLG_CHARS), 1);
  return false;
}

/** 0x800BAA94 / 0x800C07D4: the prompt blinks; Cross (or the timer, if one was set) goes on. */
function dlgWait(g: Game, box: TextBox): boolean {
  const m = g.m;
  animTick(g, g.ob + box.blink);
  const t = m.add32(g.pv(DLG_TIMER), -1);
  if (t !== 0 && !(g.pressed() & 0x40)) return false;
  if (m.add32(g.pv(DLG_PAGES), -1) > 0) {
    m.add32(g.pv(DLG_MESSAGE), 1);
    m.w32(g.pv(DLG_STATE), 0);
    return false;
  }
  m.add32(g.pv(DLG_STATE), 1);
  return false;
}

/** 0x800BABF4 / 0x800C0934 */
function dlgClose(g: Game, box: TextBox): boolean {
  objectClear(g, g.ob + box.blink);
  return true;
}
