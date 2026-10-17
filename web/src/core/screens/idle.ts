// Screen 8: not playing, "PRESS START" (idle_step_dispatch). In one-player play player 2 sits
// here from the first tick. Its character's idle animation draws random numbers, which shifts
// player 1's pieces, so it runs even though the port doesn't draw it (docs/spec/frame.md §4,
// docs/RESEARCH_AND_PLAN.md §9). Start on this pad joins the game: the port keeps the code, the
// shell keeps pad 2's Start off until two-player mode exists.
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animTick, objectMove, objectsClear } from '../objects';
import { debrisClearAll, objectsClearBoard, boardObjectsLayout, objectsClearPopups, objectsClearPieceFlash } from '../play/objects';
import { BGM_JOIN_P1, BGM_JOIN_P2 } from '../sound';

const ANIM_STATE = 0x800ee408; // [2] which idle animation
const ANIM_SUB = 0x800ee998; // [2] its sub-step
const IDLE_CHOICES = 0x80094474; // int[16]: the next animation, by rand() & 15
const X_STEP = 0x800944cc; // int[2]: +1 px, -1 px

/** The character: object 0x118 of the player's range. */
const charObj = (g: Game) => g.ob + 0x118;
const co = (g: Game) => A.obj(charObj(g));

const sub = (g: Game) => g.m.s32(g.pv(ANIM_SUB));
const nextSub = (g: Game) => g.m.add32(g.pv(ANIM_SUB), 1);
function setAnim(g: Game, state: number) {
  g.m.w32(g.pv(ANIM_STATE), state);
  g.m.w32(g.pv(ANIM_SUB), 0);
}
const animDone = (g: Game) => g.m.s32(co(g) + A.O_ANIM) === 0;

export function scr08Idle(g: Game): void {
  if (g.m.s32(g.pv(A.STEP)) === 0) idleSetup(g);
  else idleRun(g);
}

/** Step 0 (0x800A599C): clear the play area's objects, show the panel and the character. */
function idleSetup(g: Game): void {
  const m = g.m;
  const p = g.p;
  const ob = g.ob;
  objectsClear(g, p * 400 + 0x1e, p * 400 + 0x1ae);
  boardObjectsLayout(g);
  objectsClearBoard(g);
  debrisClearAll(g);
  objectsClearPopups(g);
  objectsClearPieceFlash(g);
  m.w32(A.obj(ob + 0xe5) + A.O_IMAGE, 0);
  let o = A.obj(ob + 0x1e);
  m.w32(o + A.O_IMAGE, 0x1012c);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0x80000);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 2);
  o = A.obj(ob + 0x119);
  m.w32(o + A.O_IMAGE, 0x10022);
  m.w32(o + A.O_X, 0x270000);
  m.w32(o + A.O_Y, 0x600000);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 2);
  o = A.obj(ob + 0x118);
  m.w32(o + A.O_IMAGE, 0x103f3);
  m.w32(o + A.O_X, 0x3f0000);
  m.w32(o + A.O_Y, 0x580000);
  m.w32(o + A.O_PLAYER, p);
  m.w32(o + A.O_20, 2);
  m.w32(o + A.O_PALETTE, p);
  setAnim(g, 0);
  if (g.p === 0) {
    m.w32(BGM_JOIN_P1, 0);
    if (m.s32(A.SCREEN + 4) !== 8) m.w32(BGM_JOIN_P2, 1);
  } else {
    m.w32(BGM_JOIN_P2, 0);
    if (m.s32(A.SCREEN) !== 8) m.w32(BGM_JOIN_P1, 1);
  }
  m.add32(g.pv(A.STEP), 1);
}

/** Step 1 (0x800A5BC0): Start joins (back to the menu); otherwise the idle animation. */
function idleRun(g: Game): void {
  const m = g.m;
  if (g.pressed() & 0x800) {
    m.w32(g.pv(A.SCREEN), 0);
    if (g.p === 0) m.w32(BGM_JOIN_P1, m.s32(BGM_JOIN_P2) === 0 ? 1 : 0);
    else m.w32(BGM_JOIN_P2, m.s32(BGM_JOIN_P1) === 0 ? 1 : 0);
    m.w32(g.pv(A.STEP), 0);
    m.w32(g.pv(A.SUBSTEP), 0);
    m.w32(g.pv(A.STEP4), 0);
    return;
  }
  const state = m.s32(g.pv(ANIM_STATE));
  const fn = ANIMS[state]?.[state === 9 ? 0 : sub(g)];
  if (fn) fn(g);
}

// ---- the sub-steps (one function each in the original) ----

/** 0x800A5DBC: animation 0x28, wait 64 frames. */
function enter0(g: Game) {
  animSet(g, charObj(g), 0x28);
  g.m.w32(co(g) + A.O_4C, 0x40);
  nextSub(g);
}
/** 0x800A5E98 */
function enter1(g: Game) {
  const o = co(g);
  if (g.m.add32(o + A.O_4C, -1) < 0) {
    g.m.w32(o + A.O_VY, -0x40000);
    g.m.w32(o + A.O_VX, 0);
    nextSub(g);
  }
}
/** 0x800A5F10: jump up, decelerating. */
function enter2(g: Game) {
  animTick(g, charObj(g));
  objectMove(g, charObj(g));
  const o = co(g);
  if (g.m.add32(o + A.O_VY, 0x4000) === 0) {
    animSet(g, charObj(g), 0x29);
    nextSub(g);
  }
}
/** 0x800A6030: fall back to y = 63. */
function enter3(g: Game) {
  const m = g.m;
  const o = co(g);
  if (m.s32(o + A.O_Y) < 0x3f0000) {
    animTick(g, charObj(g));
    objectMove(g, charObj(g));
    m.add32(co(g) + A.O_VY, 0x4000);
  } else {
    animSet(g, charObj(g), 0x2a);
    m.w32(co(g) + A.O_Y, 0x3f0000);
    nextSub(g);
  }
}
/** 0x800A61BC */
function enter4(g: Game) {
  animTick(g, charObj(g));
  if (animDone(g)) setAnim(g, 1);
}

/** 0x800A6300: stand, wait rand() & 255 frames. */
function stand0(g: Game) {
  const m = g.m;
  const o = co(g);
  m.w32(o + A.O_IMAGE, 0x103f5);
  m.w32(o + A.O_Y, 0x3f0000);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 2);
  m.w32(co(g) + A.O_4C, g.rand() & 0xff);
  nextSub(g);
}
/** 0x800A63DC */
function stand1(g: Game) {
  if (g.m.add32(co(g) + A.O_4C, -1) < 1) nextSub(g);
}
/** 0x800A6448: pick the next animation. */
function stand2(g: Game) {
  const r = g.rand();
  setAnim(g, g.m.s32(IDLE_CHOICES + 4 * (r & 15)));
}

/** 0x800A6580: face the way it walks. */
function faceWalk(g: Game) {
  const o = co(g);
  g.m.w32(o + A.O_FLIP, g.m.s32(o + A.O_VX) < 1 ? 0 : 1);
}
/** 0x800A64E8: at the edge it walks toward. */
function atEdge(g: Game): boolean {
  const o = co(g);
  const x = g.m.s16(o + A.O_X + 2);
  if (g.m.s32(o + A.O_VX) < 0) return !(x > 0x26);
  return !(x < 0x5a);
}

/** 0x800A6680: walk for 128 + rand() & 255 frames, direction by rand() & 1. */
function walk0(g: Game) {
  const m = g.m;
  m.w32(co(g) + A.O_4C, (g.rand() & 0xff) + 0x80);
  const r = g.rand();
  const o = co(g);
  m.w32(o + A.O_VX, m.s32(X_STEP + 4 * (r & 1)));
  m.w32(o + A.O_VY, 0);
  animSet(g, charObj(g), 0x2b);
  faceWalk(g);
  nextSub(g);
}
/** 0x800A67B0: walk a pixel every other frame; turn at an edge. */
function walk1(g: Game) {
  const m = g.m;
  if (m.add32(co(g) + A.O_4C, -1) < 0) {
    nextSub(g);
    return;
  }
  animTick(g, charObj(g));
  if (atEdge(g)) {
    m.w32(g.pv(ANIM_SUB), 4);
  } else if (g.counter & 1) {
    objectMove(g, charObj(g));
  }
}
/** 0x800A68E8 */
function walk2(g: Game) {
  const o = co(g);
  g.m.w32(o + A.O_VX, 0);
  g.m.w32(o + A.O_ANIM, 0);
  setAnim(g, 1);
}
/** 0x800A6954 */
function nop(_g: Game) {}
/** 0x800A695C: turn round. */
function walk4(g: Game) {
  const o = co(g);
  g.m.w32(o + A.O_VX, -g.m.s32(o + A.O_VX));
  animSet(g, charObj(g), 0x2c);
  nextSub(g);
}
/** 0x800A6A18 */
function walk5(g: Game) {
  animTick(g, charObj(g));
  if (animDone(g)) {
    animSet(g, charObj(g), 0x2b);
    faceWalk(g);
    objectMove(g, charObj(g));
    g.m.w32(g.pv(ANIM_SUB), 1);
  }
}

/** Starts animation `id` and goes to the next sub-step. */
const play = (id: number) => (g: Game) => {
  animSet(g, charObj(g), id);
  nextSub(g);
};
/** Waits for the animation to end. */
function playWait(g: Game) {
  animTick(g, charObj(g));
  if (animDone(g)) nextSub(g);
}
/** Back to standing. */
const toStand = (g: Game) => setAnim(g, 1);

/** 0x800A6E00: animation 0x2E for 255 + rand() & 127 frames. */
function long0(g: Game) {
  g.m.w32(co(g) + A.O_ANIM, 0x2e);
  g.m.w32(co(g) + A.O_4C, (g.rand() & 0x7f) + 0xff);
  animSet(g, charObj(g), 0x2e);
  nextSub(g);
}
/** 0x800A6EE4 */
function long1(g: Game) {
  if (g.m.add32(co(g) + A.O_4C, -1) < 0) nextSub(g);
  animTick(g, charObj(g));
}

// ANIMS[state][sub]; state 9's entry is a plain function, not a table (it reruns enter0).
const ANIMS: ((g: Game) => void)[][] = [
  [enter0, enter1, enter2, enter3, enter4],
  [stand0, stand1, stand2],
  [walk0, walk1, walk2, nop, walk4, walk5],
  [play(0x2f), playWait, toStand],
  [play(0x2d), playWait, play(0x2f), playWait, long0, long1, play(0x31), playWait, play(0x30), playWait, toStand],
  [play(0x2d), playWait, toStand],
  [play(0x30), playWait, toStand],
  [play(0x31), playWait, toStand],
  [play(0x32), playWait, toStand],
  [enter0],
];

