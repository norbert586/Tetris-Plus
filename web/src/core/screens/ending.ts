// Screens 10 (zone clear) and 11 (the ending and credits).
import * as A from '../addr';
import type { Game } from '../game';
import { BOX_B, dialogueRun, dialogueStart } from '../dialogue';
import { objectClear, objectFadeBox, objectFadeDown, objectFadeUp } from '../objects';
import { bgmRequest, sePlay, BGM_STOP } from '../sound';
import * as V from '../vars';
import { CONTINUE } from './after';
import { frame, picture, SCENE, SCENE_STEP } from './story';
import { wipe } from './stage';

const WIPE_STATE = 0x800ee964;
const T1 = 0x800edc78;
const T2 = 0x800edc88;
const T3 = 0x800edc90;
const ZONE_BIT = 0x800e1218;
const ITEMS = 0x800eea4c;
const CONTINUE_STEP = 0x800ee560; // [2] the continue screen's step, borrowed
const SAVED_STEP = 0x800ee400;
const SHAKE_DY = 0x80094bd8; // int[4] px
const SHAKE_TIME = 0x80094be8; // int[4] frames

const v = (g: Game, a: number) => g.m.s32(g.pv(a));
const set = (g: Game, a: number, x: number) => g.m.w32(g.pv(a), x);
const nextStep = (g: Game, n = 1) => g.m.add32(g.pv(A.STEP), n);
const nextScene = (g: Game) => g.m.add32(g.pv(SCENE_STEP), 1);
function toScreen(g: Game, screen: number, step = 0): void {
  set(g, A.SCREEN, screen);
  set(g, A.STEP, step);
  set(g, A.SUBSTEP, 0);
  set(g, A.STEP4, 0);
}
/** FUN_800B1CB4: clears objects 0x1E-0x103. */
function clearScene(g: Game): void {
  for (let n = 0x1e + g.p * 400; n < 0x103 + g.p * 400 + 1; n++) objectClear(g, n);
}
/** FUN_800B1CE0: clears the text box's 100 character objects. */
function clearText(g: Game): void {
  for (let i = 0; i < 100; i++) objectClear(g, i + 0x37 + g.ob);
}

// ---- zone-clear scenes (FUN_800BDFE4 on the scene number = zone) ----

type Step = (g: Game) => boolean;

/** A scene's first step: frame, picture, text; the wipe restarts. */
const open = (image: number, msg: number, pages: number, extra: (g: Game) => void): Step => (g) => {
  frame(g);
  picture(g, image, 0x280000);
  dialogueStart(g, msg, 0, pages);
  set(g, WIPE_STATE, 0);
  nextScene(g);
  extra(g);
  return false;
};
const uncover: Step = (g) => {
  if (wipe(g, false)) nextScene(g);
  return false;
};
const text: Step = (g) => {
  if (dialogueRun(g)) nextScene(g);
  return false;
};
const page = (image: number, msg: number, pages: number, music: number | null): Step => (g) => {
  dialogueStart(g, msg, 0, pages);
  objectClear(g, g.ob + 0x33);
  picture(g, image, 0x280000);
  if (music !== null) bgmRequest(g, music);
  nextScene(g);
  return false;
};
/** The fade-out and the end of the scene (on even frames). */
const fadeEnd: Step = (g) => {
  if ((g.counter & 1) === 0 && objectFadeDown(g, g.ob + 0x36)) {
    set(g, SCENE, 0);
    set(g, SCENE_STEP, 0);
    return true;
  }
  return false;
};
const fadeThenClear: Step = (g) => {
  objectFadeBox(g, g.ob + 0x36, 0x40, -2);
  clearText(g);
  nextScene(g);
  return false;
};
const clearThenFade: Step = (g) => {
  clearText(g);
  objectFadeBox(g, g.ob + 0x36, 0x40, -2);
  nextScene(g);
  return false;
};

/** FUN_800BF53C: the picture shakes. */
function shake(g: Game): void {
  const m = g.m;
  if (m.add32(g.pv(T2), -1) < 0) {
    const k = v(g, T1);
    m.add32(A.obj(g.ob + 0x32) + A.O_Y, m.s32(SHAKE_DY + 4 * k) * 0x10000);
    const n = (k + 1) & 3;
    set(g, T1, n);
    set(g, T2, m.s32(SHAKE_TIME + 4 * n));
  }
}

const ZONE_SCENES: Step[][] = [
  // 0 Egypt
  [
    open(0x101fb, 0x24, 2, (g) => { set(g, T1, 0x3c); bgmRequest(g, 0x32); }),
    uncover, text, page(0x101fc, 0x28, 4, 0x33), text, fadeThenClear, fadeEnd,
  ],
  // 1 Angkor Wat
  [
    open(0x1020b, 0x4d, 3, (g) => { set(g, T1, 0x3c); bgmRequest(g, 0x32); }),
    uncover, text, page(0x1020c, 0x50, 2, null), text, clearThenFade, fadeEnd,
  ],
  // 2 Maya
  [
    open(0x10206, 0x3d, 6, (g) => { set(g, T1, 0x3c); bgmRequest(g, 0x32); }),
    uncover, text,
    (g) => {
      if (g.m.add32(g.pv(T1), -1) < 0) page(0x10207, 0x43, 2, 0x33)(g);
      return false;
    },
    (g) => {
      if (dialogueRun(g)) {
        set(g, T1, -1);
        nextScene(g);
      }
      return false;
    },
    fadeThenClear, fadeEnd,
  ],
  // 3 Knossos: the picture shakes
  [
    open(0x10200, 0x32, 2, (g) => { set(g, T1, 0); set(g, T2, 0); bgmRequest(g, BGM_STOP); sePlay(g, 0x15); }),
    uncover,
    (g) => {
      shake(g);
      if (dialogueRun(g)) {
        objectFadeBox(g, g.ob + 0x36, 0x40, -2);
        nextScene(g);
      }
      return false;
    },
    (g) => {
      shake(g);
      nextScene(g);
      return false;
    },
    (g) => {
      shake(g);
      if ((g.counter & 1) === 0 && objectFadeDown(g, g.ob + 0x36)) nextScene(g);
      return false;
    },
    page(0x10201, 0x34, 2, 0x33),
    (g) => {
      if (objectFadeUp(g, g.ob + 0x36)) nextScene(g);
      return false;
    },
    text,
    (g) => {
      clearText(g);
      nextScene(g);
      return false;
    },
    fadeEnd,
  ],
  // 4 Atlantis
  [
    open(0x10213, 0x65, 3, (g) => { set(g, T1, 0x3c); bgmRequest(g, 0x20); }),
    uncover,
    (g) => {
      if (dialogueRun(g)) {
        picture(g, 0x10214, 0x280000);
        dialogueStart(g, 0x68, 0, 1);
        set(g, T1, 0);
        set(g, T2, 0);
        set(g, T3, 0xc0);
        nextScene(g);
      }
      return false;
    },
    (g) => {
      shake(g);
      if (dialogueRun(g)) {
        objectFadeBox(g, g.ob + 0x36, 0x40, -2);
        nextScene(g);
      }
      return false;
    },
    (g) => {
      shake(g);
      if (g.m.add32(g.pv(T3), -1) < 0 && objectFadeDown(g, g.ob + 0x36)) nextScene(g);
      return false;
    },
    (g) => {
      clearText(g);
      picture(g, 0x10215, 0x280000);
      objectFadeBox(g, g.ob + 0x36, 0, -2);
      bgmRequest(g, 0x21);
      nextScene(g);
      return false;
    },
    (g) => {
      if ((g.counter & 1) === 0 && objectFadeUp(g, g.ob + 0x36)) {
        dialogueStart(g, 0x69, 0, 7);
        nextScene(g);
      }
      return false;
    },
    text,
    (g) => {
      if (g.m.add32(g.pv(T1), -1) < 0) {
        dialogueStart(g, 0x70, 0, 2);
        picture(g, 0x10216, 0x280000);
        nextScene(g);
      }
      return false;
    },
    text,
    (g) => {
      if ((g.counter & 1) !== 0) return false;
      set(g, SCENE, 0);
      set(g, SCENE_STEP, 0);
      return true;
    },
  ],
];

const ZONE_CLEAR: ((g: Game) => void)[] = [
  // 0 zone_clear_mark
  (g) => {
    set(g, V.ZONES_CLEARED, v(g, V.ZONES_CLEARED) | g.m.s32(ZONE_BIT + 4 * v(g, V.ZONE)));
    set(g, WIPE_STATE, 0);
    nextStep(g);
  },
  // 1: the tile wipe covers the stage
  (g) => {
    if (wipe(g, true)) nextStep(g);
  },
  // 2
  (g) => {
    clearScene(g);
    set(g, WIPE_STATE, 0);
    set(g, SCENE, v(g, V.ZONE));
    set(g, SCENE_STEP, 0);
    nextStep(g);
  },
  // 3: the zone's scene; Start skips it
  (g) => {
    const done = ZONE_SCENES[v(g, SCENE)][v(g, SCENE_STEP)](g);
    if (!done && !(g.pressed() & 0x800)) return;
    set(g, SCENE, 0);
    set(g, SCENE_STEP, 0);
    if (v(g, V.ZONE) === 4) {
      toScreen(g, 0xb);
    } else {
      bgmRequest(g, BGM_STOP);
      set(g, WIPE_STATE, 0);
      set(g, CONTINUE_STEP, 4);
      nextStep(g);
    }
  },
  // 4 (0x800A9F18): the continue screen's steps 4-7 (wipe, collected items)
  (g) => {
    const step = v(g, A.STEP);
    set(g, SAVED_STEP, step);
    set(g, A.STEP, v(g, CONTINUE_STEP));
    CONTINUE[v(g, A.STEP)](g);
    set(g, CONTINUE_STEP, v(g, A.STEP));
    set(g, A.STEP, v(g, CONTINUE_STEP) === 8 ? v(g, SAVED_STEP) + 1 : v(g, SAVED_STEP));
  },
  // 5 zone_clear_next
  (g) => {
    g.m.fill(ITEMS + g.p * 0x1c, 0x1c);
    const zc = v(g, V.ZONES_CLEARED);
    if (zc === 0x1f) {
      toScreen(g, 0xb);
    } else if (zc === 0xf) {
      toScreen(g, 2);
      set(g, SCENE, 4);
      set(g, SCENE_STEP, 0);
      set(g, V.ZONE, 4);
      set(g, V.STAGE, 0);
    } else {
      toScreen(g, 1);
    }
  },
];

export function scr10ZoneClear(g: Game): void {
  ZONE_CLEAR[v(g, A.STEP)](g);
}

// ---- screen 11: the ending ----

const CREDITS_TIMER = 0x800ee718; // [2]
const CREDITS_TICK = 0x800ee3c0; // [2]
const CREDITS_POS = 0x800f363c; // [2] index into the credits text
const CREDITS_TEXT = 0x800e07d4; // int[]: glyph, 0 space, -2 end of line, -1 end
const CREDITS_OBJ = 99; // 100 objects
const ENDING_ART = 0x80094660; // (image, x, y) x 6
const STAFF_OBJ = 0xca;

function creditsClear(g: Game): void {
  for (let i = 0; i < 100; i++) objectClear(g, i + g.ob + CREDITS_OBJ);
}

/** FUN_800AB048: the credits scroll up a pixel; lines leave at y = 20. */
function creditsScroll(g: Game): void {
  const m = g.m;
  for (let i = 0; i < 100; i++) {
    const n = i + g.ob + CREDITS_OBJ;
    const o = A.obj(n);
    if (m.s32(o + A.O_IMAGE) !== 0 && m.add32(o + A.O_Y, -0x10000) < 0x140001) objectClear(g, n);
  }
}

/** FUN_800AAFD8: a free credits object (the first after the range if none). */
function creditsFreeObject(g: Game): number {
  for (let i = 0; i < 100; i++) {
    const n = i + g.ob + CREDITS_OBJ;
    if (g.m.s32(A.obj(n) + A.O_IMAGE) === 0) return n;
  }
  return 100 + g.ob + CREDITS_OBJ;
}

/** FUN_800AAEA8: the next line of the credits at y = 145; true at the end. */
function creditsLine(g: Game): boolean {
  const m = g.m;
  let x = 0x10;
  for (;;) {
    const k = m.add32(g.pv(CREDITS_POS), 1) - 1;
    const c = m.s32(CREDITS_TEXT + k * 4);
    if (c === -1) return true;
    if (c === -2) return false;
    if (c === 0) {
      x += 8;
      continue;
    }
    const o = A.obj(creditsFreeObject(g));
    m.w32(o + A.O_IMAGE, c + 0x10476);
    m.w32(o + A.O_X, x << 16);
    m.w32(o + A.O_Y, 0x910000);
    m.w32(o + A.O_20, 2);
    m.w32(o + A.O_PLAYER, g.p);
    x += 8;
  }
}

function copyObject(g: Game, dst: number, src: number): void {
  const m = g.m;
  const d = A.obj(g.ob + dst);
  const s = A.obj(g.ob + src);
  for (const f of [A.O_IMAGE, A.O_X, A.O_Y, A.O_PLAYER, A.O_20]) m.w32(d + f, m.s32(s + f));
}

const ENDING: ((g: Game) => void)[] = [
  // 0
  (g) => {
    objectFadeBox(g, g.ob + 0x36, 0x40, -2);
    nextStep(g);
  },
  // 1: the fade (or straight on in 100-stage mode)
  (g) => {
    if ((g.counter & 1) !== 0) return;
    if (objectFadeDown(g, g.ob + 0x36) || v(g, V.HUNDRED) === 1) {
      copyObject(g, 200, 0x34);
      copyObject(g, 0xc9, 0x35);
      nextStep(g);
    }
  },
  // 2: the credits background
  (g) => {
    const m = g.m;
    const o = A.obj(g.ob + 0x62);
    m.w32(o + A.O_IMAGE, 0x10408);
    m.w32(o + A.O_X, 0);
    m.w32(o + A.O_Y, 0x280000);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 2);
    m.w32(o + A.O_PALETTE, g.p);
    for (const a of [CREDITS_TICK, CREDITS_POS, 0x800ee420, CREDITS_TIMER, 0x800ee720, 0x800ee728, 0x800ee730]) set(g, a, 0);
    creditsClear(g);
    nextStep(g);
  },
  // 3: the credits roll (a pixel every 4 frames, a line every 32); Start skips
  (g) => {
    if (g.pressed() & 0x800) {
      set(g, CREDITS_TIMER, 0);
      set(g, A.STEP, 4);
      return;
    }
    if ((g.counter & 3) !== 0) return;
    const t = g.m.add32(g.pv(CREDITS_TICK), 1);
    creditsScroll(g);
    if ((t & 7) === 0 && creditsLine(g)) {
      set(g, CREDITS_TIMER, 0x2a);
      nextStep(g);
    }
  },
  // 4
  (g) => {
    if ((g.counter & 3) !== 0) return;
    creditsScroll(g);
    if (g.m.add32(g.pv(CREDITS_TIMER), -1) < 1) {
      set(g, CREDITS_TIMER, 0x80);
      nextStep(g);
    }
  },
  // 5
  (g) => {
    if (g.m.add32(g.pv(CREDITS_TIMER), -1) < 1) {
      creditsClear(g);
      nextStep(g);
    }
  },
  // 6: the last picture and the professor's words
  (g) => {
    const m = g.m;
    for (let i = 0; i < 6; i++) {
      const o = A.obj(STAFF_OBJ + i + g.ob);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 2);
      m.w32(o + A.O_IMAGE, m.s32(ENDING_ART + i * 12) + 0x10000);
      m.w32(o + A.O_X, m.s32(ENDING_ART + i * 12 + 4) << 16);
      m.w32(o + A.O_Y, (m.s32(ENDING_ART + i * 12 + 8) + 100) * 0x10000);
    }
    m.w32(A.obj(g.ob + STAFF_OBJ) + A.O_4C, 0x80);
    dialogueStart(g, 0xe, 0, 2);
    nextStep(g);
  },
  // 7
  (g) => {
    if (g.m.add32(A.obj(g.ob + STAFF_OBJ) + A.O_4C, -1) < 0) {
      objectFadeBox(g, g.ob + 0x65, 0x40, -2);
      nextStep(g);
    }
  },
  // 8
  (g) => {
    if (!objectFadeDown(g, g.ob + 0x65)) return;
    objectClear(g, g.ob + 0x62);
    if (v(g, V.HUNDRED) === 1) {
      set(g, V.ZONE, 0);
      set(g, V.STAGE, 0);
      nextStep(g);
      g.m.w32(A.obj(g.ob + STAFF_OBJ) + A.O_4C, 2);
    }
    nextStep(g);
  },
  // 9: the words; then 100-stage mode is unlocked
  (g) => {
    if (!dialogueRun(g, BOX_B)) return;
    set(g, V.ZONE, 0);
    set(g, V.STAGE, 0);
    set(g, V.ZONES_CLEARED, 0x1f);
    set(g, V.STAGE, 0);
    g.m.w32(A.obj(g.ob + STAFF_OBJ) + A.O_4C, 0x80);
    nextStep(g);
  },
  // 10: on to the game-over wipe and the ranking
  (g) => {
    if (g.m.add32(A.obj(g.ob + STAFF_OBJ) + A.O_4C, -1) >= 0) return;
    creditsClear(g);
    for (let i = 0; i < 100; i++) objectClear(g, i + g.ob + STAFF_OBJ);
    set(g, WIPE_STATE, 0);
    bgmRequest(g, BGM_STOP);
    toScreen(g, 6, 4);
  },
  (g) => nextStep(g),
  (g) => nextStep(g),
  (g) => nextStep(g),
  (g) => nextStep(g),
  (g) => nextStep(g),
  (g) => toScreen(g, 7),
];

export function scr11Ending(g: Game): void {
  ENDING[v(g, A.STEP)](g);
}
