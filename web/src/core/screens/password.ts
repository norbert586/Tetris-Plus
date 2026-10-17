// Password entry (menu step 3, password_step_dispatch) and the codec (docs/spec/password.md).
import * as A from '../addr';
import type { Game } from '../game';
import { DPAD_DX, DPAD_DY, menuDpadRepeat } from '../dpad';
import { objectClear, objectPut2, objectsClear } from '../objects';
import { sePlay } from '../sound';
import * as V from '../vars';

export const PW_STEP = 0x800ee4f4; // [2] password_step_dispatch's state
const PW_ERROR_TIMER = 0x800eeb78; // [2]
const SYMBOLS = V.PASSWORD_SYMBOLS; // s32[2][6]
const sym = (g: Game, k: number) => SYMBOLS + g.p * 0x18 + 4 * k;

export function passwordStep(g: Game): void {
  STEPS[g.m.s32(g.pv(PW_STEP))](g);
}

/** Symbol k's object shows symbol s (FUN_800B420C); 7 is drawn as a blank. */
function symbolDraw(g: Game, k: number, s: number): void {
  const m = g.m;
  const n = k + g.ob + 0x196;
  const frame = A.obj(g.ob + 0x194);
  if (s === 7) {
    objectClear(g, n);
  } else {
    const o = A.obj(n);
    m.w32(o + A.O_IMAGE, s + 0x103c0);
    m.w32(o + A.O_FLIP, 0);
    m.w32(o + A.O_Y, (m.s16(frame + A.O_Y + 2) + 0x14) * 0x10000);
  }
  const o = A.obj(n);
  m.w32(o + A.O_X, (m.s16(frame + A.O_X + 2) + k * 0x13 + 9) * 0x10000);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, m.s32(frame + A.O_20));
}

const STEPS: ((g: Game) => void)[] = [
  // password_entry_init
  (g) => {
    const m = g.m;
    objectPut2(g, 0x192, 0x407, 0, 8);
    m.w32(A.obj(g.ob + 0x192) + A.O_PALETTE, g.p);
    objectPut2(g, 0x194, 0x3d5, 0xe, 0x45);
    objectPut2(g, 0x193, 0x3b3, 0x10, 0x7e);
    m.w32(g.pv(V.PASSWORD_CURSOR), 0);
    for (let k = 0; k < 6; k++) {
      m.w32(sym(g, k), 0);
      symbolDraw(g, k, 0);
    }
    m.add32(g.pv(PW_STEP), 1);
  },
  // password_entry: Up/Down change the symbol, Left/Right move, Cross submits, Circle leaves.
  (g) => {
    const m = g.m;
    menuDpadRepeat(g);
    const dy = m.s32(DPAD_DY);
    if (dy !== 0) {
      const a = sym(g, m.s32(g.pv(V.PASSWORD_CURSOR)));
      let s = m.s32(a) + dy;
      if (s < 0) s = 7;
      if (s > 7) s = 0;
      m.w32(a, s);
      symbolDraw(g, m.s32(g.pv(V.PASSWORD_CURSOR)), s);
      sePlay(g, 3);
    }
    const dx = m.s32(DPAD_DX);
    if (dx !== 0) {
      let c = m.s32(g.pv(V.PASSWORD_CURSOR)) + dx;
      if (c < 0) c = 5;
      if (c > 5) c = 0;
      m.w32(g.pv(V.PASSWORD_CURSOR), c);
      sePlay(g, 3);
    }
    if (g.pressed() & 0x40) {
      m.add32(g.pv(PW_STEP), 1);
    } else if (g.pressed() & 0x20) {
      objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
      m.w32(g.pv(PW_STEP), 0);
      m.w32(g.pv(A.STEP), 0);
      sePlay(g, 0x12);
    }
  },
  passwordDecode,
  // password_error
  (g) => {
    sePlay(g, 2);
    objectPut2(g, 0x19c, 0x3d3, 5, 0x58);
    g.m.w32(g.pv(PW_ERROR_TIMER), 0x78);
    g.m.add32(g.pv(PW_STEP), 1);
  },
  // 0x800B3E84: the error shows 120 frames, or until a face button.
  (g) => {
    if (g.pressed() & 0xf0 || g.m.add32(g.pv(PW_ERROR_TIMER), -1) < 0) {
      objectClear(g, g.ob + 0x19c);
      g.m.w32(g.pv(PW_STEP), 1);
    }
  },
];

const popcount14 = (v: number) => {
  let n = 0;
  for (let i = 0; i < 14; i++) if ((v >> i) & 1) n++;
  return n;
};

/** password_decode (0x800B3AD8) */
function passwordDecode(g: Game): void {
  const m = g.m;
  let v = 0;
  for (let k = 0; k < 6; k++) v = (v << 3) | (m.s32(sym(g, k)) & 7);
  v ^= 0x2aaa;
  const ones = popcount14(v);
  const cleared = v & 0x1f;
  const zone = (v >> 5) & 7;
  const stage = (v >> 8) & 0x3f;
  m.w32(g.pv(V.PASSWORD_VALUE), v >> 14);
  const ok =
    ((v >> 14) & 0xf) === ones &&
    zone < 5 &&
    stage < 0x14 &&
    (v & 0x10 ? cleared === 0x1f && zone === 0 && stage === 0 : cleared !== 0x1f || (zone === 0 && stage === 0));
  if (!ok) {
    m.w32(g.pv(PW_STEP), 3);
    return;
  }
  m.w32(g.pv(V.ZONES_CLEARED), cleared);
  m.w32(g.pv(V.ZONE), zone);
  m.w32(g.pv(V.STAGE), stage);
  objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
  m.w32(g.pv(PW_STEP), 0);
  m.w32(g.pv(V.SCORE), 0);
  m.w32(g.pv(0x800ee738), 0);
  m.fill(0x800eea4c + g.p * 0x1c, 7 * 4);
  sePlay(g, 0);
  if (m.s32(g.pv(V.ZONES_CLEARED)) === 0x1f) {
    m.w32(g.pv(V.HUNDRED_AUTO), 1);
    m.w32(g.pv(V.HUNDRED), 1);
  }
  m.w32(g.pv(A.SCREEN), 3);
  m.w32(g.pv(A.STEP), 0);
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** The password for a state (password_encode, 0x800B401C): six symbols, left to right. */
export function passwordEncode(zonesCleared: number, zone: number, stage: number): number[] {
  let v = zonesCleared;
  if (zonesCleared !== 0x1f) v |= (zone << 5) | ((stage % 20) << 8);
  v |= popcount14(v & 0x3fff) << 14;
  v ^= 0x2aaa;
  const out: number[] = [];
  for (let k = 0; k < 6; k++) out.push((v >> (3 * (5 - k))) & 7);
  return out;
}

/** password_show (0x800B3F28): the frame at (x, y) and the current game's six symbols. */
export function passwordShow(g: Game, x: number, y: number, layer: number): void {
  const m = g.m;
  const o = A.obj(g.ob + 0x194);
  m.w32(o + A.O_IMAGE, 0x103d5);
  m.w32(o + A.O_X, x << 16);
  m.w32(o + A.O_Y, y << 16);
  m.w32(o + A.O_PLAYER, g.p);
  m.w32(o + A.O_20, layer);
  const zc = m.s32(g.pv(V.ZONES_CLEARED));
  let v = zc;
  if (zc !== 0x1f) v |= (m.s32(g.pv(V.ZONE)) << 5) | ((m.s32(g.pv(V.STAGE)) % 20) << 8);
  v = (popcount14(v) << 14) | v;
  v ^= 0x2aaa;
  for (let i = 0; i < 6; i++) {
    symbolDraw(g, 5 - i, v & 7);
    v >>= 3;
  }
  m.w32(g.pv(V.PASSWORD_VALUE), v);
}
