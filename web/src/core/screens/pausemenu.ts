// Screen 12: pause (docs/spec/stages.md §6, corrected in docs/re/oracle-harness.md §5.1).
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animTick, objectClear, objectPut1 } from '../objects';
import { hidePlayArea, showPlayArea, SAVED_BGM, SAVED_SCREEN, SAVED_STEP, SAVED_STEP4, SAVED_SUBSTEP } from '../pause';
import { DPAD_DX, DPAD_DY, menuDpadRepeat } from '../dpad';
import { bestTimeDraw, numberDraw } from '../play/hud';
import { ceilingDrawChain } from '../play/ceiling';
import { boardObjectsLayout, objectsClearBoard } from '../play/objects';
import { boardClearRows, boardSpritesBuild, recordField, stageLoadLayout } from '../play/stage';
import { stageArt30, stageArt31 } from './stage';
import { bgmRequest, sePlay, BGM_STOP } from '../sound';
import * as V from '../vars';
import { passwordShow } from './password';

const STAGE_SELECT_STATE = 0x800ee9c8; // [2]

const sub = (g: Game) => g.m.u32(g.pv(A.SUBSTEP));
const clear = (g: Game, ...ns: number[]) => ns.forEach((n) => objectClear(g, g.ob + n));

/** The cursor object 0x1A2 on menu item `n` (image - 1, same position). */
function cursorOn(g: Game, n: number): void {
  const m = g.m;
  const c = A.obj(g.ob + 0x1a2);
  const o = A.obj(g.ob + n);
  m.w32(c + A.O_IMAGE, m.s32(o + A.O_IMAGE) - 1);
  m.w32(c + A.O_X, m.s32(o + A.O_X));
  m.w32(c + A.O_Y, m.s32(o + A.O_Y));
}

/** Back to the step in STEP4 (the menu), cursor reset. */
function backToMenu(g: Game): void {
  const m = g.m;
  m.w32(g.pv(A.STEP), m.s32(g.pv(A.STEP4)));
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** A yes/no question (steps 5-6 retire, 7-8 quit): Left/Right, starting on "no". */
function yesNoSetup(g: Game, question: number, x2: number, x3: number): void {
  const m = g.m;
  objectPut1(g, 0x19e, question, question === 0x4d1 ? 0x28 : 0x1e, 100);
  objectPut1(g, 0x19f, 0x3bf, x2, 0x78);
  objectPut1(g, 0x1a0, 0x3b5, x3, 0x78);
  const c = A.obj(g.ob + 0x1a2);
  m.w32(c + A.O_PLAYER, g.p);
  m.w32(c + A.O_20, 1);
  cursorOn(g, 0x1a0);
  m.w32(g.pv(A.SUBSTEP), 1);
  m.add32(g.pv(A.STEP), 1);
}

/** Left/Right and Circle of a yes/no question; returns 0 yes, 1 no, -1 still asking. */
function yesNo(g: Game): number {
  const m = g.m;
  const pressed = g.pressed();
  if (pressed & 0x20) {
    sePlay(g, 0x12);
    clear(g, 0x19e, 0x19f, 0x1a0, 0x1a2);
    backToMenu(g);
    return -1;
  }
  if (pressed & 0x2000) {
    const s = sub(g) + 1;
    if (s >>> 0 < 2) {
      m.w32(g.pv(A.SUBSTEP), s);
      sePlay(g, 3);
    } else {
      m.w32(g.pv(A.SUBSTEP), 1);
    }
  }
  if (pressed & 0x8000) {
    const s = (sub(g) - 1) >>> 0;
    if (s < 0x101) {
      m.w32(g.pv(A.SUBSTEP), s);
      sePlay(g, 3);
    } else {
      m.w32(g.pv(A.SUBSTEP), 0);
    }
  }
  if (!(g.pressed() & 0x40)) {
    cursorOn(g, 0x19f + sub(g));
    return -1;
  }
  clear(g, 0x19e, 0x19f, 0x1a0, 0x1a2);
  sePlay(g, 0);
  const answer = sub(g);
  if (answer === 1) backToMenu(g);
  return answer === 0 ? 0 : answer === 1 ? 1 : -1;
}

const STEPS: ((g: Game) => void)[] = [
  // 0 (0x800AB198): "PAUSE"; Start resumes, Select opens the menu, Cross the stage select.
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x800) {
      clear(g, 0x19e, 0x19f, 0x1a0);
      m.add32(g.pv(A.STEP), 1);
      return;
    }
    if (pressed & 0x100) {
      sePlay(g, 0);
      clear(g, 0x19e, 0x19f, 0x1a0);
      m.add32(g.pv(A.STEP), 2);
      return;
    }
    const hundred = m.u8(g.pv(V.ZONES_CLEARED)) === 0x1f;
    if (!(pressed & 0x40) && m.s32(g.pv(V.HUNDRED_AUTO)) === 0) {
      if (hundred) {
        objectPut1(g, 0x19e, g.p + 0x3b9, 0x21, 0x47);
        objectPut1(g, 0x19f, 0x3b8, 0x2d, 0x5d);
        objectPut1(g, 0x1a0, 0x3eb, 0x18, 0x74);
        return;
      }
    } else if (hundred) {
      if (m.s32(g.pv(V.HUNDRED_AUTO)) === 0) sePlay(g, 0);
      m.w32(g.pv(V.HUNDRED_AUTO), 0);
      clear(g, 0x19e, 0x19f, 0x1a0);
      m.w32(g.pv(STAGE_SELECT_STATE), 0);
      m.add32(g.pv(A.STEP), 4);
      return;
    }
    objectPut1(g, 0x19e, g.p + 0x3b9, 0x1e, 100);
    objectPut1(g, 0x19f, 0x3b8, 0x2d, 0x78);
  },
  // 1 (0x800AB4DC): resume.
  (g) => {
    const m = g.m;
    m.w32(g.pv(A.SCREEN), m.s32(g.pv(SAVED_SCREEN)));
    m.w32(g.pv(A.STEP), m.s32(g.pv(SAVED_STEP)));
    m.w32(g.pv(A.SUBSTEP), m.s32(g.pv(SAVED_SUBSTEP)));
    m.w32(g.pv(A.STEP4), m.s32(g.pv(SAVED_STEP4)));
    showPlayArea(g);
    bgmRequest(g, m.s32(g.pv(SAVED_BGM)));
  },
  // 2 (0x800AB5C0): the menu.
  (g) => {
    const m = g.m;
    objectPut1(g, 0x19e, 0x3b2, 0x1e, 0x5a);
    objectPut1(g, 0x19f, 0x3b7, 0x18, 0x6e);
    objectPut1(g, 0x1a0, 0x4d2, 0x28, 0x82);
    objectPut1(g, 0x1a1, 0x3bd, 0x32, 0x96);
    const c = A.obj(g.ob + 0x1a2);
    m.w32(c + A.O_PLAYER, g.p);
    m.w32(c + A.O_20, 1);
    cursorOn(g, 0x19e);
    m.w32(g.pv(A.SUBSTEP), 0);
    m.add32(g.pv(A.STEP), 1);
  },
  // 3 (0x800AB6D4): Up/Down, Cross picks, Circle back to "PAUSE".
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x20) {
      sePlay(g, 0x12);
      clear(g, 0x19e, 0x19f, 0x1a0, 0x1a1, 0x1a2);
      m.w32(g.pv(A.STEP), 0);
      return;
    }
    if (pressed & 0x40) {
      clear(g, 0x19e, 0x19f, 0x1a0, 0x1a1, 0x1a2);
      sePlay(g, 0);
      const choice = m.s32(g.pv(A.SUBSTEP));
      const go = (s: number) => {
        m.w32(g.pv(A.STEP4), 2);
        m.w32(g.pv(A.STEP), s);
      };
      if (choice === 1) go(9);
      else if (choice === 0) m.w32(g.pv(A.STEP), 1);
      else if (choice === 2) go(5);
      else if (choice === 3) go(7);
      return;
    }
    if (pressed & 0x4000) {
      const s = sub(g) + 1;
      if (s >>> 0 < 4) {
        m.w32(g.pv(A.SUBSTEP), s);
        sePlay(g, 3);
      } else {
        m.w32(g.pv(A.SUBSTEP), 3);
      }
    }
    if (pressed & 0x1000) {
      const s = (sub(g) - 1) >>> 0;
      if (s < 0x101) {
        m.w32(g.pv(A.SUBSTEP), s);
        sePlay(g, 3);
      } else {
        m.w32(g.pv(A.SUBSTEP), 0);
      }
    }
    cursorOn(g, 0x19e + m.s32(g.pv(A.SUBSTEP)));
  },
  // 4: the hidden stage select (100-stage mode).
  (g) => STAGE_SELECT[g.m.s32(g.pv(STAGE_SELECT_STATE))](g),
  // 5, 6: retire?
  (g) => yesNoSetup(g, 0x4d1, 0x28, 0x50),
  (g) => {
    if (yesNo(g) === 0) {
      g.m.w32(g.p === 0 ? 0x800ee9e8 : 0x800eea0c, 0);
      g.m.w32(g.pv(V.RETIRE), 1);
      g.m.w32(g.pv(A.STEP), 1);
    }
  },
  // 7, 8: quit?
  (g) => yesNoSetup(g, 0x3bb, 0x30, 0x58),
  (g) => {
    if (yesNo(g) !== 0) return;
    const m = g.m;
    bgmRequest(g, BGM_STOP);
    if (m.s32(A.SCREEN + 4 * (g.p ^ 1)) === 8) {
      g.exitTo(3, 0, 9);
      return;
    }
    m.w32(g.pv(A.SCREEN), 8);
    m.w32(g.pv(A.STEP), 0);
    m.w32(g.pv(A.SUBSTEP), 0);
    m.w32(g.pv(A.STEP4), 0);
  },
  // 9 (0x800AC5A4): the password, until Cross or Circle.
  (g) => {
    const pressed = g.pressed();
    if ((pressed & 0x60) === 0) {
      passwordShow(g, 8, 100, 1);
      return;
    }
    sePlay(g, pressed & 0x40 ? 0 : 0x12);
    objectClear(g, g.ob + 0x194);
    for (let i = 0; i < 6; i++) objectClear(g, i + g.ob + 0x196);
    backToMenu(g);
  },
];

export function scr12Pause(g: Game): void {
  STEPS[g.m.s32(g.pv(A.STEP))](g);
}

// ---- the hidden stage select (pause step 4, pause_stage_select) ----

const SELECT_NUMBER = 0x800f2cf8; // [2] 1-100
const SAVED_LAYOUT = 0x800f0c18; // [2][150]: the stage's rows 1-15 while choosing
const SAVED_ZONE = 0x800ee984;
const SAVED_STAGE_NO = 0x800ee900;
const SELECT_NO = 0x800eeb70; // [2] the confirm prompt: 1 on "no" (right, the start), 0 on "yes"
const DIGIT_IMAGE = 0x800948e8; // int[10]

/** FUN_800B5898: object n (absolute) with image and position, for the current player. */
function put(g: Game, n: number, image: number, x: number, y: number, layer: number): void {
  const m = g.m;
  const o = A.obj(n);
  m.w32(o + A.O_IMAGE, image + 0x10000);
  m.w32(o + A.O_X, x << 16);
  m.w32(o + A.O_Y, y << 16);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, layer);
}

/** FUN_800B53A4: the stage number's three digits. */
function selectNumberDraw(g: Game): void {
  const m = g.m;
  const n = m.s32(g.pv(SELECT_NUMBER));
  const digit = (d: number) => m.s32(DIGIT_IMAGE + 4 * d);
  put(g, g.ob + 0x1a1, digit(Math.trunc(n / 100)), 0x3e, 0x6a, 1);
  put(g, g.ob + 0x1a2, digit(Math.trunc((n % 100) / 10)), 0x46, 0x6a, 1);
  put(g, g.ob + 0x1a3, digit(n % 10), 0x4e, 0x6a, 1);
}

function selectClearObjects(g: Game): void {
  for (let n = 0x1a0; n <= 0x1a8; n++) objectClear(g, g.ob + n);
}

/** Puts the prompt's cursor on "no" (right) or "yes" (left). */
function setChoice(g: Game, no: boolean, clearOther = true): void {
  const m = g.m;
  if (clearOther) objectClear(g, g.ob + (no ? 0x1a5 : 0x1a6));
  const n = g.ob + (no ? 0x1a6 : 0x1a5);
  animSet(g, n, no ? 0x26 : 0x25);
  const o = A.obj(n);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_X, no ? 0x550000 : 0x210000);
  m.w32(o + A.O_Y, 0x840000);
  m.w32(g.pv(SELECT_NO), no ? 1 : 0);
}

const STAGE_SELECT: ((g: Game) => void)[] = [
  // 0 (0x800B4464): remember the stage, show the selector
  (g) => {
    const m = g.m;
    const base = V.BOARD + g.p * 0x348 + 40;
    for (let i = 0; i < 0x96; i++) m.w32(SAVED_LAYOUT + g.p * 0x348 + 4 * i, m.s32(base + 4 * i));
    m.w32(g.pv(SAVED_ZONE), m.s32(g.pv(V.ZONE)));
    m.w32(g.pv(SAVED_STAGE_NO), m.s32(g.pv(V.STAGE)));
    put(g, g.ob + 0x1a7, 0x5f, 0, 10, 1);
    put(g, g.ob + 0x1a8, 0x62, 0x25, m.s16(A.obj(g.ob + 0x1a7) + A.O_Y + 2) - 0x10, 1);
    for (let i = 0; i < 0xf; i++) {
      if (i < 3) put(g, i + g.ob + 0xe6, 3, 0x2d, (i - 3) * 10 + 8, 1);
      else objectClear(g, i + 0xe6 + g.ob);
    }
    numberDraw(g, 0, 3, g.ob + 0xd9, m.s32(0x800e27a0 + g.p * 4), 0xc6, 0x411, 6);
    numberDraw(g, 0, 1, g.ob + 0xdd, m.s32(0x800e27a8 + g.p * 4), 0xd0, 0x41b, 6);
    objectsClearBoard(g);
    stageLoadLayout(g);
    boardSpritesBuild(g);
    m.w32(g.pv(SELECT_NUMBER), m.s32(g.pv(V.ZONE)) * 0x14 + 1 + m.s32(g.pv(V.STAGE)));
    put(g, g.ob + 0x1a0, 0x3ec, 0x18, 0x54, 1);
    selectNumberDraw(g);
    m.add32(g.pv(STAGE_SELECT_STATE), 1);
  },
  // 1 (0x800B4780): Left/Right by 1, Up/Down by 10; Cross asks to confirm, Circle cancels
  (g) => {
    const m = g.m;
    menuDpadRepeat(g);
    if (m.s32(DPAD_DY) === 1) m.w32(DPAD_DX, -10);
    if (m.s32(DPAD_DY) === -1) m.w32(DPAD_DX, 10);
    const dx = m.s32(DPAD_DX);
    if (dx !== 0) {
      sePlay(g, 3);
      let n = m.add32(g.pv(SELECT_NUMBER), dx);
      if (n < 1) m.w32(g.pv(SELECT_NUMBER), 100);
      if (m.s32(g.pv(SELECT_NUMBER)) > 100) m.w32(g.pv(SELECT_NUMBER), 1);
      selectNumberDraw(g);
      n = m.s32(g.pv(SELECT_NUMBER));
      const zone = Math.trunc((n - 1) / 0x14);
      m.w32(g.pv(V.ZONE), zone);
      m.w32(g.pv(V.STAGE), n - (zone * 0x14 + 1));
      if (m.s32(A.obj(g.ob + 0x1f) + A.O_IMAGE) !== m.s32(recordField(g, 0x24)) + 0x10000) stageArt31(g);
      if (m.s32(A.obj(g.ob + 0x1e) + A.O_IMAGE) !== m.s32(recordField(g, 0x20)) + 0x10000) stageArt30(g);
      objectsClearBoard(g);
      stageLoadLayout(g);
      boardSpritesBuild(g);
      bestTimeDraw(g);
    }
    if (g.pressed() & 0x20) {
      sePlay(g, 0x12);
      m.w32(g.pv(STAGE_SELECT_STATE), 2);
    }
    if (g.pressed() & 0x40) {
      sePlay(g, 0);
      put(g, g.ob + 0x1a4, 0x3d4, 0x10, 0x74, 1);
      setChoice(g, true, false);
      m.w32(g.pv(STAGE_SELECT_STATE), 3);
    }
  },
  // 2 (0x800B4BCC): cancelled, back to the paused stage
  (g) => {
    const m = g.m;
    objectsClearBoard(g);
    boardClearRows(g);
    boardObjectsLayout(g);
    m.w32(g.pv(V.ZONE), m.s32(g.pv(SAVED_ZONE)));
    m.w32(g.pv(V.STAGE), m.s32(g.pv(SAVED_STAGE_NO)));
    const base = V.BOARD + g.p * 0x348 + 40;
    for (let i = 0; i < 0x96; i++) m.w32(base + 4 * i, m.s32(SAVED_LAYOUT + g.p * 0x348 + 4 * i));
    boardSpritesBuild(g);
    stageArt31(g);
    stageArt30(g);
    ceilingDrawChain(g);
    hidePlayArea(g);
    const t = m.s32(g.pv(V.STAGE_TIME));
    numberDraw(g, Math.trunc(t / 10), 3, g.ob + 0xd9, m.s32(0x800e27a0 + g.p * 4), 0xc6, 0x411, 6);
    numberDraw(g, t % 10, 1, g.ob + 0xdd, m.s32(0x800e27a8 + g.p * 4), 0xd0, 0x41b, 6);
    bestTimeDraw(g);
    selectClearObjects(g);
    m.w32(g.pv(STAGE_SELECT_STATE), 0);
    m.w32(g.pv(A.SCREEN), 0xc);
    m.w32(g.pv(A.STEP), 0);
    m.w32(g.pv(A.SUBSTEP), 0);
    m.w32(g.pv(A.STEP4), 0);
  },
  // 3 (0x800B4ED4): "play this stage?" Left yes, Right no; Cross picks, Circle cancels
  (g) => {
    const m = g.m;
    const no = () => m.s32(g.pv(SELECT_NO)) === 1;
    animTick(g, g.ob + (no() ? 0x1a6 : 0x1a5));
    if (g.pressed() & 0x8000 && no()) {
      setChoice(g, false);
      sePlay(g, 3);
    }
    if (g.pressed() & 0x2000 && !no()) {
      setChoice(g, true);
      sePlay(g, 3);
    }
    if (g.pressed() & 0x40) {
      sePlay(g, 0);
      if (!no()) {
        selectClearObjects(g);
        m.w32(g.pv(STAGE_SELECT_STATE), 0);
        m.w32(g.pv(A.SCREEN), 3);
        m.w32(g.pv(A.STEP), 0);
        m.w32(g.pv(A.SUBSTEP), 0);
        m.w32(g.pv(A.STEP4), 0);
      } else {
        for (const n of [0x1a4, 0x1a5, 0x1a6]) objectClear(g, g.ob + n);
        m.w32(g.pv(STAGE_SELECT_STATE), 1);
      }
    }
    if (g.pressed() & 0x20) {
      sePlay(g, 0x12);
      for (const n of [0x1a4, 0x1a5, 0x1a6]) objectClear(g, g.ob + n);
      m.w32(g.pv(STAGE_SELECT_STATE), 1);
    }
  },
];
