// Screen 12: pause (docs/spec/stages.md §6, corrected in docs/re/oracle-harness.md §5.1).
import * as A from '../addr';
import { NotPorted, type Game } from '../game';
import { objectClear, objectPut1 } from '../objects';
import { showPlayArea, SAVED_BGM, SAVED_SCREEN, SAVED_STEP, SAVED_STEP4, SAVED_SUBSTEP } from '../pause';
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
  () => {
    throw new NotPorted('pause: stage select');
  },
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
