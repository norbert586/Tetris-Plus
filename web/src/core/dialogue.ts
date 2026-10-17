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
const FIRST_CHAR_OBJ = 0x37;
const PROMPT_OBJ = 0x9a;

/** Starts message `n` from text origin `box`, `pages` messages long. */
export function dialogueStart(g: Game, n: number, box = 0, pages = 0): void {
  const m = g.m;
  m.w32(g.pv(DLG_MESSAGE), n);
  m.w32(g.pv(DLG_STATE), 0);
  m.w32(g.pv(DLG_BOX), box);
  m.w32(g.pv(DLG_PAGES), pages);
}

/** Runs the text box one frame. Returns true once the text has ended. */
export function dialogueRun(g: Game): boolean {
  switch (g.m.s32(g.pv(DLG_STATE))) {
    case 0: return dlgInit(g);
    case 1: return dlgType(g);
    case 2: return dlgWait(g);
    case 3: return dlgClose(g);
  }
  throw new Error('bad dialogue state');
}

/** 0x800BA208 */
function dlgInit(g: Game): boolean {
  const m = g.m;
  for (let i = 0; i < 100; i++) objectClear(g, FIRST_CHAR_OBJ + i + g.ob);
  const box = m.s32(g.pv(DLG_BOX));
  m.w32(g.pv(DLG_X), m.s32(ORIGINS + box * 8));
  m.w32(g.pv(DLG_Y), m.s32(ORIGINS + box * 8 + 4));
  m.w32(g.pv(DLG_POS), 0);
  m.w32(g.pv(DLG_CHARS), 0);
  m.w32(g.pv(DLG_TIMER), 2);
  m.add32(g.pv(DLG_STATE), 1);
  return false;
}

const word = (g: Game, k: number) =>
  g.m.u32(g.m.u32(MESSAGES + 4 * g.m.s32(g.pv(DLG_MESSAGE))) + 4 * k);

/** Writes one character object at the pen and advances the object count. */
function putChar(g: Game, image: number, dx: number): void {
  const m = g.m;
  const p = g.p;
  const n = g.ob + FIRST_CHAR_OBJ + m.s32(g.pv(DLG_CHARS));
  const o = A.obj(n);
  m.w32(o + A.O_IMAGE, image + 0x10000);
  m.w32(o + A.O_X, dx + m.s32(g.pv(DLG_X)) + p * 0x100000);
  m.w32(o + A.O_Y, m.s32(g.pv(DLG_Y)));
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 4);
}

/** 0x800BA320: one character every 2 frames (every frame with Cross held). */
function dlgType(g: Game): boolean {
  const m = g.m;
  if (g.held() & 0x40) m.w32(g.pv(DLG_TIMER), 0);
  if (m.add32(g.pv(DLG_TIMER), -1) >= 1) return false;
  m.w32(g.pv(DLG_TIMER), 2);
  const pos = m.s32(g.pv(DLG_POS));
  let w = word(g, pos);
  if (w === 0xffffffff) {
    const next = word(g, pos + 1);
    const prompt = g.ob + PROMPT_OBJ;
    const o = A.obj(prompt);
    if (next === 0x33333333) {
      m.w32(o + A.O_X, (g.p * 5 + 0x91) * 0x10000);
      m.w32(o + A.O_Y, 0xd10000);
      m.w32(o + A.O_ANIM, 0x1b);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 4);
    } else if (next === 0x44444444) {
      m.w32(o + A.O_X, 0x910000);
      m.w32(o + A.O_Y, 0xcf0000);
      m.w32(o + A.O_ANIM, 0x1b);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 2);
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
    putChar(g, (w & 0xfffffff) + m.s32(FONT_BASE + 5 * 4), -0x20000);
    m.add32(g.pv(DLG_X), 0xc0000);
    m.add32(g.pv(DLG_POS), 1);
    m.add32(g.pv(DLG_CHARS), 1);
    w = word(g, m.s32(g.pv(DLG_POS)));
    dx = -0x20000;
  }
  putChar(g, (w & 0xfffffff) + m.s32(FONT_BASE + ((w >>> 0x1a) & 0x3c)), dx);
  if ((w & 0xf0000000) >>> 0 === 0x50000000) m.add32(g.pv(DLG_X), 0xe0000);
  else m.add32(g.pv(DLG_X), 0x90000);
  m.add32(g.pv(DLG_POS), 1);
  m.add32(g.pv(DLG_CHARS), 1);
  return false;
}

/** 0x800BAA94: the prompt blinks; Cross (or the timer, if one was set) goes on. */
function dlgWait(g: Game): boolean {
  const m = g.m;
  animTick(g, g.ob + PROMPT_OBJ);
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

/** 0x800BABF4 */
function dlgClose(g: Game): boolean {
  objectClear(g, g.ob + PROMPT_OBJ);
  return true;
}
