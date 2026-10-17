// Screens 3 (stage setup), 4 (stage intro) and 5 (play): docs/spec/stages.md §2, frame.md §2-§3.
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animTick, objectClear } from '../objects';
import { bgmRequest, sePlay } from '../sound';
import * as V from '../vars';
import { profDispatch, objectsClearLineFlash } from '../professor';
import { ceilingCrush, ceilingDispatch, debrisUpdate } from '../play/ceiling';
import { bestTimeDraw, bestTimeDrawTick, numberDraw, scoreDraw, stageTimerDraw, stageTimerReset } from '../play/hud';
import { linesPopup, playClearAnim, playCollapse, playLineCheck, playNext } from '../play/lines';
import {
  boardObjectsLayout, debrisClearAll, objectsClearBoard, objectsClearPieceFlash, objectsClearPopups,
} from '../play/objects';
import { pieceFlashDraw, playFall, playSpawn, queueDraw, queueInit } from '../play/piece';
import { boardClearRows, boardReset, boardSpritesBuild, recordField, stageLoadLayout } from '../play/stage';

const WIPE_STATE = 0x800ee964; // [2]
const WIPE_FRAME = 0x800eea18; // [2]
const WIPE_POS = 0x800eea28; // [2]
const WIPE_ORDER = 0x800e2f4c; // int[16]: first tile per frame
const FIRST_STAGE = 0x800ee990; // [2] the new game's first stage (rules panels)
const PANEL_STATE = 0x800ee9d8; // [2]
const PANEL_TIMER = 0x800eeb40; // [2]
const PAUSE_GUARD = 0x800ee6a0; // [2]

const step = (g: Game) => g.m.s32(g.pv(A.STEP));
const nextStep = (g: Game, n = 1) => g.m.add32(g.pv(A.STEP), n);
function toScreen(g: Game, screen: number): void {
  const m = g.m;
  m.w32(g.pv(A.SCREEN), screen);
  m.w32(g.pv(A.STEP), 0);
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** One frame of the tile wipe (FUN_800AFF90 covers, FUN_800B0290 uncovers); true at the end. */
export function wipe(g: Game, cover: boolean): boolean {
  const m = g.m;
  if (m.s32(g.pv(WIPE_STATE)) === 0) {
    m.w32(g.pv(WIPE_FRAME), 0);
    m.add32(g.pv(WIPE_STATE), 1);
    return false;
  }
  if (m.s32(g.pv(WIPE_STATE)) !== 1) return false;
  m.w32(g.pv(WIPE_POS), m.s32(WIPE_ORDER + m.s32(g.pv(WIPE_FRAME)) * 4));
  let pos: number;
  do {
    const start = m.s32(g.pv(WIPE_POS));
    for (let i = start; i < Math.trunc(start / 9) * 9 + 9; i += 4) {
      const n = i + 0x108 + g.ob;
      if (!cover) {
        objectClear(g, n);
        continue;
      }
      const o = A.obj(n);
      m.w32(o + A.O_IMAGE, ((i + Math.trunc(i / 9)) % 7) + 0x10177);
      m.w32(o + A.O_X, ((i % 9) * 0x11 + 5) * 0x10000);
      m.w32(o + A.O_Y, Math.trunc(i / 9) * 0x110000);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 2);
    }
    pos = m.add32(g.pv(WIPE_POS), 0x24);
  } while (pos < 0x7e);
  return m.add32(g.pv(WIPE_FRAME), 1) === 0x10;
}

// ---- screen 3: stage setup ----

export function scr03StageSetup(g: Game): void {
  const m = g.m;
  switch (step(g)) {
    case 0:
      m.w32(g.pv(WIPE_STATE), 0);
      m.w32(g.pv(WIPE_FRAME), 0);
      nextStep(g);
      return;
    case 1:
      if (wipe(g, true)) {
        for (let n = 0x1e + g.p * 400; n < 0x107 + g.p * 400 + 1; n++) objectClear(g, n);
        m.w32(g.pv(WIPE_FRAME), 0);
        nextStep(g);
      }
      return;
    case 2:
      objectsClearBoard(g);
      boardClearRows(g);
      boardReset(g);
      for (const a of [V.CLEAR_ANIM_FRAME, V.LINES_FOUND, V.LINES_THIS_CLEAR, V.POPUP_STATE, V.PROF_STATE,
        V.PROF_SUBSTATE, V.CLEAR_COUNTDOWN, V.STAGE_FLAGS]) m.w32(g.pv(a), 0);
      nextStep(g);
      return;
    case 3:
      bgmRequest(g, 0x23);
      m.w32(g.pv(A.STEP), 0);
      m.w32(g.pv(A.SUBSTEP), 0);
      m.w32(g.pv(A.STEP4), 0);
      m.w32(g.pv(A.SCREEN), 4);
      return;
  }
}

// ---- screen 4: stage intro ----

/** The stage number (or "LAST") and the HUD frame (intro_stage_load / intro_rules_panel). */
function stageNumberAndHud(g: Game, numberX: number, checkHundred: boolean): void {
  const m = g.m;
  const p = g.p;
  let o = A.obj(g.ob + 0x104);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_IMAGE, 0x1018d);
  m.w32(o + A.O_X, numberX);
  m.w32(o + A.O_Y, 0x460000);
  const last = v(g, V.STAGE) === 0x13 && (!checkHundred || m.u8(g.pv(V.ZONES_CLEARED)) !== 0x1f);
  if (last) {
    o = A.obj(g.ob + 0x105);
    m.w32(o + A.O_PLAYER, p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, 0x101aa);
    m.w32(o + A.O_X, 0x3c0000);
    m.w32(o + A.O_Y, 0x460000);
  } else {
    const hundred = v(g, V.HUNDRED) === 1;
    const n = hundred ? v(g, V.ZONE) * 0x14 + v(g, V.STAGE) : v(g, V.STAGE);
    numberDraw(g, n + 1, hundred ? 3 : 2, g.ob + 0x105, 0x3c, 0x46, 0x18e, 0x10, 1);
  }
  o = A.obj(g.ob + 0xf6);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, p + 0x1013a);
  m.w32(o + A.O_X, (p * 0x42 + 0x69) * 0x10000);
  m.w32(o + A.O_Y, 0x70000);
  o = A.obj(g.ob + 0xf7);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, 0x1013c);
  m.w32(o + A.O_X, (p * 0x44 + 0x6f) * 0x10000);
  m.w32(o + A.O_Y, 0x150000);
  scoreDraw(g);
  // FUN_800B0A10
  const x = m.s32(0x8009483c + p * 4);
  o = A.obj(g.ob + 0xd3);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, 0x101a7);
  m.w32(o + A.O_X, x);
  m.w32(o + A.O_Y, 0x910000);
  o = A.obj(g.ob + 0xd2);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 0);
  m.w32(o + A.O_IMAGE, 0x101a8);
  m.w32(o + A.O_X, x);
  m.w32(o + A.O_Y, 0xba0000);
  for (let i = 0; i < 10; i++) objectClear(g, i + g.ob + 0xd4);
  stageTimerReset(g);
  bestTimeDrawTick(g);
  stageTimerDraw(g);
  queueInit(g);
  queueDraw(g);
}

const v = (g: Game, a: number) => g.m.s32(g.pv(a));

/** Objects of the stage art: slot 31 (FUN_800B0824) and slot 30 (FUN_800B091C). */
function stageArt31(g: Game): void {
  const m = g.m;
  const o = A.obj(g.ob + 0x1f);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_IMAGE, m.s32(recordField(g, 0x24)) + 0x10000);
  m.w32(o + A.O_X, -0x40000);
  m.w32(o + A.O_Y, 0x20000);
  m.w32(o + A.O_PALETTE, g.p);
}
function stageArt30(g: Game): void {
  const m = g.m;
  const o = A.obj(g.ob + 0x1e);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 2);
  m.w32(o + A.O_IMAGE, m.s32(recordField(g, 0x20)) + 0x10000);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0x80000);
  m.w32(o + A.O_PALETTE, g.p);
}

/** FUN_800B0FAC: the zone emblem, the "last stage" mark and the bonus-stage marker. */
function stageEmblem(g: Game): void {
  const m = g.m;
  const p = g.p;
  const stage = v(g, V.STAGE);
  const last = Math.trunc(stage / 0x13);
  let o = A.obj(g.ob + 0x23);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_IMAGE, m.s32(0x80094844 + (v(g, V.ZONE) * 2 + last) * 4) + 0x10000);
  m.w32(o + A.O_X, m.s32(0x8009486c + last * 8) << 16);
  m.w32(o + A.O_Y, m.s32(0x8009486c + last * 8 + 4) << 16);
  m.w32(o + A.O_PALETTE, p);
  if (stage === 0x13) {
    o = A.obj(g.ob + 0x24);
    m.w32(o + A.O_PLAYER, p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, 0x101f5);
    m.w32(o + A.O_X, m.s32(0x8009486c + last * 8) << 16);
    m.w32(o + A.O_Y, (m.s32(0x8009486c + last * 8 + 4) + 2) * 0x10000);
    if (v(g, V.ZONE) === 4) return;
  } else if ((stage + 1) % 3 !== 0) {
    return;
  }
  if (v(g, V.HUNDRED) !== 1) {
    o = A.obj(g.ob + 0x29);
    m.w32(o + A.O_PLAYER, p);
    m.w32(o + A.O_20, 1);
    m.w32(o + A.O_IMAGE, 0x101d8);
    m.w32(o + A.O_X, 0x270000);
    m.w32(o + A.O_Y, 0xb60000);
  }
}

/** FUN_800B1638: three HUD frame objects. */
function hudFrames(g: Game): void {
  const m = g.m;
  const p = g.p;
  [0x8009487c, 0x80094894, 0x800948ac].forEach((t, k) => {
    const o = A.obj(g.ob + 0x2c + k);
    m.w32(o + A.O_PLAYER, p);
    m.w32(o + A.O_20, 0);
    m.w32(o + A.O_IMAGE, m.s32(t + (p * 3 + 2) * 4));
    m.w32(o + A.O_X, m.s32(t + p * 3 * 4));
    m.w32(o + A.O_Y, m.s32(t + (p * 3 + 1) * 4));
  });
}

function put(g: Game, n: number, image: number, x: number, y: number, layer: number): void {
  const m = g.m;
  const o = A.obj(g.ob + n);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, layer);
  m.w32(o + A.O_IMAGE, image);
  m.w32(o + A.O_X, x);
  m.w32(o + A.O_Y, y);
}

/** Step 0, intro_setup */
function introSetup(g: Game): void {
  const m = g.m;
  m.w32(g.pv(PAUSE_GUARD), 0);
  m.w32(g.pv(WIPE_FRAME), 0);
  objectClear(g, g.ob + 0x28);
  objectClear(g, g.ob + 0x100);
  objectClear(g, g.ob + 0x186);
  objectClear(g, g.ob + 0x187);
  objectsClearBoard(g);
  boardClearRows(g);
  boardReset(g);
  for (const a of [V.CLEAR_ANIM_FRAME, V.LINES_FOUND, V.PIECES_SPAWNED, V.LINES_THIS_CLEAR, V.POPUP_STATE,
    V.STAGE_FLAGS, V.SPAWN_DELAY]) m.w32(g.pv(a), 0);
  hudFrames(g);
  put(g, 0x2b, 0x101a9, m.s32(0x80094364 + g.p * 4), 0x1c0000, 1);
  put(g, 0x30, 0x101a6, 0x80000, 0xdc0000, 1);
  stageEmblem(g);
  put(g, 0xe2, 0x1019a, 0x100000, 0xcd0000, 1);
  put(g, 0xe3, 0x1019b, 0x380000, 0xd20000, 1);
  stageArt31(g);
  stageArt30(g);
  bgmRequest(g, Math.trunc(v(g, V.STAGE) / 10) + 0x23);
  nextStep(g);
}

/** Step 1, intro_stage_load */
function introStageLoad(g: Game): void {
  const m = g.m;
  stageArt31(g);
  m.w32(g.pv(FIRST_STAGE), 0);
  if (v(g, V.STAGE) === 0 && v(g, V.ZONES_CLEARED) === 0 && v(g, V.SCORE) === 0 && v(g, V.NEW_GAME_FIRST) === 1) {
    m.w32(g.pv(FIRST_STAGE), 1);
  } else {
    stageNumberAndHud(g, 0x50000, true);
  }
  stageLoadLayout(g);
  boardObjectsLayout(g);
  boardSpritesBuild(g);
  m.w32(g.pv(V.INTRO_COUNTDOWN), 0x40);
  m.w32(g.pv(V.CEILING_STATE), 0);
  m.w32(g.pv(V.CEILING_PUSHBACK), 0);
  ceilingDispatch(g);
  m.w32(g.pv(WIPE_STATE), 0);
  nextStep(g);
}

/** Step 3: the first rules panel (FUN_800B9550). Returns true when it closes. */
function rulesPanel1(g: Game): boolean {
  const m = g.m;
  const timer = g.pv(PANEL_TIMER);
  switch (v(g, PANEL_STATE)) {
    case 0:
      m.w32(timer, 0x38);
      m.add32(g.pv(PANEL_STATE), 1);
      return false;
    case 1:
      for (let n = 0x1f; n < 0xf6; n++) m.add32(A.obj(n + g.ob) + A.O_Y, -0x10000);
      if (m.add32(timer, -1) < 0) {
        put(g, 0x107, 0x101ec, 0x10000, 0x350000, 1);
        put(g, 0x108, 0x101ed, 0x220000, 0x570000, 1);
        m.w32(timer, 0x7fffffff);
        m.add32(g.pv(PANEL_STATE), 1);
      }
      return false;
    case 2:
      if (g.pressed() & 0x40) m.w32(timer, 0);
      if (m.s32(timer) < 1) {
        objectClear(g, g.ob + 0x107);
        objectClear(g, g.ob + 0x108);
        m.w32(timer, 0x38);
        m.add32(g.pv(PANEL_STATE), 1);
      } else {
        const o = A.obj(g.ob + 0x108);
        if ((g.counter & 3) === 0) m.add32(o + A.O_Y, 0x10000);
        if (m.s32(o + A.O_Y) === 0x5c0000) m.w32(o + A.O_Y, 0x570000);
      }
      return false;
    case 3:
      for (let n = 0x1f; n < 0xf6; n++) m.add32(A.obj(n + g.ob) + A.O_Y, 0x10000);
      return m.add32(timer, -1) < 0;
    default:
      return false;
  }
}

/** Step 5: the second rules panel (FUN_800B9984). Returns true when it closes. */
function rulesPanel2(g: Game): boolean {
  const m = g.m;
  const timer = g.pv(PANEL_TIMER);
  const pageTurn = (image: number, promptY: number | null) => {
    m.w32(A.obj(g.ob + 0x107) + A.O_IMAGE, image);
    m.w32(timer, 0x7fffffff);
    m.add32(g.pv(PANEL_STATE), 1);
    if (promptY !== null) m.w32(A.obj(g.ob + 0x10a) + A.O_Y, promptY);
    sePlay(g, 0x12);
  };
  const waitCross = () => {
    animTick(g, g.ob + 0x10a);
    if (g.pressed() & 0x40) m.w32(timer, 0);
  };
  switch (v(g, PANEL_STATE)) {
    case 0: {
      m.w32(timer, 0x7fffffff);
      put(g, 0x107, 0x101ee, -0x40000, 0x1e0000, 1);
      put(g, 0x109, 0x101f2, m.s32(0x800949d8 + g.p * 4), 0x710000, 0);
      m.w32(A.obj(g.ob + 0x109) + A.O_FLIP, g.p);
      const o = A.obj(g.ob + 0x10a);
      m.w32(o + A.O_X, (g.p * 0xd + 0x78) * 0x10000);
      m.w32(o + A.O_Y, 0x920000);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 6);
      animSet(g, g.ob + 0x10a, 0x1b);
      m.add32(g.pv(PANEL_STATE), 1);
      return false;
    }
    case 1:
      waitCross();
      if (m.add32(timer, -1) < 1) pageTurn(0x101ef, 0x8e0000);
      return false;
    case 2:
      waitCross();
      if (m.add32(timer, -1) < 1) pageTurn(0x101f0, 0x980000);
      return false;
    case 3:
      waitCross();
      objectClear(g, g.ob + 0x108);
      if (m.add32(timer, -1) < 1) {
        pageTurn(0x101f1, 0x8e0000);
      } else if (g.counter & 4) {
        put(g, 0x108, 0x101f3, -0x40000, 0x1e0000, 1);
      }
      return false;
    case 4:
      waitCross();
      if (m.add32(timer, -1) < 1) pageTurn(0x101f4, null);
      return false;
    case 5:
      waitCross();
      if (m.add32(timer, -1) < 1) {
        objectClear(g, g.ob + 0x107);
        objectClear(g, g.ob + 0x109);
        m.add32(g.pv(PANEL_STATE), 1);
        sePlay(g, 0x12);
        objectClear(g, g.ob + 0x10a);
      }
      return false;
    case 6:
      return true;
    default:
      return false;
  }
}

export function scr04StageIntro(g: Game): void {
  const m = g.m;
  switch (step(g)) {
    case 0:
      introSetup(g);
      return;
    case 1:
      introStageLoad(g);
      return;
    case 2:
      // intro_banner_wait: the tile wipe uncovers the stage
      if (wipe(g, false)) {
        if (v(g, FIRST_STAGE) === 0) {
          nextStep(g, 2);
        } else {
          m.w32(g.pv(PANEL_STATE), 0);
          nextStep(g);
        }
      }
      return;
    case 3:
      if (rulesPanel1(g)) {
        stageNumberAndHud(g, 0x20000, false);
        nextStep(g);
      }
      return;
    case 4:
      // intro_prof_enter
      profDispatch(g);
      if (m.add32(g.pv(V.INTRO_COUNTDOWN), -1) < 1) {
        if (v(g, FIRST_STAGE) === 0) {
          nextStep(g, 2);
        } else {
          m.w32(g.pv(PANEL_STATE), 0);
          nextStep(g);
          m.w32(g.pv(V.PROF_HOLD), 1);
        }
      }
      return;
    case 5:
      if (rulesPanel2(g)) {
        m.w32(g.pv(V.PROF_HOLD), 0);
        nextStep(g);
      }
      return;
    case 6:
      profDispatch(g);
      if (v(g, V.STAGE_FLAGS) & 1) {
        for (const n of [0x104, 0x105, 0x106, 0x107]) objectClear(g, g.ob + n);
        nextStep(g);
      }
      return;
    case 7:
      nextStep(g);
      return;
    case 8:
      m.w32(g.pv(A.STEP), 0);
      m.w32(g.pv(A.SUBSTEP), 0);
      m.w32(g.pv(A.STEP4), 0);
      m.w32(g.pv(A.SCREEN), 5);
      return;
  }
}

// ---- screen 5: play ----

const PLAY_STEPS: ((g: Game) => void)[] = [playSpawn, playFall, playLineCheck, playClearAnim, playCollapse, playNext, () => {}, () => {}];

export function scr05Play(g: Game): void {
  const m = g.m;
  PLAY_STEPS[step(g)](g);
  pieceFlashDraw(g);
  linesPopup(g);
  profDispatch(g);
  ceilingDispatch(g);
  ceilingCrush(g);
  debrisUpdate(g);
  bestTimeDraw(g);
  if (v(g, V.STAGE_FLAGS) & 4) toScreen(g, 9);
  if (v(g, V.LOSE_FLAGS) & 2) {
    debrisClearAll(g);
    objectsClearPopups(g);
    objectsClearPieceFlash(g);
    objectsClearLineFlash(g);
    objectClear(g, g.ob + 0x131);
    toScreen(g, 6);
  }
}
