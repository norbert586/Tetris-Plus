// The professor (docs/spec/professor.md): states, the animation-script interpreter, sensors,
// the decision chain, winning and losing. Scripts are read from the program's data, where the
// original keeps them, so script pointers equal the original's.
import * as A from './addr';
import type { Game } from './game';
import { animSet, animTick, objectClear } from './objects';
import { bgmRequest, sePlay, BGM_STOP } from './sound';
import * as V from './vars';
import { debrisClearAll, objectsClearPieceFlash, objectsClearPopups } from './play/objects';
import { bestTimeDraw, numberDraw, scoreDraw } from './play/hud';
import { bestTimeAddr, cellAddr, recordField } from './play/stage';
import { objectPut2 } from './objects';

const SCRIPTS = 0x800e0738; // pointer per action
const SENSOR_OFFSETS = 0x800e27f0; // (dcol, drow) x 10, facing right then left
const OP_FLAG = 0x800ee95c; // [2] set by end and jump
const PREV_CHANNEL = 0x800ee8cc; // stride 0x10
const PREV_WAIT = 0x800ee8d4; // stride 0x10
const PREV_SCRIPT = 0x800ee8d8; // stride 0x10
const PROF_OBJ = 0x28; // his sprite
const PROF_OBJ2 = 0x100; // second sprite for some images

// ---- per-player variable helpers ----
const v = (g: Game, a: number) => g.m.s32(g.pv(a));
const set = (g: Game, a: number, x: number) => g.m.w32(g.pv(a), x);
const sensor = (g: Game, i: number) => g.m.s32(V.PROF_SENSORS + g.p * 0x28 + 4 * i);
const channelScript = (g: Game, ch: number) => V.PROF_CHANNEL_SCRIPT + g.p * 0x10 + 4 * ch;
const channelAction = (g: Game, ch: number) => V.PROF_CHANNEL_ACTION + g.p * 0x10 + 4 * ch;
const curScript = (g: Game) => channelScript(g, v(g, V.PROF_ANIM_CHANNEL));
const ground = (g: Game) => sensor(g, 0) !== 0 || sensor(g, 1) !== 0;
const ahead = (g: Game) => sensor(g, 2) !== 0 || sensor(g, 3) !== 0;
const low = (g: Game) => sensor(g, 4) !== 0 || sensor(g, 5) !== 0;
const high = (g: Game) => sensor(g, 6) !== 0 || sensor(g, 7) !== 0;
const inside = (g: Game) => low(g) || high(g);
const behind = (g: Game) => sensor(g, 8) !== 0 || sensor(g, 9) !== 0;

/** prof_dispatch on prof_state. */
export function profDispatch(g: Game): void {
  switch (v(g, V.PROF_STATE)) {
    case 0:
      profPlace(g);
      g.m.add32(g.pv(V.PROF_STATE), 1);
      return;
    case 1:
      profSetAction(g, 0x17, 1);
      g.m.add32(g.pv(V.PROF_STATE), 1);
      return;
    case 2:
      profEntered(g);
      return;
    case 3:
      profWalk(g);
      return;
    case 4:
      LOST[v(g, V.PROF_SUBSTATE)](g);
      return;
    case 5:
      GOAL[v(g, V.PROF_SUBSTATE)](g);
      return;
  }
}

/** prof_reset */
export function profReset(g: Game): void {
  const m = g.m;
  for (const a of [V.PROF_LIFTED, V.PROF_FALL_STATE, V.PROF_TURNS, V.PROF_FAKE_GROUND, V.PROF_ANIM_WAIT, V.PROF_ANIM_CHANNEL]) set(g, a, 0);
  m.fill(V.PROF_SENSORS + g.p * 0x28, 0x28);
  for (const a of [V.PROF_ACTION_DONE, V.PROF_ACTION, 0x800ee84c, V.PROF_FACING, V.PROF_COL, V.PROF_ROW, 0x800ee86c, 0x800ee874, V.PROF_HEADROOM, V.PROF_DANGER]) set(g, a, 0);
  m.fill(V.PROF_CHANNEL_SCRIPT + g.p * 0x10, 0x10);
  m.fill(V.PROF_CHANNEL_ACTION + g.p * 0x10, 0x10);
  m.fill(PREV_CHANNEL + g.p * 0x10, 0x10);
  for (const a of [V.LOSE_FLAGS, V.CLEAR_FLAGS, V.PROF_HOLD, V.STAGE_FLAGS, V.PROF_DANGER_PREV, V.PROF_FAST, V.RETIRE]) set(g, a, 0);
  objectClear(g, g.ob + PROF_OBJ);
  objectClear(g, g.ob + PROF_OBJ2);
}

/** prof_place: from the stage record. */
function profPlace(g: Game): void {
  const m = g.m;
  profReset(g);
  const o = A.obj(g.ob + PROF_OBJ);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, 1);
  m.w32(o + A.O_X, m.s32(recordField(g, 0)) * 10);
  m.w32(o + A.O_Y, m.s32(recordField(g, 4)) * 10);
  m.w32(o + A.O_PALETTE, g.p);
  set(g, V.PROF_COL, m.s16(recordField(g, 2)));
  set(g, V.PROF_ROW, m.s16(recordField(g, 6)));
  set(g, V.PROF_FACING, m.s32(recordField(g, 8)));
}

/** prof_entered (state 2) */
function profEntered(g: Game): void {
  if (v(g, V.PROF_ACTION_DONE) === 0) {
    profAnimTick(g);
    return;
  }
  g.m.w32(g.pv(V.STAGE_FLAGS), v(g, V.STAGE_FLAGS) | 1);
  g.m.add32(g.pv(V.PROF_STATE), 1);
  profSetAction(g, v(g, V.PROF_FACING) === 0 ? 0x18 : 0x19, 1);
}

/** prof_walk (state 3) */
function profWalk(g: Game): void {
  if (v(g, V.PROF_HOLD) !== 0) return;
  profAnimTick(g);
  profThink(g);
  profCheckCrushed(g);
  if (v(g, V.RETIRE) === 1 && v(g, V.LOSE_FLAGS) === 0) {
    set(g, V.LOSE_FLAGS, 1);
    g.m.add32(g.pv(V.PROF_STATE), 1);
  } else {
    profCheckGoal(g);
  }
}

// ---- animation channels and the interpreter (professor.md §2) ----

/** prof_set_action */
export function profSetAction(g: Game, action: number, ch: number): void {
  const m = g.m;
  const cur = v(g, V.PROF_ANIM_CHANNEL);
  m.w32(PREV_CHANNEL + g.p * 0x10, cur);
  m.w32(V.PROF_PREV_ACTION + g.p * 0x10, m.s32(channelAction(g, cur)));
  m.w32(PREV_WAIT + g.p * 0x10, v(g, V.PROF_ANIM_WAIT));
  m.w32(PREV_SCRIPT + g.p * 0x10, m.s32(channelScript(g, cur)));
  set(g, V.PROF_ANIM_CHANNEL, ch);
  m.w32(channelAction(g, ch), action);
  set(g, V.PROF_ANIM_WAIT, 0);
  m.w32(channelScript(g, ch), m.s32(SCRIPTS + 4 * action));
}

/** prof_anim_tick: returns -1 while a wait counts down, else 0. */
export function profAnimTick(g: Game): number {
  set(g, V.PROF_ACTION_DONE, 0);
  set(g, OP_FLAG, 0);
  if (v(g, V.PROF_ANIM_WAIT) < 1) {
    profScriptRun(g);
    return 0;
  }
  g.m.add32(g.pv(V.PROF_ANIM_WAIT), -1);
  return -1;
}

/** prof_script_run (0x800A07F4) */
function profScriptRun(g: Game): void {
  set(g, V.PROF_ANIM_WAIT, 0);
  if (v(g, V.PROF_ACTION_DONE) !== 0) return;
  while (g.m.s32(curScript(g)) !== 0) {
    profScriptOp(g);
    if (v(g, V.PROF_ANIM_WAIT) !== 0 || v(g, V.PROF_ACTION_DONE) !== 0) return;
  }
}

/** prof_channel_pop (0x800A10C8) */
function profChannelPop(g: Game): void {
  const m = g.m;
  const chA = g.pv(V.PROF_ANIM_CHANNEL);
  let ch: number;
  do {
    const old = m.s32(chA);
    m.w32(PREV_CHANNEL + g.p * 0x10, old);
    if (old > 0) m.w32(chA, old - 1);
    ch = m.s32(chA);
    m.w32(V.PROF_PREV_ACTION + g.p * 0x10, v(g, V.PROF_ACTION));
    m.w32(PREV_WAIT + g.p * 0x10, v(g, V.PROF_ANIM_WAIT));
    m.w32(PREV_SCRIPT + g.p * 0x10, m.s32(channelScript(g, ch)));
    m.w32(channelScript(g, old), 0);
    set(g, V.PROF_ANIM_WAIT, 0);
    m.w32(channelAction(g, old), 0);
  } while (ch !== 0 && m.s32(channelScript(g, ch)) === 0);
}

/** prof_script_op: one opcode (professor.md §2.2). */
function profScriptOp(g: Game): void {
  const m = g.m;
  const sp = curScript(g);
  const s = m.u32(sp);
  const arg = (k: number) => m.s32(s + 4 * k);
  switch (m.s32(s)) {
    case 0: // end
      set(g, V.PROF_ACTION_DONE, 1);
      profChannelPop(g);
      set(g, OP_FLAG, 1);
      return;
    case 1: {
      // image
      let n = PROF_OBJ;
      if (arg(5) !== 0) {
        n = PROF_OBJ2;
        const o2 = A.obj(g.ob + PROF_OBJ2);
        const o1 = A.obj(g.ob + PROF_OBJ);
        m.w32(o2 + A.O_20, m.s32(o1 + A.O_20));
        m.w32(o2 + A.O_PLAYER, m.s32(o1 + A.O_PLAYER));
        m.w32(o2 + A.O_X, m.s32(o1 + A.O_X));
        m.w32(o2 + A.O_Y, m.s32(o1 + A.O_Y));
        m.w32(o2 + A.O_PALETTE, g.p);
      }
      const o = A.obj(n + g.ob);
      m.w32(o + A.O_IMAGE, arg(1) + 0x10000);
      m.w32(o + A.O_18, g.p);
      m.w32(o + A.O_FLIP, arg(4));
      m.w32(sp, s + 0x18);
      return;
    }
    case 2: // wait
      set(g, V.PROF_ANIM_WAIT, v(g, V.PROF_FAST) > 0 ? 1 : arg(1));
      m.w32(sp, s + 8);
      return;
    case 3: // move_cell
      g.m.add32(g.pv(V.PROF_COL), arg(1));
      g.m.add32(g.pv(V.PROF_ROW), arg(2));
      m.w32(sp, s + 0xc);
      return;
    case 4: // jump
      if (arg(1) === 0) m.w32(sp, m.s32(SCRIPTS + 4 * m.s32(channelAction(g, v(g, V.PROF_ANIM_CHANNEL)))));
      else m.w32(sp, arg(1) * 4 + s);
      set(g, OP_FLAG, 1);
      return;
    case 5: // sound
      sePlay(g, arg(1));
      m.w32(sp, s + 8);
      return;
    case 6: {
      // nudge_px
      const o = A.obj(g.ob + PROF_OBJ);
      m.add32(o + A.O_X, arg(1) * 0x10000);
      m.add32(o + A.O_Y, arg(2) * 0x10000);
      m.w32(sp, s + 0xc);
      return;
    }
    case 7: // hide
      if (arg(1) === 0) m.w32(A.obj(g.ob + PROF_OBJ) + A.O_IMAGE, 0);
      m.w32(A.obj(g.ob + PROF_OBJ2) + A.O_IMAGE, 0);
      m.w32(sp, s + 0xc);
      return;
    default:
      throw new Error(`professor: bad opcode ${m.s32(s)} at ${s.toString(16)}`);
  }
}

// ---- sensors and decisions (professor.md §3-§5) ----

/** prof_sense */
export function profSense(g: Game): void {
  const m = g.m;
  const base = V.PROF_SENSORS + g.p * 0x28;
  m.fill(base, 0x28);
  const facing = v(g, V.PROF_FACING);
  for (let i = 0; i < 10; i++) {
    const off = SENSOR_OFFSETS + i * 8 + facing * 0x50;
    const col = v(g, V.PROF_COL) + m.s32(off);
    const row = v(g, V.PROF_ROW) + m.s32(off + 4);
    let value: number;
    if (i < 2 && v(g, V.PROF_FAKE_GROUND) !== 0) value = 8;
    else if (col >>> 0 < 10 && row >>> 0 < 0x10) value = m.s32(cellAddr(g, row * 10 + col));
    else value = -1;
    m.w32(base + 4 * i, value);
  }
}

/** prof_fall_distance: empty rows under both his columns. */
export function profFallDistance(g: Game): number {
  const m = g.m;
  if (ground(g)) return 0;
  const col = v(g, V.PROF_COL);
  let n = 0;
  for (let row = v(g, V.PROF_ROW) + 1; row < 0x10; row++) {
    if (m.s32(cellAddr(g, row * 10 + col)) !== 0 || m.s32(cellAddr(g, row * 10 + col + 1)) !== 0) break;
    n++;
  }
  return n;
}

/** Clears lifted, fall state and turns ("reset" in professor.md §5.2). */
function resetMotion(g: Game): void {
  set(g, V.PROF_LIFTED, 0);
  set(g, V.PROF_FALL_STATE, 0);
  set(g, V.PROF_TURNS, 0);
}

/** prof_think (0x8009F50C) */
export function profThink(g: Game): void {
  const m = g.m;
  // §5.1: cleared rows carry him down while he climbs out from under blocks.
  if ((v(g, V.PROF_ACTION) - 0xc) >>> 0 < 2 && v(g, V.LINES_FOR_PROFESSOR) > 0) {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      if (m.s32(V.FULL_ROWS + g.p * 0x14 + 4 * i) !== 0 && v(g, V.PROF_ROW) - 1 <= v(g, V.LOCK_TOP_ROW) - (i - 4)) n++;
    }
    m.add32(g.pv(V.PROF_ROW), n);
    m.add32(A.obj(g.ob + PROF_OBJ) + A.O_Y, n * 0xa0000);
  }
  set(g, V.LINES_FOR_PROFESSOR, 0);
  profSense(g);
  // §4: headroom, danger and its music.
  const headroom = v(g, V.PROF_ROW) - Math.trunc((v(g, V.CEILING_Y) >> 16) / 10);
  set(g, V.PROF_HEADROOM, headroom);
  set(g, V.PROF_DANGER, headroom < 5 ? 1 : 0);
  if (v(g, V.PROF_DANGER) !== v(g, V.PROF_DANGER_PREV)) {
    set(g, V.PROF_DANGER_PREV, v(g, V.PROF_DANGER));
    bgmRequest(g, v(g, V.PROF_DANGER) === 0 ? Math.trunc(v(g, V.STAGE) / 10) + 0x23 : 0x25);
  }
  // §5.2: the decision chain.
  const ch = v(g, V.PROF_ANIM_CHANNEL);
  const action = m.s32(channelAction(g, ch));
  set(g, V.PROF_ACTION, action);
  const prev = m.s32(V.PROF_PREV_ACTION + g.p * 0x10);
  const facing = v(g, V.PROF_FACING);
  const danger = v(g, V.PROF_DANGER) !== 0;
  const choose = (a: number, c: number, flip = false) => {
    profSetAction(g, a, c);
    if (flip) set(g, V.PROF_FACING, v(g, V.PROF_FACING) ^ 1);
  };
  if (ch > 2) return;
  if (action === 8 || action === 9 || action === 0xb || action === 0x10) return;
  if (v(g, V.PROF_FALL_STATE) === 3 && prev === 0xb && ground(g) && !inside(g)) {
    resetMotion(g);
    return choose(0x10, 2);
  }
  if (action === 0xe || action === 0xf) return;
  if (v(g, V.PROF_FALL_STATE) === 2 && (prev - 8) >>> 0 < 2 && ground(g) && !inside(g)) {
    resetMotion(g);
    return choose(facing === 0 ? 0xf : 0xe, 2);
  }
  if (action === 10 || action === 0xb) return;
  if (v(g, V.PROF_FALL_STATE) === 3 && !ground(g)) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_FALL_STATE, 3);
    return choose(0xb, 2);
  }
  if (action === 10 || action === 8 || action === 9) return;
  if (v(g, V.PROF_LIFTED) === 0 && v(g, V.PROF_FAKE_GROUND) === 0 && profFallDistance(g) > 2) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_TURNS, 0);
    set(g, V.PROF_FALL_STATE, 3);
    return choose(10, 2);
  }
  if (action === 8 || action === 9) return;
  if (v(g, V.PROF_LIFTED) === 0 && v(g, V.PROF_FAKE_GROUND) === 0 && !ground(g)) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_TURNS, 0);
    set(g, V.PROF_FALL_STATE, 2);
    return choose(facing === 0 ? 8 : 9, 2);
  }
  if (ch > 1) return;
  if (action === 0x21) return;
  if (action === 0x15 && (!ground(g) || !ahead(g) || inside(g) || !behind(g))) {
    resetMotion(g);
    return choose(0x21, 1);
  }
  if (action === 0x15) {
    if (danger) {
      set(g, V.PROF_LIFTED, 0);
      set(g, V.PROF_FALL_STATE, 0);
      return choose(0x21, 1);
    }
    return;
  }
  if (v(g, V.PROF_TURNS) >= 8 && !danger) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_FALL_STATE, 0);
    return choose(0x15, 1);
  }
  if (v(g, V.PROF_ACTION_DONE) === 0) return;
  if (m.s32(channelScript(g, ch)) !== 0) return;
  if (danger && v(g, V.PROF_TURNS) > 6) {
    if (ahead(g) && !inside(g) && behind(g)) {
      set(g, V.PROF_LIFTED, 0);
      set(g, V.PROF_FALL_STATE, 0);
      return choose(0x1f, 1);
    }
    set(g, V.PROF_TURNS, 0);
  }
  const noLines = v(g, V.LINES_FOUND) === 0;
  if (high(g) && noLines) {
    set(g, V.PROF_FALL_STATE, 0);
    set(g, V.PROF_TURNS, 0);
    set(g, V.PROF_LIFTED, 1);
    return choose(0xd, 1);
  }
  if (low(g) && noLines) {
    set(g, V.PROF_FALL_STATE, 0);
    set(g, V.PROF_TURNS, 0);
    set(g, V.PROF_LIFTED, 1);
    return choose(0xc, 1);
  }
  if (danger && ahead(g)) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_FALL_STATE, 0);
    m.add32(g.pv(V.PROF_TURNS), 1);
    return choose(facing === 0 ? 0x22 : 0x23, 1, true);
  }
  if (ahead(g)) {
    set(g, V.PROF_LIFTED, 0);
    set(g, V.PROF_FALL_STATE, 0);
    m.add32(g.pv(V.PROF_TURNS), 1);
    return choose(facing === 0 ? 6 : 7, 1, true);
  }
  if (action === 3 || action === 5) return;
  if (!danger) {
    if (action === 2 || action === 4) return;
    resetMotion(g);
    return choose(facing === 0 ? 2 : 4, 0);
  }
  resetMotion(g);
  choose(facing === 0 ? 3 : 5, 0);
}

/** prof_check_crushed */
function profCheckCrushed(g: Game): void {
  if (v(g, V.PROF_DANGER) === 1 && v(g, V.PROF_HEADROOM) < 3) {
    set(g, V.LOSE_FLAGS, 1);
    g.m.add32(g.pv(V.PROF_STATE), 1);
    set(g, V.PROF_SUBSTATE, 0);
    set(g, V.CLEAR_COUNTDOWN, 0);
  }
}

/** prof_check_goal */
function profCheckGoal(g: Game): void {
  if (v(g, V.PROF_ROW) === 0xf && v(g, V.PROF_LIFTED) === 0 && v(g, V.LOSE_FLAGS) === 0) {
    bgmRequest(g, 0x2c);
    set(g, V.CLEAR_FLAGS, 1);
    g.m.add32(g.pv(V.PROF_STATE), 2);
    set(g, V.PROF_SUBSTATE, 0);
    set(g, V.CLEAR_COUNTDOWN, 0);
  }
}

/** prof_fast_check: any of the low-byte buttons held speeds up waits. */
function profFastCheck(g: Game): void {
  set(g, V.PROF_FAST, g.m.u8(A.PAD_HELD + 6 * g.p) === 0 ? 0 : 1);
}

const nextSub = (g: Game) => g.m.add32(g.pv(V.PROF_SUBSTATE), 1);

// ---- lost sequence (state 4, professor.md §6.2) ----

/** FUN_800B1A84: the line-flash objects. */
export function objectsClearLineFlash(g: Game): void {
  for (const n of [0xde, 0xdf, 0xe0, 0xe1]) objectClear(g, g.ob + n);
}

const LOST: ((g: Game) => void)[] = [
  // prof_lost_start
  (g) => {
    bgmRequest(g, BGM_STOP);
    profSetAction(g, 0x14, 3);
    objectsClearLineFlash(g);
    objectsClearPieceFlash(g);
    objectsClearPopups(g);
    debrisClearAll(g);
    set(g, V.LOSE_FLAGS, v(g, V.LOSE_FLAGS) | 2);
    nextSub(g);
  },
  (g) => {
    profAnimTick(g);
    if (v(g, V.PROF_ACTION_DONE) !== 0) nextSub(g);
  },
  (g) => nextSub(g),
  (g) => {
    set(g, V.PROF_STATE, 0);
    set(g, V.PROF_SUBSTATE, 0);
    set(g, V.STAGE_FLAGS, v(g, V.STAGE_FLAGS) | 2);
  },
];

// ---- goal sequence (state 5, professor.md §6.1) ----

const PANEL_STATE = 0x800ee430; // [2] the result panel's sub-machine (FUN_80098DC8)
const PANEL_SEEN = 0x800f0bd4; // [2]
const TIME_BONUS = 0x800ee608; // [2]
const BONUS_GROUP = 0x800e28e0; // int[20] by stage: bonus table group (0 = none)
const BONUS_SCORE = 0x800e2920; // int[group][4] by (pieces - 1) / 10
const BONUS_ANIM = 0x800e2970;
const BONUS_IMAGE = 0x800e29c0;
const BONUS_SLOT = 0x800e2890; // int[20] by stage
const RECORD_FLASH_X = 0x800942b0; // int[4]
const PANEL_Y = 0x800e2744; // image per ceiling row
const VS_FLAG = 0x800f1288;

const bonusIndex = (g: Game, table: number) =>
  table + Math.trunc((v(g, V.PIECES_SPAWNED) - 1) / 10) * 4 + g.m.s32(BONUS_GROUP + (v(g, V.STAGE) % 20) * 4) * 0x10;

/** The result panel (FUN_80098DC8), run alongside the goal sequence's substates. */
function resultPanel(g: Game): void {
  PANEL[v(g, PANEL_STATE)](g);
}

const PANEL: ((g: Game) => void)[] = [
  // 0x80098E64: ten panel pieces fly in from precomputed positions.
  (g) => {
    const m = g.m;
    for (let i = 0; i < 10; i++) {
      const n = 0x127 + i + g.ob;
      const o = A.obj(n);
      const t = 0x800e267c + i * 20;
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 2);
      m.w32(o + A.O_IMAGE, m.s32(t));
      m.w32(o + A.O_X, m.s32(t + 4));
      m.w32(o + A.O_Y, m.s32(t + 8) - 0x80000);
      m.w32(o + A.O_VX, m.s32(t + 12));
      m.w32(o + A.O_VY, m.s32(t + 16));
      m.w32(o + A.O_SCALE_X, -0xf00);
      m.w32(o + A.O_SCALE_Y, -0xf00);
      for (let k = 0; k < 0x3c; k++) m.add32(o + A.O_Y, m.add32(o + A.O_VY, 0x5000));
      m.add32(o + A.O_X, m.s32(o + A.O_VX) * 0x3c);
    }
    m.w32(A.obj(g.ob + 0x127) + A.O_4C, 0x3b);
    m.add32(g.pv(PANEL_STATE), 1);
  },
  // 0x8009902C
  (g) => {
    const m = g.m;
    for (let i = 0; i < 10; i++) {
      const o = A.obj(0x127 + i + g.ob);
      m.add32(o + A.O_X, -m.s32(o + A.O_VX));
      const vy = m.add32(o + A.O_VY, -0x5000);
      m.add32(o + A.O_Y, -vy);
      m.add32(o + A.O_SCALE_X, 0x40);
      m.add32(o + A.O_SCALE_Y, 0x40);
    }
    if (m.add32(A.obj(g.ob + 0x127) + A.O_4C, -1) < 0) m.add32(g.pv(PANEL_STATE), 1);
  },
  // 0x80099128: the time bonus.
  (g) => {
    const m = g.m;
    objectPut2(g, 0x131, m.s32(PANEL_Y + Math.trunc((v(g, V.CEILING_Y) >> 16) / 10) * 4), 0x15, 0x5f);
    set(g, TIME_BONUS, 0);
    const t = v(g, V.STAGE_TIME);
    if (t < 600) {
      set(g, TIME_BONUS, t < 100 ? 20000 : Math.trunc(((600 - t) * 0x28 + 0x5a) / 100) * 100);
      m.add32(g.pv(V.SCORE), v(g, TIME_BONUS));
      scoreDraw(g);
    }
    set(g, PANEL_SEEN, v(g, V.PROF_SUBSTATE));
    m.add32(g.pv(PANEL_STATE), 1);
  },
  // 0x80099338
  (g) => {
    if (v(g, PANEL_SEEN) !== v(g, V.PROF_SUBSTATE)) g.m.add32(g.pv(PANEL_STATE), 1);
  },
  // 0x80099398: the result: time, time bonus, new record.
  (g) => {
    const m = g.m;
    m.w32(A.obj(g.ob + 0xe3) + A.O_IMAGE, 0);
    objectPut2(g, 0x131, 0x1a2, 0x15, 0x5f);
    if (m.s32(VS_FLAG) === 0) objectPut2(g, 0x132, 0x134, 0x2d, 0x67);
    const t = v(g, V.STAGE_TIME);
    numberDraw(g, Math.trunc(t / 10), 3, g.ob + 0x135, m.s32(0x800e2780 + g.p * 4), 0x7b, 0x140, 8);
    const o = A.obj(g.ob + 0x138);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 0);
    m.w32(o + A.O_IMAGE, 0x1014a);
    m.w32(o + A.O_X, m.s32(0x800e2798 + g.p * 4));
    m.w32(o + A.O_Y, 0x7b0000);
    numberDraw(g, t % 10, 1, g.ob + 0x139, m.s32(0x800e2788 + g.p * 4), 0x7b, 0x140, 8);
    objectPut2(g, 0x133, 0x135, 0x55, 0x7b);
    if (m.s32(VS_FLAG) === 0) {
      if (v(g, TIME_BONUS) < 1) {
        objectPut2(g, 0x13a, 0x139, 0x2d, 0x8f);
      } else {
        numberDraw(g, v(g, TIME_BONUS), 5, g.ob + 0x13a, m.s32(0x800e2790 + g.p * 4), 0x8f, 0x140, 8);
        objectPut2(g, 0x134, 0x136, 0x55, 0x8f);
      }
    }
    if (t < m.s16(bestTimeAddr(g))) {
      const r = A.obj(g.ob + 0x13f);
      m.w32(r + A.O_PLAYER, g.p);
      m.w32(r + A.O_20, 2);
      m.w32(r + A.O_IMAGE, 0x10138);
      m.w32(r + A.O_X, 0x250000);
      m.w32(r + A.O_Y, 0x7b0000);
      m.w32(r + A.O_VX, 0);
      m.w32(r + A.O_VY, -0x20000);
      m.w32(r + A.O_SCALE_X, 0);
      m.w32(r + A.O_SCALE_Y, 0);
      m.w32(r + A.O_4C, 0x2d);
      m.add32(g.pv(PANEL_STATE), 1);
    } else {
      m.add32(g.pv(PANEL_STATE), 2);
    }
  },
  // 0x80099768: "new record" rises; once the walk-off ends, the HUD's best time.
  (g) => {
    const m = g.m;
    const n = g.ob + 0x13f;
    const o = A.obj(n);
    if (m.add32(o + A.O_4C, -1) < 0) {
      objectClear(g, n);
    } else {
      m.add32(o + A.O_4C, -1);
      m.add32(o + A.O_Y, m.s32(o + A.O_VY));
      m.add32(o + A.O_VY, 0x1000);
      m.add32(o + A.O_SCALE_X, 0x20);
      m.add32(o + A.O_SCALE_Y, 0x20);
    }
    if (v(g, V.PROF_ACTION_DONE) === 1 && v(g, V.PROF_SUBSTATE) > 3) {
      bestTimeDraw(g);
      m.add32(g.pv(PANEL_STATE), 1);
    }
  },
  // 0x80099B10
  (g) => {
    if (v(g, V.PROF_SUBSTATE) > 5) {
      for (let n = 0x127; n < 0x140; n++) objectClear(g, n + g.ob);
      g.m.add32(g.pv(PANEL_STATE), 1);
    }
  },
  (g) => g.m.add32(g.pv(PANEL_STATE), 1),
  () => {},
];

/** FUN_80099BDC: a new record blinks the clock in three colours. */
function recordBlink(g: Game): void {
  const m = g.m;
  const t = v(g, V.STAGE_TIME);
  const c = g.counter;
  if (t < m.s16(bestTimeAddr(g)) && c % 3 === 0) {
    const k = Math.trunc(c / 3) % 3;
    numberDraw(g, Math.trunc(t / 10), 3, g.ob + 0xd9, m.s32(0x800e27a0 + g.p * 4), 0xc6, m.s32(0x800940f4 + 4 * k), 6);
    numberDraw(g, t % 10, 1, g.ob + 0xdd, m.s32(0x800e27a8 + g.p * 4), 0xd0, m.s32(0x80094100 + 4 * k), 6);
    m.w32(A.obj(g.ob + 0xdc) + A.O_IMAGE, m.s32(0x8009410c + 4 * k) + 0x10000);
  }
}

/** Walks him toward the middle (x = 40 px); true once there. */
const atCentre = (g: Game) => (g.m.u32(A.obj(g.ob + PROF_OBJ) + A.O_X) & 0xfffe0000) >>> 0 === 0x280000;

const GOAL: ((g: Game) => void)[] = [
  // 0 prof_goal_start
  (g) => {
    profSetAction(g, 0x20, 3);
    set(g, V.CLEAR_COUNTDOWN, 0xb4);
    set(g, V.STAGE_FLAGS, v(g, V.STAGE_FLAGS) | 4);
    set(g, PANEL_STATE, 0);
    set(g, 0x800ee9a4, 0);
    set(g, PANEL_SEEN, 0);
    nextSub(g);
  },
  // 1: celebration for 180 frames
  (g) => {
    profAnimTick(g);
    if (g.m.add32(g.pv(V.CLEAR_COUNTDOWN), -1) < 1) {
      set(g, V.CLEAR_FLAGS, v(g, V.CLEAR_FLAGS) | 8);
      nextSub(g);
      set(g, V.CLEAR_COUNTDOWN, 0);
    }
    resultPanel(g);
  },
  // 2: walk off (action 0x1A), facing the middle
  (g) => {
    profSetAction(g, 0x1a, 3);
    set(g, V.PROF_FACING, g.m.s32(A.obj(g.ob + PROF_OBJ) + A.O_X) < 0x280000 ? 0 : 1);
    set(g, V.CLEAR_COUNTDOWN, 0x34);
    resultPanel(g);
    nextSub(g);
  },
  // 3 prof_goal_record_time: the scene scrolls up 52 px; at the end the best time
  (g) => {
    const m = g.m;
    profAnimTick(g);
    if (v(g, V.CLEAR_COUNTDOWN) > 0) {
      for (let n = 0x1f; n < 0xd2; n++) m.add32(A.obj(n + g.ob) + A.O_Y, -0x10000);
      for (let n = 0xde; n < 0xf6; n++) m.add32(A.obj(n + g.ob) + A.O_Y, -0x10000);
      m.add32(g.pv(V.CLEAR_COUNTDOWN), -1);
    }
    recordBlink(g);
    if (v(g, V.PROF_ACTION_DONE) === 1) {
      bgmRequest(g, 0x2f);
      const best = bestTimeAddr(g);
      if (v(g, V.STAGE_TIME) < m.s16(best)) m.w16(best, v(g, V.STAGE_TIME));
      const t = v(g, V.STAGE_TIME);
      numberDraw(g, Math.trunc(t / 10), 3, g.ob + 0xd9, m.s32(RECORD_FLASH_X + g.p * 4), 0xc6, 0x411, 6);
      numberDraw(g, t % 10, 1, g.ob + 0xdd, m.s32(RECORD_FLASH_X + (g.p + 2) * 4), 0xd0, 0x41b, 6);
      m.w32(A.obj(g.ob + 0xdc) + A.O_IMAGE, 0x10427);
      nextSub(g);
    }
    resultPanel(g);
    profFastCheck(g);
  },
  // 4: piece bonus on stages with a bonus marker; walk toward the middle
  (g) => {
    const m = g.m;
    if (m.s32(A.obj(g.ob + 0x29) + A.O_IMAGE) !== 0) {
      if (v(g, V.PIECES_SPAWNED) > 0x1f) set(g, V.PIECES_SPAWNED, 0x1f);
      m.add32(g.pv(V.SCORE), m.s32(bonusIndex(g, BONUS_SCORE)));
      scoreDraw(g);
    }
    if (v(g, V.PROF_ACTION_DONE) !== 0) {
      if (atCentre(g)) nextSub(g);
      else profSetAction(g, v(g, V.PROF_FACING) === 0 ? 2 : 4, 0);
    }
    resultPanel(g);
    profFastCheck(g);
    nextSub(g);
  },
  // 5: keep walking to the middle
  (g) => {
    profAnimTick(g);
    if (atCentre(g)) nextSub(g);
    else if (v(g, V.PROF_ACTION_DONE) !== 0) profSetAction(g, v(g, V.PROF_FACING) === 0 ? 2 : 4, 0);
    resultPanel(g);
    profFastCheck(g);
  },
  // 6: the bonus marker, if any
  (g) => {
    const m = g.m;
    const n = g.ob + 0x29;
    if (m.s32(A.obj(n) + A.O_IMAGE) === 0 || m.s32(BONUS_GROUP + v(g, V.STAGE) * 4) < 1) {
      set(g, V.PROF_SUBSTATE, 0xd);
    } else {
      animSet(g, n, 0x22);
      profSetAction(g, 0x25, 0);
      nextSub(g);
    }
    resultPanel(g);
    profFastCheck(g);
  },
  // 7: the bonus rank appears once the marker's animation ends
  (g) => {
    const m = g.m;
    if (m.s32(A.obj(g.ob + 0x29) + A.O_ANIM) === 0) {
      const n = g.ob + 0x19f;
      const o = A.obj(n);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 1);
      if (v(g, V.PIECES_SPAWNED) > 0x1f) set(g, V.PIECES_SPAWNED, 0x1f);
      animSet(g, n, m.s32(bonusIndex(g, BONUS_ANIM)));
      m.w32(o + A.O_X, 0x280000);
      m.w32(o + A.O_Y, 0x760000);
      m.w32(o + A.O_VY, 0x4000);
      m.w32(o + A.O_4C, 0x24);
      m.w32(0x800eea4c + g.p * 0x1c + m.s32(BONUS_SLOT + (v(g, V.STAGE) % 20) * 4) * 4, m.s32(o + A.O_ANIM) - 7);
      nextSub(g);
    }
    animTick(g, g.ob + 0x29);
  },
  // 8
  (g) => {
    profAnimTick(g);
    sePlay(g, 0x26);
    animTick(g, g.ob + 0x19f);
    nextSub(g);
  },
  // 9: the rank rises for 37 frames, then its label
  (g) => {
    const m = g.m;
    profAnimTick(g);
    animTick(g, g.ob + 0x19f);
    const o = A.obj(g.ob + 0x19f);
    if (m.add32(o + A.O_4C, -1) < 0) {
      objectClear(g, g.ob + 0x29);
      const l = A.obj(g.ob + 0x19e);
      m.w32(l + A.O_PLAYER, g.p);
      m.w32(l + A.O_20, 1);
      m.w32(l + A.O_IMAGE, m.s32(bonusIndex(g, BONUS_IMAGE)));
      m.w32(l + A.O_X, 0x230000);
      m.w32(l + A.O_Y, 0xa50000);
      m.w32(l + A.O_VY, -0x8000);
      m.w32(l + A.O_VX, -0x8000);
      m.w32(l + A.O_4C, 0x30);
      m.w32(o + A.O_4C, m.s32(o + A.O_IMAGE));
      sePlay(g, 0x10);
      nextSub(g);
    } else {
      m.add32(o + A.O_Y, -m.s32(o + A.O_VY));
    }
    profFastCheck(g);
  },
  // 10: the label falls away while the rank blinks
  (g) => {
    const m = g.m;
    profAnimTick(g);
    const l = A.obj(g.ob + 0x19e);
    if (m.add32(l + A.O_4C, -1) < 1) {
      m.w32(l + A.O_IMAGE, 0);
      m.w32(A.obj(g.ob + 0x19f) + A.O_IMAGE, 0);
      nextSub(g);
    } else {
      m.add32(l + A.O_X, m.s32(l + A.O_VX));
      m.add32(l + A.O_Y, m.s32(l + A.O_VY));
      m.add32(l + A.O_VY, 0x800);
      const r = A.obj(g.ob + 0x19f);
      m.w32(r + A.O_IMAGE, m.u32(r + A.O_IMAGE) ^ m.u32(r + A.O_4C));
    }
  },
  // 11, 12
  (g) => {
    profAnimTick(g);
    profFastCheck(g);
    nextSub(g);
  },
  (g) => {
    profAnimTick(g);
    profFastCheck(g);
    nextSub(g);
  },
  // 13: on to the next stage (action 0x1B), or the zone's last stage
  (g) => {
    if (v(g, V.STAGE) < 0x13) {
      profSetAction(g, 0x1b, 0);
      nextSub(g);
    } else {
      set(g, V.PROF_SUBSTATE, 0xf);
    }
    objectClear(g, g.ob + 0x19e);
    objectClear(g, g.ob + 0x19f);
  },
  // 14
  (g) => {
    profAnimTick(g);
    if (v(g, V.PROF_ACTION_DONE) !== 0) nextSub(g);
    profFastCheck(g);
  },
  // 15
  (g) => {
    set(g, V.CLEAR_FLAGS, v(g, V.CLEAR_FLAGS) | 2);
    set(g, V.PROF_FAST, 0);
    set(g, 0x800ee70c, 0);
    set(g, V.PROF_STATE, 0);
    set(g, V.PROF_SUBSTATE, 0);
    set(g, V.CLEAR_COUNTDOWN, 0);
  },
];
