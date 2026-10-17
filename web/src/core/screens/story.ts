// Screen 2: the zone's story scene (story_step_dispatch, scenes FUN_800BAC9C). Pictures and the
// assistant's lines; Start skips the rest. Scenes 0-3 are the first four zones, 4 Atlantis, 5 the
// how-to-play lines after a new game's first scene, 6 the skip. Every scene step is one
// function in the original; the builders below reproduce each one's effects.
import * as A from '../addr';
import type { Game } from '../game';
import { dialogueRun, dialogueStart } from '../dialogue';
import { objectClear, objectFadeBox, objectFadeDown, objectFadeUp, objectsClear } from '../objects';
import { bgmRequest } from '../sound';
import * as V from '../vars';

export const SCENE = 0x800ee470; // [2]
export const SCENE_STEP = 0x800ee9ac; // [2]
const T1 = 0x800edc78; // [2] scene timer
const T2 = 0x800edc88; // [2] second timer (scrolling, blinking)
const MARKER_POS = 0x80094b0c; // two (x, y) per player

type Step = (g: Game) => boolean;

export function scr02Story(g: Game): void {
  const m = g.m;
  switch (m.s32(g.pv(A.STEP))) {
    case 0:
      objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
      m.w32(g.pv(SCENE), m.s32(g.pv(V.ZONE)));
      m.w32(g.pv(SCENE_STEP), 0);
      m.add32(g.pv(A.STEP), 1);
      return;
    case 1:
      if (storyRun(g)) m.add32(g.pv(A.STEP), 1);
      return;
    case 2:
    case 3:
    case 4:
      m.add32(g.pv(A.STEP), 1);
      return;
    case 5:
      m.w32(g.pv(V.STAGE), 0);
      m.w32(g.pv(A.SCREEN), 3);
      m.w32(g.pv(A.STEP), 0);
      m.w32(g.pv(A.SUBSTEP), 0);
      m.w32(g.pv(A.STEP4), 0);
      return;
  }
}

/** FUN_800BAC9C: Start skips (FUN_800BAC20), then the scene's current step. */
export function storyRun(g: Game): boolean {
  const m = g.m;
  if (g.pressed() & 0x800 && m.s32(g.pv(SCENE_STEP)) !== 0) {
    m.w32(g.pv(SCENE), 6);
    m.w32(g.pv(SCENE_STEP), 0);
  }
  return SCENES[m.s32(g.pv(SCENE))][m.s32(g.pv(SCENE_STEP))](g);
}

const next = (g: Game) => g.m.add32(g.pv(SCENE_STEP), 1);

/** Object 0x32 (+ player) shows `image` at (0, y): the scene's picture. */
function picture(g: Game, image: number, y: number): void {
  const m = g.m;
  const o = A.obj(g.ob + 0x32);
  m.w32(o + A.O_IMAGE, image);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, y);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 2);
  m.w32(o + A.O_PALETTE, g.p);
}

/** FUN_800BFE94: the frame above and below the picture. */
function frame(g: Game): void {
  const m = g.m;
  let o = A.obj(g.ob + 0x34);
  m.w32(o + A.O_IMAGE, 0x103a9);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0x80000);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 2);
  o = A.obj(g.ob + 0x35);
  m.w32(o + A.O_IMAGE, 0x103aa);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0x880000);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 2);
}

/** A scene's first step: picture (with a scrolling strip if `strip`), text, music 0x26. */
const open = (image: number, msg: number, pages: number, strip: boolean): Step => (g) => {
  const m = g.m;
  objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
  frame(g);
  picture(g, image, strip ? 0x80000 : 0x280000);
  if (strip) {
    const o = A.obj(g.ob + 0x33);
    m.w32(o + A.O_IMAGE, 0x10203);
    m.w32(o + A.O_X, 0);
    m.w32(o + A.O_Y, 0x880000);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 2);
    m.w32(o + A.O_PALETTE, g.p);
  }
  dialogueStart(g, msg, 0, pages);
  next(g);
  m.w32(g.pv(T1), 0x3c);
  m.w32(g.pv(T2), 4);
  bgmRequest(g, 0x26);
  return false;
};

/** The picture moves down a pixel every 5 frames while the strip rises a pixel a frame. */
function scroll(g: Game): void {
  const m = g.m;
  if (m.add32(g.pv(T2), -1) < 0) {
    m.add32(A.obj(g.ob + 0x32) + A.O_Y, 0x10000);
    m.w32(g.pv(T2), 4);
  }
  m.add32(A.obj(g.ob + 0x33) + A.O_Y, -0x10000);
}

/** FUN_800BAF9C: scroll for 61 frames. */
const scrollWait: Step = (g) => {
  scroll(g);
  if (g.m.add32(g.pv(T1), -1) < 0) next(g);
  return false;
};

/** FUN_800BB090: scroll with the text running, until the strip reaches y = 40. */
const scrollText: Step = (g) => {
  scroll(g);
  if (dialogueRun(g)) next(g);
  if (g.m.s32(A.obj(g.ob + 0x33) + A.O_Y) === 0x280000) next(g);
  return false;
};

/** The text runs; next step when it ends. */
const text: Step = (g) => {
  if (dialogueRun(g)) next(g);
  return false;
};

/** A new picture and text. */
const page = (image: number, msg: number, pages: number, clearStrip: boolean): Step => (g) => {
  dialogueStart(g, msg, 0, pages);
  if (clearStrip) objectClear(g, g.ob + 0x33);
  picture(g, image, 0x280000);
  next(g);
  return false;
};

/** Text, then on a new game the how-to-play lines (scene 5), else on. */
const textThenHowTo: Step = (g) => {
  const m = g.m;
  if (dialogueRun(g)) {
    if (m.s32(g.pv(V.ZONES_CLEARED)) === 0) {
      m.w32(g.pv(SCENE_STEP), 0);
      m.w32(g.pv(SCENE), 5);
    } else {
      m.w32(g.pv(T1), -1);
      next(g);
    }
  }
  return false;
};

/** Text, then on. */
const textEnd: Step = (g) => {
  if (dialogueRun(g)) {
    g.m.w32(g.pv(T1), -1);
    next(g);
  }
  return false;
};

/** Starts the fade-out box (object 0x36); `resetT1` also zeroes the timer. */
const fadeOut = (box: boolean, resetT1: boolean): Step => (g) => {
  if (box) objectFadeBox(g, g.ob + 0x36, 0x40, -2);
  if (resetT1) g.m.w32(g.pv(T1), 0);
  next(g);
  return false;
};

/** The fade runs on even frames until it ends. */
const fadeWait: Step = (g) => {
  if ((g.counter & 1) === 0 && objectFadeDown(g, g.ob + 0x36)) next(g);
  return false;
};

const skip: Step = (g) => {
  next(g);
  return false;
};

/** The scene's last step. */
const finish: Step = (g) => {
  g.m.w32(g.pv(SCENE_STEP), 0);
  return true;
};

/** Back to scene 0 and done (scenes 5 and 6). */
const finishReset: Step = (g) => {
  g.m.w32(g.pv(SCENE), 0);
  g.m.w32(g.pv(SCENE_STEP), 0);
  return true;
};

const unreachable: Step = () => {
  throw new Error('story: unreachable scene step');
};

// ---- Atlantis (scene 4) ----

/** FUN_800BCE18 */
const atlantisOpen: Step = (g) => {
  const m = g.m;
  m.w32(A.obj(g.ob + 0x36) + A.O_KIND, 0);
  picture(g, 0x1020d, 0x280000);
  frame(g);
  dialogueStart(g, 0x52, 0, 5);
  next(g);
  m.w32(g.pv(T1), 0x3c);
  bgmRequest(g, 0x10);
  return false;
};

/** FUN_800BD0A8: text, then a white fade (kind -3). */
const textThenWhite: Step = (g) => {
  if (dialogueRun(g)) {
    objectFadeBox(g, g.ob + 0x36, 0x40, -3);
    next(g);
  }
  return false;
};

/** FUN_800BD114: fade on frames where counter & 4 is 0; then the map frame. */
const atlantisFadeIn: Step = (g) => {
  const m = g.m;
  if ((g.counter & 4) === 0 && objectFadeDown(g, g.ob + 0x36)) {
    objectClear(g, g.ob + 0x32);
    const o = A.obj(g.ob + 0xde);
    m.w32(o + A.O_IMAGE, 0x1012d);
    m.w32(o + A.O_X, (g.p * 0xa4 + 2) * 0x10000);
    m.w32(o + A.O_Y, 0x280000);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 0);
    next(g);
  }
  return false;
};

/** FUN_800BD208 */
const atlantisFadeOut: Step = (g) => {
  const m = g.m;
  if ((g.counter & 4) === 0 && objectFadeUp(g, g.ob + 0x36)) {
    m.w32(g.pv(T1), 0x20);
    m.w32(g.pv(T2), 0xc0);
    next(g);
  }
  return false;
};

/** FUN_800BD2AC: the marker blinks for 192 frames, after 33. */
const atlantisMarker: Step = (g) => {
  const m = g.m;
  if (m.add32(g.pv(T2), -1) < 0) {
    objectClear(g, g.ob + 0xdf);
    next(g);
  } else if (m.add32(g.pv(T1), -1) < 0) {
    const o = A.obj(g.ob + 0xdf);
    m.w32(o + A.O_IMAGE, ((g.counter & 4) >>> 2) + 0x10131);
    m.w32(o + A.O_X, m.s32(MARKER_POS + g.p * 8));
    m.w32(o + A.O_Y, m.s32(MARKER_POS + g.p * 8 + 4));
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 0);
  }
  return false;
};

/** FUN_800BD400 */
const atlantisClearFrame: Step = (g) => {
  if (objectFadeDown(g, g.ob + 0x36)) {
    objectClear(g, g.ob + 0xde);
    next(g);
  }
  return false;
};

/** FUN_800BD56C */
const atlantisMusic: Step = (g) => {
  if (objectFadeUp(g, g.ob + 0x36)) {
    bgmRequest(g, 0x11);
    next(g);
  }
  return false;
};

/** A new picture and text without touching the strip (scene 4 pages). */
const pageNoClear = (image: number, msg: number, pages: number) => page(image, msg, pages, false);

// ---- How to play (scene 5) ----

/** FUN_800BDBEC: 60 frames or Cross. */
const howToWait: Step = (g) => {
  if (g.m.add32(g.pv(T1), -1) < 0 || g.pressed() & 0x40) next(g);
  return false;
};

/** FUN_800BDC74 */
const howToOpen: Step = (g) => {
  picture(g, 0x103ab, 0x280000);
  dialogueStart(g, 0x18, 0, 4);
  next(g);
  g.m.w32(g.pv(T1), 0x3c);
  return false;
};

/** FUN_800BDBA4 */
const howToStart: Step = (g) => {
  g.m.w32(g.pv(T1), -1);
  next(g);
  return false;
};

const SCENES: Step[][] = [
  // 0 Egypt
  [
    open(0x101f7, 0x1c, 2, true), scrollWait, scrollText, text, page(0x101f9, 0x1f, 3, true), text,
    page(0x101fa, 0x22, 2, false), textThenHowTo, fadeOut(true, false), fadeWait, finish, unreachable,
  ],
  // 1 Angkor Wat
  [
    open(0x10208, 0x45, 3, false), text, page(0x10209, 0x48, 3, true), text, page(0x1020a, 0x4b, 2, true),
    textThenHowTo, fadeOut(true, true), fadeWait, skip, skip, finish, unreachable,
  ],
  // 2 Maya
  [
    open(0x10202, 0x36, 3, true), scrollWait, scrollText, text, page(0x10204, 0x39, 2, true), text,
    page(0x10205, 0x3b, 2, false), textThenHowTo, fadeOut(true, true), fadeWait, finish, unreachable,
  ],
  // 3 Knossos
  [
    open(0x101fd, 0x2c, 2, false), text, page(0x101fe, 0x2e, 2, true), text, page(0x101ff, 0x30, 2, true),
    textThenHowTo, fadeOut(false, true), fadeWait, skip, skip, finish, unreachable,
  ],
  // 4 Atlantis
  [
    atlantisOpen, text, pageNoClear(0x1020e, 0x57, 3), textThenWhite, atlantisFadeIn, atlantisFadeOut,
    atlantisMarker, atlantisClearFrame, pageNoClear(0x1020f, 0x5a, 4), atlantisMusic, text,
    pageNoClear(0x10210, 0x5e, 3), text, pageNoClear(0x10211, 0x61, 2), text, pageNoClear(0x10212, 99, 2),
    textEnd, fadeOut(true, false), fadeWait, () => true,
  ],
  // 5 How to play (after a new game's first scene)
  [howToStart, howToWait, howToOpen, textEnd, fadeOut(true, true), fadeWait, finishReset],
  // 6 Skipped with Start
  [finishReset, unreachable, unreachable, unreachable],
];
