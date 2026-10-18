// Screens 6 (continue), 7 (rank check), 9 (stage clear) and 13 (save / password).
import * as A from '../addr';
import type { Game } from '../game';
import { animSet, animStartLoad, animTick, animTickLoad, itemLoad, objectClear, objectLoad2, objectPut2 } from '../objects';
import * as C from '../card';
import { bgmRequest, sePlay } from '../sound';
import * as V from '../vars';
import { profDispatch, objectsClearLineFlash } from '../professor';
import { numberDraw, scoreDraw } from '../play/hud';
import { debrisClearAll, objectsClearPieceFlash, objectsClearPopups } from '../play/objects';
import { passwordShow } from './password';
import { wipe } from './stage';

const PAUSE_GUARD = 0x800ee6a0;
const WIPE_STATE = 0x800ee964;
const COUNTDOWN_DIGIT = 0x800ee9bc; // [2]
const ITEMS = 0x800eea4c; // [2][7] bonus items collected this game
const ITEM_COUNT = 0x800ee738; // [2]
const RANK_POS = 0x800ee930; // [2]
const SAVE_CURSOR = 0x800f2d1c; // [2]

const step = (g: Game) => g.m.s32(g.pv(A.STEP));
const nextStep = (g: Game, n = 1) => g.m.add32(g.pv(A.STEP), n);
const v = (g: Game, a: number) => g.m.s32(g.pv(a));
/** The continue screen keeps its timers in the stage clock's sub-counter. */
const timer = (g: Game) => g.pv(V.STAGE_TIME_SUB);
function toScreen(g: Game, screen: number): void {
  const m = g.m;
  m.w32(g.pv(A.SCREEN), screen);
  m.w32(g.pv(A.STEP), 0);
  m.w32(g.pv(A.SUBSTEP), 0);
  m.w32(g.pv(A.STEP4), 0);
}

/** FUN_800B159C: animates the collected items' objects. */
function itemsAnimate(g: Game): void {
  let k = 0;
  for (let i = 0; i < 7; i++) {
    if (g.m.s32(ITEMS + g.p * 0x1c + 4 * i) !== 0) animTick(g, k++ + g.ob + 399);
  }
}

// ---- screen 6: continue ----

export const CONTINUE: ((g: Game) => void)[] = [
  // 0 (0x800A395C): the lost sequence plays out.
  (g) => {
    const m = g.m;
    profDispatch(g);
    if (v(g, V.STAGE_FLAGS) & 2) {
      const same = m.s32(A.STEP) === m.s32(A.STEP + 4) && m.s32(A.SCREEN) === m.s32(A.SCREEN + 4);
      m.w32(g.pv(V.INTRO_COUNTDOWN), same ? 0x42 : 0x40);
      nextStep(g);
    }
  },
  // 1 continue_start: "CONTINUE?" and a 9.
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(V.INTRO_COUNTDOWN), -1) >= 1) return;
    const o = A.obj(g.ob + 0x186);
    m.w32(o + A.O_IMAGE, 0x10188);
    m.w32(o + A.O_X, 0x10000);
    m.w32(o + A.O_Y, 0x320000);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 1);
    m.w32(timer(g), 0x5a);
    m.w32(g.pv(COUNTDOWN_DIGIT), 9);
    numberDraw(g, 9, 1, g.ob + 0x187, 0x28, 0x50, 0x17e, 0x20, 1);
    m.w32(g.pv(PAUSE_GUARD), 1);
    bgmRequest(g, 0x2e);
    sePlay(g, 3);
    nextStep(g);
  },
  // 2 continue_countdown: Start continues, Cross skips a digit.
  (g) => {
    const m = g.m;
    if (g.pressed() & 0x800) {
      const s = v(g, V.SCORE);
      if (s % 100 < 99) {
        m.w32(g.pv(V.SCORE), s + 1);
        scoreDraw(g);
      }
      m.w32(g.pv(PAUSE_GUARD), 0);
      toScreen(g, 4);
      return;
    }
    if (g.pressed() & 0x40) m.w32(timer(g), 1);
    if (m.add32(timer(g), -1) >= 1) return;
    if (v(g, COUNTDOWN_DIGIT) < 1) {
      animSet(g, g.ob + 0x186, 7);
      objectClear(g, g.ob + 0x187);
      m.w32(g.pv(WIPE_STATE), 0);
      m.w32(timer(g), 0x40);
      m.w32(g.pv(PAUSE_GUARD), 0);
      bgmRequest(g, 0x2d);
      nextStep(g);
    } else {
      sePlay(g, 3);
      m.w32(timer(g), 0x5a);
      const d = m.add32(g.pv(COUNTDOWN_DIGIT), -1);
      numberDraw(g, d, 1, g.ob + 0x187, 0x28, 0x50, 0x17e, 0x20, 1);
    }
  },
  // 3 (0x800A3F08): "GAME OVER" animation, then 64 frames.
  (g) => {
    const m = g.m;
    animTick(g, g.ob + 0x186);
    if (m.s32(A.obj(g.ob + 0x186) + A.O_ANIM) === 0 && m.add32(timer(g), -1) < 1) {
      m.w32(g.pv(WIPE_STATE), 0);
      nextStep(g);
    }
  },
  // 4 (0x800A3FC4): the tile wipe.
  (g) => {
    if (wipe(g, true)) {
      for (let n = 0x1e + g.p * 400; n < 0x103 + g.p * 400 + 1; n++) objectClear(g, n);
      g.m.w32(timer(g), 0x2c);
      nextStep(g);
    }
  },
  // 5
  (g) => {
    if (g.m.add32(timer(g), -1) < 1) nextStep(g);
  },
  // 6 (0x800A40A4): the items collected this game.
  (g) => {
    const m = g.m;
    const x0 = m.s32(0x800943c4 + g.p * 4);
    const put = (n: number, image: number, x: number, y: number, kind: number | null) => {
      const o = A.obj(g.ob + n);
      m.w32(o + A.O_IMAGE, image);
      m.w32(o + A.O_X, x);
      m.w32(o + A.O_Y, y);
      m.w32(o + A.O_PLAYER, 0);
      m.w32(o + A.O_20, 0);
      if (kind !== null) m.w32(o + A.O_KIND, kind);
    };
    put(0x197, 0x101b3, (x0 + 10) * 0x10000, -0x1a0000, null);
    put(0x196, 0x101b3, (x0 + 0xc) * 0x10000, -0x180000, 3);
    for (let i = 0; i < 7; i++) {
      put(0x188 + i, 0x101b2, (m.s32(0x800e11e0 + i * 8) + x0) * 0x10000, m.s32(0x800e11e4 + i * 8) << 16, 3);
    }
    m.w32(g.pv(ITEM_COUNT), 0);
    for (let i = 0; i < 7; i++) if (m.s32(ITEMS + g.p * 0x1c + 4 * i) !== 0) m.add32(g.pv(ITEM_COUNT), 1);
    if (v(g, ITEM_COUNT) === 0) {
      const o = A.obj(g.ob + 399);
      m.w32(o + A.O_X, (x0 + 0x14) * 0x10000);
      m.w32(o + A.O_Y, 0xa0000);
      m.w32(o + A.O_IMAGE, 0x101b4);
      m.w32(o + A.O_PLAYER, 0);
      m.w32(o + A.O_20, 0);
    } else {
      let k = 0;
      for (let i = 0; i < 7; i++) {
        const item = m.s32(ITEMS + g.p * 0x1c + 4 * i);
        if (item === 0) continue;
        const n = k + g.ob + 399;
        const o = A.obj(n);
        m.w32(o + A.O_X, (x0 + 2 + m.s32(0x800e11e0 + k * 8)) * 0x10000);
        m.w32(o + A.O_Y, m.s32(0x800e11e4 + k * 8) << 16);
        m.w32(o + A.O_ANIM, item + 7);
        m.w32(o + A.O_PLAYER, 0);
        m.w32(o + A.O_20, 0);
        animSet(g, n, item + 7);
        k++;
      }
    }
    m.w32(timer(g), 0xb4);
    nextStep(g);
  },
  // 7
  (g) => {
    itemsAnimate(g);
    if (g.m.add32(timer(g), -1) < 1) nextStep(g);
  },
  // 8: the items are forgotten.
  (g) => {
    itemsAnimate(g);
    g.m.w32(g.pv(ITEM_COUNT), 0);
    g.m.fill(ITEMS + g.p * 0x1c, 0x1c);
    nextStep(g);
  },
  // 9: rank check
  (g) => toScreen(g, 7),
];

export function scr06Continue(g: Game): void {
  CONTINUE[step(g)](g);
}

// ---- screen 7: rank entry ----

const ENTRY_TIMER = 0x800ee44c; // [2]
const ENTRY_CURSOR = 0x800eead8; // [2] letter being chosen, 0-3
const ENTRY = 0x800f2a8c; // [2] stride 0x1C: letters[4], score, stage, zone
const LETTER_RANGE = 0x80094408; // (min, max) per letter slot
const LETTER_IMAGE = 0x800e1268; // image per letter (0x1D end, 0x1E back, 0x1F blank)
const RANK_IMAGE = 0x800943ec; // int[5]
const RANK_X = 0x80094400; // int[2]
const letter = (g: Game, k: number) => ENTRY + g.p * 0x1c + 4 * k;

/** The rank the score reaches (0-4), or 5 when it doesn't make the table. */
function rankFind(g: Game): void {
  const m = g.m;
  m.w32(g.pv(RANK_POS), 5);
  for (;;) {
    const k = v(g, RANK_POS) - 1;
    if (v(g, V.SCORE) <= m.s32(A.RANKING + k * 0xc)) break;
    m.w32(g.pv(RANK_POS), k);
    if (k <= 0) break;
  }
}

const RANK: ((g: Game) => void)[] = [
  // 0 (0x800A46D4): does the score make the top five?
  (g) => {
    rankFind(g);
    if (v(g, RANK_POS) < 5) {
      bgmRequest(g, 0x31);
      nextStep(g);
    } else {
      toScreen(g, 13);
    }
  },
  // 1 (0x800A483C): name entry, 90 seconds
  (g) => {
    const m = g.m;
    const p = g.p;
    const x = m.s32(RANK_X + p * 4);
    m.w32(g.pv(ENTRY_TIMER), 0x1518);
    m.w32(g.pv(ENTRY_CURSOR), 0);
    m.w32(letter(g, 0), 0);
    m.w32(letter(g, 1), 0x1f);
    m.w32(letter(g, 2), 0x1f);
    m.w32(ENTRY + p * 0x1c + 0x10, v(g, V.SCORE));
    m.w32(ENTRY + p * 0x1c + 0x14, v(g, V.STAGE));
    m.w32(ENTRY + p * 0x1c + 0x18, v(g, V.ZONES_CLEARED) === 0x1f ? 5 : v(g, V.ZONE));
    let o = A.obj(g.ob + 0x19e);
    m.w32(o + A.O_PLAYER, 0);
    m.w32(o + A.O_20, 0);
    g.m.w32(A.obj(g.ob + 0x19e) + A.O_ANIM, 0x23);
    animStartLoad(g, g.ob + 0x19e);
    m.w32(o + A.O_PALETTE, p);
    m.w32(o + A.O_X, x);
    m.w32(o + A.O_Y, 0x9d0000);
    o = A.obj(g.ob + 0x1a0);
    m.w32(o + A.O_PLAYER, 0);
    m.w32(o + A.O_20, 0);
    m.w32(o + A.O_IMAGE, m.s32(RANK_IMAGE + 4 * v(g, RANK_POS)) + 0x10000);
    m.w32(o + A.O_X, x + 0x40000);
    m.w32(o + A.O_Y, 0xa70000);
    for (let i = 0; i < 4; i++) {
      o = A.obj(i + 0x1a3 + g.ob);
      m.w32(o + A.O_PLAYER, 0);
      m.w32(o + A.O_20, 0);
      m.w32(o + A.O_IMAGE, 0);
      m.w32(o + A.O_X, i * 0xe0000 + 0x280000 + x);
      m.w32(o + A.O_Y, 0xa50000);
    }
    numberDraw(g, m.s32(ENTRY + p * 0x1c + 0x10), 7, g.ob + 0x1a7, (x >> 16) + 0x1e, 0xb5, 0x140, 7);
    nextStep(g);
  },
  // 2 (0x800A4BE4): Left/Right change the letter, Cross moves on, Circle goes back
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(ENTRY_TIMER), -1) < 0) {
      nextStep(g);
      m.w32(g.pv(ENTRY_TIMER), 0x78);
      return;
    }
    const pressed = g.pressed();
    const cur = () => v(g, ENTRY_CURSOR);
    const lr = pressed & 0xa000;
    if (lr === 0x2000 || lr === 0x8000) {
      const a = letter(g, cur());
      const c = m.add32(a, lr === 0x2000 ? 1 : -1);
      const min = m.s32(LETTER_RANGE + cur() * 8);
      const max = m.s32(LETTER_RANGE + cur() * 8 + 4);
      if (lr === 0x2000 && max < c) m.w32(a, min);
      if (lr === 0x8000 && c < min) m.w32(a, max);
      sePlay(g, 2);
    }
    if (pressed & 0x20) {
      m.w32(letter(g, cur()), 0x1f);
      if (m.add32(g.pv(ENTRY_CURSOR), -1) < 0) {
        m.w32(g.pv(ENTRY_CURSOR), 0);
        m.w32(letter(g, 0), 0x1d);
      }
    }
    if (pressed & 0x40) {
      const c = m.s32(letter(g, cur()));
      if (c === 0x1d) {
        nextStep(g);
        m.w32(g.pv(ENTRY_TIMER), 0x78);
        return;
      }
      if (c === 0x1e) {
        m.w32(letter(g, cur()), 0x1d);
        if (m.add32(g.pv(ENTRY_CURSOR), -1) < 0) {
          m.w32(g.pv(ENTRY_CURSOR), 0);
          m.w32(letter(g, 0), 0x1d);
        }
      } else {
        sePlay(g, 3);
        if (m.add32(g.pv(ENTRY_CURSOR), 1) > 2) m.w32(g.pv(ENTRY_CURSOR), 3);
        m.w32(letter(g, cur()), m.s32(LETTER_RANGE + cur() * 8));
      }
    }
    animTickLoad(g, g.ob + 0x19e);
    const image = (k: number) => m.s32(LETTER_IMAGE + m.s32(letter(g, k)) * 4) + 0x10000;
    for (let i = 0; i < cur(); i++) m.w32(A.obj(i + 0x1a3 + g.ob) + A.O_IMAGE, image(i));
    m.w32(A.obj(cur() + 0x1a3 + g.ob) + A.O_IMAGE, g.counter & 8 ? 0 : image(cur()));
    for (let i = cur(); i + 1 < 4; i++) m.w32(A.obj(i + 0x1a4 + g.ob) + A.O_IMAGE, 0);
  },
  // 3 (0x800A5274): the name blinks for 2 seconds
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(ENTRY_TIMER), -1) < 0) {
      nextStep(g);
      return;
    }
    for (let i = 0; i < 3; i++) {
      let image = 0;
      if ((g.counter & 4) === 0) {
        const c = m.s32(letter(g, i));
        image = ((c - 0x1d) >>> 0 > 1 ? m.s32(LETTER_IMAGE + c * 4) : m.s32(0x800e12e4)) + 0x10000;
      }
      m.w32(A.obj(i + 0x1a3 + g.ob) + A.O_IMAGE, image);
    }
    m.w32(A.obj(g.ob + 0x1a6) + A.O_IMAGE, 0);
  },
  // 4 (0x800A5420): player 2 waits for player 1 at the same step
  (g) => {
    const m = g.m;
    if (g.p !== 1 || m.s32(A.STEP) !== m.s32(A.STEP + 4) || m.s32(A.SCREEN) !== m.s32(A.SCREEN + 4)) nextStep(g);
  },
  (g) => nextStep(g),
  // 6 (0x800A5504): into the ranking table
  (g) => {
    const m = g.m;
    rankFind(g);
    const rank = v(g, RANK_POS);
    if (rank < 5) {
      for (let k = 4; rank < k; k--) {
        const e = A.RANKING + k * 0xc;
        m.w32(e - 4, m.s32(e - 0x10));
        m.w32(e, m.s32(e - 0xc));
        m.w32(e + 4, m.s32(e - 8));
      }
      for (let i = 0; i < 3; i++) {
        const c = m.s32(letter(g, i));
        m.w8(A.RANKING - 4 + rank * 0xc + i, (c - 0x1d) >>> 0 < 2 ? 0x1f : m.u8(letter(g, i)));
      }
      m.w32(A.RANKING + rank * 0xc, m.s32(ENTRY + g.p * 0x1c + 0x10));
      m.w8(A.RANKING + rank * 0xc + 4, m.u8(ENTRY + g.p * 0x1c + 0x14));
      m.w8(A.RANKING + rank * 0xc + 5, m.u8(ENTRY + g.p * 0x1c + 0x18));
    }
    nextStep(g);
  },
  // 7
  (g) => toScreen(g, 13),
];

export function scr07RankEntry(g: Game): void {
  RANK[step(g)](g);
}

// ---- screen 9: stage clear ----

const CLEAR: ((g: Game) => void)[] = [
  // 0 (0x800A793C)
  (g) => {
    g.m.w32(A.OBJ_BASE, g.p * 400);
    objectsClearLineFlash(g);
    debrisClearAll(g);
    objectsClearPopups(g);
    objectsClearPieceFlash(g);
    objectClear(g, g.ob + 0x131);
    nextStep(g);
  },
  // 1: the goal sequence until it flags the end
  (g) => {
    if (v(g, V.CLEAR_FLAGS) & 2) nextStep(g);
    else profDispatch(g);
  },
  // 2 stage_number_advance
  (g) => {
    const m = g.m;
    const stage = m.add32(g.pv(V.STAGE), 1);
    if (stage === 0x14) {
      if (m.u8(g.pv(V.ZONES_CLEARED)) !== 0x1f) {
        toScreen(g, 10);
        return;
      }
      if (v(g, V.ZONE) === 4) {
        m.w32(g.pv(WIPE_STATE), 0);
        m.w32(g.pv(A.STEP), 4);
        return;
      }
      m.add32(g.pv(V.ZONE), 1);
      m.w32(g.pv(V.STAGE), 0);
    }
    nextStep(g);
  },
  // 3: the next stage
  (g) => {
    g.m.add32(g.pv(0x800ee430), 1);
    toScreen(g, 3);
  },
  // 4-6: the end of the 100-stage run
  (g) => {
    if (wipe(g, true)) nextStep(g);
  },
  (g) => {
    for (let n = 0x1e + g.p * 400; n < 0x103 + g.p * 400 + 1; n++) objectClear(g, n);
    g.m.w32(g.pv(WIPE_STATE), 0);
    frameBorders(g);
    nextStep(g);
  },
  (g) => {
    if (wipe(g, false)) {
      bgmRequest(g, 0x21);
      toScreen(g, 0xb);
    }
  },
];

/** FUN_800BFE94: the frame above and below a picture. */
function frameBorders(g: Game): void {
  objectPut2(g, 0x34, 0x3a9, 0, 8);
  objectPut2(g, 0x35, 0x3aa, 0, 0x88);
}

export function scr09StageClear(g: Game): void {
  CLEAR[step(g)](g);
}

// ---- screen 13: save / password ----

/** FUN_8009BB10: the three options, the chosen one highlighted. */
function saveOptions(g: Game, first: number): void {
  const m = g.m;
  for (let i = 0; i < 3; i++) {
    const image = m.s32(v(g, SAVE_CURSOR) === i ? 0x800e27b4 + i * 0x10 : 0x800e27b0 + i * 0x10);
    objectPut2(g, first + i, image, m.s32(0x800e27b8 + i * 0x10), m.s32(0x800e27bc + i * 0x10));
  }
}

const SLOT_PICK = 0x800ed320; // [2] the save slot chosen, 0-2
const CARD_TIMER = 0x800f35b0; // [2]
const YES_NO = 0x800ee43c; // [2] 0 yes, 1 no
const SLOT_IMAGES = 0x80094968; // int[12]: by (row chosen?): label, empty, cleared, zone, "STAGE", digits

const nothing = () => {};
const substepNext = (g: Game, n = 1) => g.m.add32(g.pv(A.SUBSTEP), n);
const substepSet = (g: Game, n: number) => g.m.w32(g.pv(A.SUBSTEP), n);

const SAVE: ((g: Game) => void)[] = [
  // 0 (0x8009BC7C): the play area's objects move to the top of the range.
  (g) => {
    const m = g.m;
    m.w32(A.OBJ_BASE, g.p * 400);
    bgmRequest(g, 0x2f);
    const from = A.obj(g.ob + 0x108);
    m.bytes.copyWithin(A.obj(g.ob + 0x1e) & 0x1fffff, from & 0x1fffff, (from & 0x1fffff) + 126 * A.OBJ_SIZE);
    for (let n = 0x9c; n <= 0x1ad; n++) objectClear(g, n + g.ob);
    m.w32(g.pv(SAVE_CURSOR), 0);
    m.w32(g.pv(V.SAVED_STAGE), v(g, V.ZONE) * 0x14 + (v(g, V.STAGE) % 0x14));
    m.add32(g.pv(A.SUBSTEP), 1);
  },
  // 1 (0x8009BE24): the password and the options.
  (g) => {
    for (let n = 0x186; n < 0x1a4; n++) objectClear(g, n + g.ob);
    passwordShow(g, 0x13, 0x21, 2);
    objectPut2(g, 0xd2, 0x4ca, 0x1f, 0x5e);
    saveOptions(g, 0xd3);
    g.m.add32(g.pv(A.SUBSTEP), 1);
  },
  // 2 (0x8009BEC8): Up/Down, Cross picks.
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x40) {
      m.add32(g.pv(A.SUBSTEP), 1);
      sePlay(g, 0);
      return;
    }
    if (pressed & 0x1000) {
      const c = v(g, SAVE_CURSOR) - 1;
      m.w32(g.pv(SAVE_CURSOR), c < 0 ? 2 : c);
    } else if (pressed & 0x4000) {
      const c = v(g, SAVE_CURSOR) + 1;
      m.w32(g.pv(SAVE_CURSOR), c > 2 ? 0 : c);
    } else {
      return;
    }
    saveOptions(g, 0xd3);
    sePlay(g, 3);
  },
  // 3 (0x8009C01C): 0 and 1 save to the card in that slot, 2 quits.
  (g) => {
    const c = v(g, SAVE_CURSOR);
    if (c === 2) toScreen(g, 8);
    else if (c === 0 || c === 1) g.m.add32(g.pv(A.SUBSTEP), 1);
  },
  // 4 (0x8009C108): the card lock; if held, "busy" for 120 ticks and back.
  (g) => {
    if (C.cardLock(g)) {
      substepNext(g);
      return;
    }
    objectLoad2(g, 0x1a4, 0x4d3, 0x15, 99);
    cardMessageWait(g, 0x21);
  },
  // 5 (0x8009C1C4): check the card.
  (g) => {
    const m = g.m;
    m.w32(C.CARD_INDEX, v(g, C.CARD_SLOT));
    const r = C.cardStatus(g);
    m.w32(C.CARD_RESULT, r);
    if (r === 1) {
      substepSet(g, 8);
    } else if (r === 3) {
      substepSet(g, 0x1c);
    } else if (r !== 2) {
      objectLoad2(g, 0x1a4, r === 0 ? 0x440 : 0x444, 0x10, 0x44);
      cardMessageWait(g, 6);
    }
  },
  // 6 (0x8009C328): the message's time, then 7.
  (g) => cardMessageTimer(g),
  // 7 (0x8009C3B4): back to the options.
  (g) => {
    C.cardUnlock(g);
    substepSet(g, 1);
  },
  // 8 (0x8009C400): read the save file; without one, check for room (26).
  (g) => {
    if (!C.saveRead(g)) {
      substepSet(g, 0x1a);
      return;
    }
    C.saveToState(g, 4);
    substepNext(g);
  },
  // 9 (0x8009C49C): the three save slots.
  (g) => {
    const m = g.m;
    objectClear(g, g.ob + 0x194);
    for (let i = 0; i < 6; i++) objectClear(g, i + g.ob + 0x196);
    objectPut2(g, 0xd2, m.s32(0x80094240 + 4 * v(g, C.CARD_SLOT)), 0x17, 0x16);
    objectPut2(g, 0xd3, 0x3b0, 0x2d, 0xd4);
    objectPut2(g, 0xd4, 0, 0x11, 0x41);
    animSet(g, g.ob + 0xd4, 0x33);
    objectClear(g, g.ob + 0xd5);
    objectClear(g, g.ob + 0xd6);
    slotList(g, 0, 0x5d);
    itemLoad(g, 0x4c5);
    m.w32(g.pv(SLOT_PICK), 0);
    substepNext(g);
  },
  // 10 (0x8009C628): Up/Down pick a slot; Cross saves there (asking first if it holds a game);
  // Circle backs out.
  (g) => {
    const m = g.m;
    const pressed = g.pressed();
    if (pressed & 0x20) {
      sePlay(g, 0x12);
      for (let i = -1; i < 0x15; i++) objectClear(g, i + g.ob + 400);
      substepSet(g, 7);
      return;
    }
    if (pressed & 0x40) {
      sePlay(g, 0);
      objectClear(g, g.ob + 399);
      if (m.u8(C.SAVE_SLOTS + 2 * v(g, SLOT_PICK)) !== 0xff) {
        overwriteAsk(g, 0x59);
        substepNext(g);
        return;
      }
      if (m.s32(C.CARD_LOCK) & 0x10) {
        substepSet(g, 0x18);
        return;
      }
      savingMessage(g);
      objectClear(g, g.ob + 0x1a6);
      substepNext(g, 2);
      return;
    }
    if (pressed & 0x1000) {
      const c = v(g, SLOT_PICK) - 1;
      m.w32(g.pv(SLOT_PICK), c < 0 ? 2 : c);
    } else if (pressed & 0x4000) {
      const c = v(g, SLOT_PICK) + 1;
      m.w32(g.pv(SLOT_PICK), c > 2 ? 0 : c);
    } else {
      animTick(g, g.ob + 0xd4);
      return;
    }
    slotList(g, v(g, SLOT_PICK), 0x5d);
    sePlay(g, 3);
    animTick(g, g.ob + 0xd4);
  },
  // 11 (0x8009C9DC): overwrite? Yes: save (37); no: back to the slots.
  (g) => {
    const r = yesNo(g, 0x35, 0x25, 0x69 + 0x28 * v(g, SLOT_PICK));
    if (r === 1) {
      g.m.w32(g.pv(CARD_TIMER), 2);
      substepSet(g, 0x25);
    } else if (r === 2) {
      itemLoad(g, 0x4c5);
      slotList(g, v(g, SLOT_PICK), 0x5d);
      objectClear(g, g.ob + 0x1a1);
      objectClear(g, g.ob + 0x1a2);
      substepNext(g, -1);
    }
  },
  // 12 (0x8009CAF0)
  (g) => substepNext(g),
  // 13 (0x8009CB68): the game into the slot, the slots and best times into copy A; write.
  (g) => {
    const m = g.m;
    const slot = C.SAVE_SLOTS + 2 * v(g, SLOT_PICK);
    m.w8(slot, m.u8(g.pv(V.SAVED_STAGE)));
    m.w8(slot + 1, m.u8(g.pv(V.ZONES_CLEARED)));
    C.stateToSave(g, v(g, SLOT_PICK) + 5);
    C.stateToSave(g, 1);
    if (C.saveWrite(g) === 0) {
      cardMessage(g, 0x44b);
      cardMessageWait(g, 6);
      return;
    }
    substepNext(g);
  },
  // 14 (0x8009CD48)
  (g) => {
    for (const n of [0x1a1, 0x1a2, 0x1a3, 0x1a4]) objectClear(g, g.ob + n);
    C.cardUnlock(g);
    substepNext(g);
  },
  // 15 (0x8009CDE0)
  (g) => toScreen(g, 8),
  // 16 (0x8009CE38: unused)
  (g) => toScreen(g, 1),
  nothing,
  nothing,
  nothing,
  // 20-23: as 28-31 (no path leads here).
  (g) => formatAsk(g),
  (g) => formatAnswer(g),
  (g) => substepNext(g),
  (g) => formatRun(g),
  // 24 (0x8009D25C): a new file: check the card again.
  (g) => {
    const m = g.m;
    const r = C.cardStatus(g);
    m.w32(C.CARD_RESULT, r);
    if (r === 1) {
      savingMessage(g);
      objectClear(g, g.ob + 0x1a2);
      objectClear(g, g.ob + 0x1a6);
      substepNext(g);
      m.w32(g.pv(CARD_TIMER), 3);
    } else {
      cardMessage(g, 0x44b);
      cardMessageWait(g, 6);
    }
  },
  // 25 (0x8009D404): after 3 ticks, create the file, then write the game (13); else 26.
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(CARD_TIMER), -1) >= 1) return;
    const r = C.saveCreate(g);
    m.w32(C.CARD_RESULT, r);
    if (r === 0) substepNext(g);
    else substepSet(g, 0xd);
  },
  // 26 (0x8009D4C8): room for a file: start from the defaults (32); else "card full".
  (g) => {
    const r = C.usedBlocks(g);
    g.m.w32(C.CARD_RESULT, r);
    if (r < 0xf) {
      substepSet(g, 0x20);
      return;
    }
    cardMessage(g, 0x448);
    cardMessageWait(g, 6);
  },
  nothing,
  // 28 (0x8009CEA8): the card isn't formatted: format it?
  (g) => formatAsk(g),
  // 29 (0x8009CF00)
  (g) => formatAnswer(g),
  // 30 (0x8009D100)
  (g) => substepNext(g),
  // 31 (0x8009D13C)
  (g) => formatRun(g),
  // 32 (0x8009D5F8): a new file from the defaults.
  (g) => {
    C.saveDefaults(g);
    C.saveToState(g, 4);
    g.m.w32(C.CARD_LOCK, g.m.s32(C.CARD_LOCK) | 0x10);
    substepSet(g, 9);
  },
  // 33 (0x8009C328), after "busy"
  (g) => cardMessageTimer(g),
  // 34 (0x8009D66C)
  (g) => substepSet(g, 1),
  // 35 (0x8009C328: unused)
  (g) => cardMessageTimer(g),
  nothing,
  // 37 (0x8009D6B0): overwrite: after 2 ticks, check the card again, then save (12).
  (g) => {
    const m = g.m;
    if (m.add32(g.pv(CARD_TIMER), -1) >= 1) return;
    if (C.cardStatus(g) === 1) {
      savingMessage(g);
      objectClear(g, g.ob + 0x1a1);
      objectClear(g, g.ob + 0x1a2);
      objectClear(g, g.ob + 0x1a6);
      substepSet(g, 0xc);
    } else {
      cardMessage(g, 0x44b);
      cardMessageWait(g, 6);
    }
  },
];

export function scr13Save(g: Game): void {
  SAVE[g.m.s32(g.pv(A.SUBSTEP))](g);
}

// ---- the card screens' helpers (screen 13 and the menu's Continue) ----


/** A card message (object 0x1A4 at 16, 68, the player's palette, its image uploaded). */
function cardMessage(g: Game, image: number): void {
  objectLoad2(g, 0x1a4, image, 0x10, 0x44);
}

/** The message stays 120 ticks (substep 6 or 33 counts them), then `substep`. */
function cardMessageWait(g: Game, substep: number): void {
  g.m.w32(g.pv(CARD_TIMER), 0x78);
  substepSet(g, substep);
}

/** FUN_8009C328 */
function cardMessageTimer(g: Game): void {
  if (g.m.add32(g.pv(CARD_TIMER), -1) < 1) {
    objectClear(g, g.ob + 0x1a4);
    substepNext(g);
  }
}

/** "Saving" (0x44A). */
function savingMessage(g: Game): void {
  cardMessage(g, 0x44a);
}

/**
 * FUN_800B8918(chosen, y): the three save slots, the chosen one highlighted: each with its zone
 * and stage, "empty" (stage 0xFF) or "cleared" (all five zones).
 */
export function slotList(g: Game, chosen: number, y: number): void {
  const m = g.m;
  const img = (k: number) => m.s32(SLOT_IMAGES + 4 * k);
  for (let i = 0; i < 3; i++) {
    const stage = m.u8(C.SAVE_SLOTS + 2 * i);
    const zones = m.u8(C.SAVE_SLOTS + 2 * i + 1);
    const hi = chosen === i ? 1 : 0;
    if (hi) {
      objectPut2(g, 399, 0x4c6, 0x10, i * 0x28 + y - 6);
      m.w32(A.obj(g.ob + 399) + A.O_PALETTE, g.p);
    }
    const row = i * 0x28;
    objectPut2(g, i + 400, i + img(hi), 0x16, row + y);
    const k = i * 4;
    let last: number;
    let lastImage: number;
    let ly: number;
    if (stage === 0xff || (zones & 0x1f) === 0x1f) {
      if (stage === 0xff) objectPut2(g, k + 0x195, img(hi + 2), 0x41, y + row + 0x13);
      else objectPut2(g, k + 0x195, img(hi + 4), 0x5a, y + row + 0x13);
      ly = y + row + 0x14;
      objectPut2(g, k + 0x196, 0, 0x52, ly);
      objectPut2(g, k + 0x197, 0, 0x73, ly);
      last = k + 0x198;
      lastImage = 0;
    } else {
      ly = y + row + 0x14;
      objectPut2(g, k + 0x195, Math.trunc(stage / 0x14) + img(hi + 6), 0x1b, ly);
      objectPut2(g, k + 0x196, img(hi + 8), 0x50, y + row + 0x13);
      objectPut2(g, k + 0x197, Math.trunc(((stage % 0x14) + 1) / 10) + img(hi + 10), 0x73, ly);
      last = k + 0x198;
      lastImage = ((stage + 1) % 10) + img(hi + 10);
    }
    objectPut2(g, last, lastImage, 0x7b, ly);
  }
}

/** FUN_800B921C(y): the overwrite question's yes/no cursor (on "no") and text, by the chosen slot. */
function overwriteAsk(g: Game, y: number): void {
  const m = g.m;
  m.w32(g.pv(YES_NO), 1);
  objectPut2(g, 0x1a2, 0, 0x5a, v(g, SLOT_PICK) * 0x28 + 0x69);
  animSet(g, g.ob + 0x1a2, v(g, YES_NO) + 0x36);
  objectPut2(g, 0x1a1, 0x4c7, 0xe, v(g, SLOT_PICK) * 0x28 + y);
}

/**
 * FUN_800B9334 (x = 0x35 * c + 0x25, y by the slot) and FUN_800B8D80 (x = 0x29 * c + 0x30,
 * y 0x92): Cross answers (1 yes, 2 no), Circle is no, Left/Right move the cursor.
 */
function yesNo(g: Game, dx: number, x0: number, y: number): number {
  const m = g.m;
  const pressed = g.pressed();
  if (pressed & 0x40) {
    sePlay(g, 0);
    if (v(g, YES_NO) === 0) return 1;
    if (v(g, YES_NO) === 1) return 2;
  }
  if (pressed & 0x20) {
    sePlay(g, 0x12);
    return 2;
  }
  if ((pressed & 0xa000) === 0) {
    animTick(g, g.ob + 0x1a2);
    return 0;
  }
  const c = v(g, YES_NO) ^ 1;
  m.w32(g.pv(YES_NO), c);
  objectPut2(g, 0x1a2, 0, c * dx + x0, y);
  animSet(g, g.ob + 0x1a2, c + 0x36);
  sePlay(g, 3);
  return 0;
}

/** FUN_8009CEA8 / FUN_800B8C78: "format the card?", the cursor on "no". */
function formatAsk(g: Game): void {
  const m = g.m;
  m.w32(g.pv(YES_NO), 1);
  objectPut2(g, 0x1a2, 0, 0x59, 0x92);
  animSet(g, g.ob + 0x1a2, v(g, YES_NO) + 0x36);
  objectLoad2(g, 0x1a1, 0x445, 0x12, 0x50);
  substepNext(g);
}

/** FUN_8009CF00: yes formats if the card is still unformatted; no backs out (7). */
function formatAnswer(g: Game): void {
  const m = g.m;
  const r = yesNo(g, 0x29, 0x30, 0x92);
  m.w32(C.CARD_RESULT, r);
  if (r === 1) {
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    const s = C.cardStatus(g);
    m.w32(C.CARD_RESULT, s);
    if (s === 3) {
      cardMessage(g, 0x446);
      substepNext(g);
      return;
    }
    cardMessage(g, 0x447);
    cardMessageWait(g, 6);
  } else if (r === 2) {
    objectClear(g, g.ob + 0x1a1);
    objectClear(g, g.ob + 0x1a2);
    substepSet(g, 7);
  }
}

/** FUN_8009D13C: format; then a new file (the next substep, 32 from 31). */
function formatRun(g: Game): void {
  const r = C.cardFormat(g);
  g.m.w32(C.CARD_RESULT, r);
  if (r === 0) {
    cardMessage(g, 0x447);
    cardMessageWait(g, 6);
    return;
  }
  objectClear(g, g.ob + 0x1a4);
  substepNext(g);
}

// Used by the menu's Continue.
export { substepNext, substepSet, SLOT_PICK, CARD_TIMER };
