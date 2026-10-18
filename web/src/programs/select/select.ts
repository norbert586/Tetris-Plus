// SELECT.EXE (program 8): the mode select reached from the title's menu, and Option mode
// (docs/re/select.md). One `step` is one iteration of its main loop (0x80095800), in the
// original's order; state lives in RAM at the original's addresses.
//
// The main loop: counter+1, the logic (0x80097114: by state+0x4C, 0 mode select, 1 Option
// mode, 2 straight on to a mode, 3 nothing), objects_draw (0x80096B7C), the frame's end,
// PadRead (the tracer's sample point), rand(), the soft-reset check (0x800969F4).
import * as A from '../../core/addr';
import { decodeBase64, type Mem } from '../../core/mem';
import type { Rng } from '../../core/rng';
import type { SoundCall } from '../../core/sound';
import type { MemoryCards } from '../../flow/memcard';
import type { Program, Shared } from '../../flow/program';
import { cardStep } from './card';
import { ROM } from './rom';
import {
  BGM_CUR_ID,
  BGM_CUR_PLAYER,
  BGM_STOP,
  BGM_WANT_P1,
  BGM_WANT_P2,
  bgmRequest,
  CD_ERROR,
  cdRecover,
  cdVolume,
  musicVolume,
  playTrack,
  SND_PLAYER,
  sePlay,
  trackExists,
} from './sound';
import { traceRow } from './trace';

/** SELECT.EXE's BSS, cleared by `start` (0x8009D548). */
const BSS = 0x800b9030;
const BSS_END = 0x800be138;

// Pads (0x800BE124: 8 entries of 3 u16; pad 1 and pad 2 are used)
export const PAD1_HELD = 0x800be126;
export const PAD1_PRESSED = 0x800be128;
export const PAD2_HELD = 0x800be12c;
export const PAD2_PRESSED = 0x800be12e;
// The soft reset's hold counters (initialised data)
const RESET1 = 0x800b26c0;
const RESET2 = 0x800b26c4;

// Mode select (state+0x4C = 0)
export const M_STEP = 0x800b9094;
export const M_SEL = 0x800b90a0; // 0 classic, 1 puzzle, 2 VS, 3 edit, 4 option
export const M_WAIT = 0x800b90a4;
const TILE_IMAGES = 0x800b2800; // [5] the small tiles
const TILE_POS = 0x800b2814; // [5] x, y (16.16)
const LABEL_IMAGES = 0x800b283c; // [5] the mode names under the tiles
const LABEL_POS = 0x800b2850; // [5] x, y: also the cursor's positions
const SHADE_POS = 0x800b2878; // [5] x, y: the grey covers of the other tiles
const NAV = 0x800b2760; // [5] { right, left, down, up }
const ZOOM = 0x800b27b0; // [5] { dx, dy, shadow dx, shadow dy } (16.16, per 16 ticks)
const BIG_IMAGES = 0x800b28a0; // [5] the zoomed picture
const BIG_POS = 0x800b28b4;
const BIG_SHADOW_POS = 0x800b28dc;
const TEXT_IMAGES = 0x800b2904; // [5] the description
const TEXT_POS = 0x800b2918;
const PLAYERS_IMAGES = 0x800b2940; // [5] "one player only" / "two players only"
const PLAYERS_POS = 0x800b2954;
/** Sprite animations: pointers to { frame time, image, image, ..., 0xFFFE loop | 0xFFFF end }. */
export const ANIMS = 0x800b2744;

// Option mode (state+0x4C = 1; phase state+0x50, subphase state+0x54)
export const O_ROW = 0x800b9a4c;
const ROT_INDEX = 0x800be114; // [4]: P1 left turn, P1 right turn, P2 left turn, P2 right turn
const ROT_SHOWN = 0x800be024; // [2] the masks shown on a row
const ROT_SHOWN_INDEX = 0x800b9ac0; // [2]
const HIGHLIGHT = 0x800be048; // 0 or 0x38: the image offset of the cursor's row
const O_LEVEL = 0x800b9a3c;
const O_MATCHES = 0x800b9a2c;
const O_TOGGLE = 0x800b9a38;
const O_BGM = 0x800b9adc;
const O_SE = 0x800b9a34;
const O_VOLUME = 0x800b9bac;
const O_DATA = 0x800b9c48; // option data: 0 load, 1 save
const O_RANKING = 0x800b9c84; // ranking data: 0 load, 1 save
/** The buttons a turn can be given (u32[8]). */
const ROT_BUTTONS = 0x800b297c;
export const ROT_CCW_P1 = A.S + 0x4b4ec;
export const ROT_CCW_P2 = A.S + 0x4b4f0;
export const ROT_CW_P1 = A.S + 0x4b4f4;
export const ROT_CW_P2 = A.S + 0x4b4f8;
export const MATCHES = A.S + 0x4b501;

const OBJ_LAST = A.OBJ_COUNT;

export type MixCall = { kind: 'stereo' | 'mono' };

export class Select implements Program {
  readonly name = 'SELECT' as const;
  readonly m: Mem;
  readonly rng: Rng;
  readonly cards?: MemoryCards;
  tick = 0;
  uploads: number[] = [];
  sound: SoundCall[] = [];
  /** se_play / bgm_request arguments this tick (the trace's se and bgm). */
  se: number[] = [];
  bgm: number[] = [];
  /** CD commands this tick: command, then parameter bytes (the trace's cd). */
  cd: number[][] = [];
  /**
   * SsSetStereo / SsSetMono with the CdMix that goes with them (stereo: CD left to left, right
   * to right at 0x7F; mono: all four at 0x40). Not in SoundCall: for the audio layer.
   */
  mix: MixCall[] = [];

  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  constructor(shared: Shared) {
    this.m = shared.m;
    this.rng = shared.rng;
    this.cards = shared.cards;
    // The program's set-up: card_init (0x8009AF68: InitCARD, StartCARD, _bu_init).
    this.cards?.init();
    const m = this.m;
    m.loadImage(ROM.map((r) => ({ address: r.address, bytes: decodeBase64(r.base64) })));
    m.fill(BSS, BSS_END - BSS);
    // main clears the exit flag before its loop (the rest of its setup runs in the first step).
    m.w32(A.EXIT_FLAG, 0);
  }

  // ---- helpers ----

  pressed(): number {
    return this.m.u16(PAD1_PRESSED);
  }
  rand(): number {
    return this.rng.next();
  }
  get param(): number {
    return this.m.s32(A.NEXT_PARAM);
  }

  /** FUN_80096D64: zeroes object n. */
  objectClear(n: number): void {
    this.m.fill(A.obj(n), A.OBJ_SIZE);
  }
  objectsClearAll(): void {
    for (let n = 0; n < OBJ_LAST; n++) this.objectClear(n);
  }
  /** FUN_80099D24: object n shows image `image` at (x, y) (whole pixels). */
  put(n: number, image: number, x: number, y: number): void {
    const o = A.obj(n);
    this.m.w32(o + A.O_IMAGE, image + 0x10000);
    this.m.w32(o + A.O_X, x << 16);
    this.m.w32(o + A.O_Y, y << 16);
  }
  /** Uploads item n (FUN_80096620 + FUN_80096120). */
  upload(item: number): void {
    this.uploads.push(item);
  }
  /** FUN_80096E5C: starts object n's animation, uploading its first image. */
  animStartLoad(n: number): void {
    const m = this.m;
    const o = A.obj(n);
    const id = m.s32(o + A.O_ANIM);
    if (id === 0) return;
    const t = m.u32(ANIMS + 4 * id);
    const image = m.s32(t + 4);
    m.w32(o + A.O_IMAGE, image + 0x10000);
    this.upload(image - 1);
    m.w32(o + A.O_ANIM_TIMER, m.s32(t));
    m.w32(o + A.O_ANIM_FRAME, 0);
  }
  /** FUN_80096F38 (load = false) / FUN_80096FF4 (load = true): advances object n's animation. */
  animTick(n: number, load: boolean): void {
    const m = this.m;
    const o = A.obj(n);
    const id = m.s32(o + A.O_ANIM);
    if (id === 0) return;
    const t = m.u32(ANIMS + 4 * id);
    if (m.add32(o + A.O_ANIM_TIMER, -1) >= 1) return;
    const i = m.s32(o + A.O_ANIM_FRAME);
    m.w32(o + A.O_ANIM_FRAME, i + 1);
    const next = m.s32(t + 4 * (i + 2));
    if (next === 0xffff) {
      m.w32(o + A.O_ANIM, 0);
      return;
    }
    if (next === 0xfffe) m.w32(o + A.O_ANIM_FRAME, 0);
    m.w32(o + A.O_ANIM_TIMER, m.s32(t));
    const image = m.s32(t + 4 * (m.s32(o + A.O_ANIM_FRAME) + 1));
    m.w32(o + A.O_IMAGE, image + 0x10000);
    if (load) this.upload(image - 1);
  }

  // ---- the main loop ----

  step(pad: number): void {
    const m = this.m;
    this.uploads = [];
    this.sound = [];
    this.se = [];
    this.bgm = [];
    this.cd = [];
    this.mix = [];
    this.rng.calls = 0;
    if (this.tick === 0) {
      // The previous program's last iteration called rand() after the tracer's last sample of
      // it; the injected seed (the trace's mainseed) already includes that call.
      this.rng.calls = 1;
      this.startup();
    } else {
      this.padRead(pad);
      if (m.s32(CD_ERROR) !== 0) cdRecover(this);
      this.rand();
      this.softResetCheck();
      if (this.exited) return;
    }
    this.tick++;
    m.add32(A.COUNTER, 1);
    switch (this.param) {
      case 0:
        m.w32(SND_PLAYER, 0);
        this.modeSelect();
        break;
      case 1:
        m.w32(SND_PLAYER, 0);
        this.optionMode();
        break;
      case 2:
        this.leaveForMode(m.s32(M_SEL), true);
        break;
      default:
        break;
    }
  }

  /** main before its loop: the sound library, every image uploaded, pads cleared. */
  private startup(): void {
    const m = this.m;
    // FUN_800955F0: the sound library; SsSetSerialVol(CD) at the music volume.
    cdVolume(this, musicVolume(this));
    m.w32(BGM_CUR_PLAYER, 0);
    m.w32(BGM_CUR_ID, BGM_STOP);
    m.w32(BGM_WANT_P1, BGM_STOP);
    m.w32(BGM_WANT_P2, BGM_STOP);
    this.mix.push({ kind: (m.u8(A.SETTING_4FC) & 1) === 0 ? 'stereo' : 'mono' });
    // FUN_80095FFC: every item uploaded and its sprite template made.
    for (let i = 0; i < 0xb1; i++) this.upload(i);
    for (let i = 0; i < 8; i++) {
      m.w16(0x800be124 + 6 * i, 0);
      m.w16(0x800be126 + 6 * i, 0);
      m.w16(0x800be128 + 6 * i, 0);
    }
    m.w32(A.EXIT_FLAG, 0);
  }

  private padRead(word: number): void {
    const m = this.m;
    const p1 = word & 0xffff;
    const p2 = (word >>> 16) & 0xffff;
    m.w16(PAD1_PRESSED, (m.u16(PAD1_HELD) ^ p1) & p1);
    m.w16(PAD1_HELD, p1);
    m.w16(PAD2_PRESSED, (m.u16(PAD2_HELD) ^ p2) & p2);
    m.w16(PAD2_HELD, p2);
  }

  /** FUN_800969F4: Select+Start held 121 ticks on either pad goes back to the title. */
  private softResetCheck(): void {
    const m = this.m;
    const c1 = (m.u16(PAD1_HELD) & 0x900) === 0x900 ? m.s32(RESET1) + 1 : 0;
    const c2 = (m.u16(PAD2_HELD) & 0x900) === 0x900 ? m.s32(RESET2) + 1 : 0;
    m.w32(RESET1, c1);
    m.w32(RESET2, c2);
    if (c1 > 0x78 || c2 > 0x78) {
      m.w32(RESET1, 0);
      m.w32(RESET2, 0);
      this.exitTo(3, 0, 9);
      for (let p = 0; p < 2; p++) {
        m.w32(A.SCREEN + 4 * p, 0);
        m.w32(A.STEP + 4 * p, 0);
        m.w32(A.SUBSTEP + 4 * p, 0);
        m.w32(A.STEP4 + 4 * p, 0);
      }
      m.fill(A.S + 0x4b528, 16);
    }
  }

  exitTo(program: number, param: number, phase: number): void {
    const m = this.m;
    m.w32(A.EXIT_FLAG, 1);
    m.w32(A.NEXT_PROGRAM, program);
    m.w32(A.NEXT_PARAM, param);
    m.w32(A.PHASE, phase);
    m.w32(A.SUBPHASE, 0);
  }

  /**
   * Whether the port may start mode `sel` (0 classic, 1 puzzle, 2 VS, 3 edit): only Puzzle
   * Mode is ported. A deliberate deviation (docs/re/select.md §6): Classic, VS and Edit are
   * shown but cannot be started.
   */
  static modeAvailable(sel: number): boolean {
    return sel === 1;
  }

  /**
   * Leaves for mode `sel` (program 9 + sel) as FUN_80097E74 / FUN_800971D0 do, unless the port
   * doesn't have it (Select.modeAvailable). `direct`: state+0x4C was 2 (FUN_800971D0, the mode
   * named without the screen); the refusal then shows the mode select instead.
   */
  private leaveForMode(sel: number, direct: boolean): void {
    if (!Select.modeAvailable(sel & 3)) {
      if (direct) this.m.w32(A.NEXT_PARAM, 0);
      return;
    }
    this.exitTo(direct ? sel + 9 : (sel & 3) + 9, 0, 0);
  }

  // ---- mode select ----

  private modeSelect(): void {
    const m = this.m;
    const S = A.S;
    const sel = () => m.s32(M_SEL);
    const o = A.obj;
    switch (m.s32(M_STEP)) {
      case 0: {
        // FUN_80097298: the background halves.
        this.objectsClearAll();
        m.w32(M_SEL, 0);
        bgmRequest(this, 0x2f);
        m.w32(S + 0x5d4, 0x10004);
        m.w32(S + 0x558, 0x10003);
        m.w32(S + 0x534, 0);
        m.w32(S + 0x538, 0x50000);
        m.w32(S + 0x5b0, 0xa00000);
        m.w32(S + 0x5b4, 0x50000);
        m.add32(M_STEP, 1);
        return;
      }
      case 1: {
        // FUN_80097330: "SELECT MODE" and its shadow come in from the right.
        m.w32(o(20) + A.O_IMAGE, 0x10013);
        m.w32(o(20) + A.O_X, 0x1520000);
        m.w32(o(20) + A.O_Y, 0xe0000);
        m.w32(o(19) + A.O_X, 0x1550000);
        m.w32(o(19) + A.O_Y, 0x110000);
        m.w32(o(19) + A.O_IMAGE, 0x10014);
        m.w32(o(19) + A.O_KIND, 3);
        sePlay(this, 6);
        m.add32(M_STEP, 1);
        return;
      }
      case 2: {
        // FUN_800973B0
        if (m.s32(o(20) + A.O_X) < 0x120001) {
          m.add32(M_STEP, 1);
        } else {
          m.add32(o(20) + A.O_X, -0x60000);
          m.add32(o(19) + A.O_X, -0x60000);
        }
        return;
      }
      case 3: {
        // FUN_8009740C: the tiles, their shadows, the names, the covers and the cursor.
        for (let i = 0; i < 5; i++) {
          const b = o(100 + i);
          m.w32(b + A.O_IMAGE, m.s32(TILE_IMAGES + 4 * i) + 0x10000);
          m.w32(b + A.O_X, m.s32(TILE_POS + 8 * i));
          m.w32(b + A.O_Y, m.s32(TILE_POS + 8 * i + 4));
        }
        for (let i = 0; i < 5; i++) {
          const b = o(95 + i);
          m.w32(b + A.O_IMAGE, 0x10011);
          m.w32(b + A.O_X, m.s32(TILE_POS + 8 * i) + 0x80000);
          m.w32(b + A.O_KIND, 3);
          m.w32(b + A.O_Y, m.s32(TILE_POS + 8 * i + 4) + 0x80000);
        }
        for (let i = 0; i < 5; i++) {
          const b = o(105 + i);
          m.w32(b + A.O_IMAGE, m.s32(LABEL_IMAGES + 4 * i) + 0x10000);
          m.w32(b + A.O_X, m.s32(LABEL_POS + 8 * i));
          m.w32(b + A.O_Y, m.s32(LABEL_POS + 8 * i + 4));
        }
        for (let i = 0; i < 5; i++) {
          const b = o(110 + i);
          m.w32(b + A.O_IMAGE, 0);
          m.w32(b + A.O_X, m.s32(SHADE_POS + 8 * i));
          m.w32(b + A.O_KIND, 3);
          m.w32(b + A.O_Y, m.s32(SHADE_POS + 8 * i + 4));
        }
        const c = o(116);
        m.w32(c + A.O_ANIM, 1);
        const t = m.u32(ANIMS + 4);
        m.w32(c + A.O_IMAGE, m.s32(t + 4) + 0x10000);
        m.w32(c + A.O_ANIM_FRAME, 0);
        m.w32(c + A.O_ANIM_TIMER, m.s32(t));
        m.w32(c + A.O_X, m.s32(LABEL_POS + 8 * sel()));
        m.add32(M_STEP, 1);
        m.w32(c + A.O_Y, m.s32(LABEL_POS + 8 * sel() + 4));
        return;
      }
      case 4: {
        // FUN_80097650: choose a tile.
        const p = this.pressed();
        if (p & 0x40) {
          for (let i = 0; i < 5; i++) if (i !== sel()) m.w32(o(110 + i) + A.O_IMAGE, 0x10015);
          const t = o(sel() + 100);
          m.w32(o(116) + A.O_IMAGE, 0);
          m.w32(o(118) + A.O_IMAGE, m.s32(t + A.O_IMAGE));
          m.w32(o(118) + A.O_X, m.s32(t + A.O_X));
          m.w32(o(118) + A.O_SCALE_X, 0);
          m.w32(o(118) + A.O_SCALE_Y, 0);
          m.w32(o(118) + A.O_Y, m.s32(t + A.O_Y));
          m.w32(t + A.O_IMAGE, 0);
          sePlay(this, 5);
          m.add32(M_STEP, 1);
          return;
        }
        const dir = p & 0xf000;
        const nav = NAV + 16 * sel();
        let next = -1;
        if (dir === 0x2000) next = m.s32(nav);
        else if (dir === 0x1000) next = m.s32(nav + 12);
        else if (dir === 0x4000) next = m.s32(nav + 8);
        else if (dir === 0x8000) next = m.s32(nav + 4);
        if (next >= 0) {
          m.w32(M_SEL, next);
          sePlay(this, 3);
        }
        m.w32(o(116) + A.O_X, m.s32(LABEL_POS + 8 * sel()));
        m.w32(o(116) + A.O_Y, m.s32(LABEL_POS + 8 * sel() + 4));
        this.animTick(116, false);
        return;
      }
      case 5: {
        // FUN_80097868: the tile grows (16 ticks), then its page.
        const s = sel();
        const z = ZOOM + 16 * s;
        const big = o(118);
        const sh = o(s + 95);
        if (m.s32(big + A.O_SCALE_X) < 0x1000) {
          m.add32(big + A.O_SCALE_X, 0x100);
          m.add32(big + A.O_SCALE_Y, 0x100);
          m.add32(big + A.O_X, div16(m.s32(z)));
          m.add32(big + A.O_Y, div16(m.s32(z + 4)));
          m.add32(sh + A.O_SCALE_X, 0x100);
          m.add32(sh + A.O_SCALE_Y, 0x100);
          m.add32(sh + A.O_X, div16(m.s32(z + 8)));
          m.add32(sh + A.O_Y, div16(m.s32(z + 12)));
          if (this.pressed() & 0x20) m.add32(M_STEP, 2);
          return;
        }
        m.w32(big + A.O_4C, m.s32(big + A.O_X));
        m.w32(big + A.O_50, m.s32(big + A.O_Y));
        m.w32(big + A.O_IMAGE, m.s32(BIG_IMAGES + 4 * s) + 0x10000);
        m.w32(big + A.O_X, m.s32(BIG_POS + 8 * s));
        m.w32(big + A.O_SCALE_X, 0);
        m.w32(big + A.O_SCALE_Y, 0);
        m.w32(big + A.O_Y, m.s32(BIG_POS + 8 * s + 4));
        m.w32(sh + A.O_IMAGE, 0x1000f);
        m.w32(sh + A.O_4C, m.s32(sh + A.O_X));
        m.w32(sh + A.O_50, m.s32(sh + A.O_Y));
        m.w32(sh + A.O_X, m.s32(BIG_SHADOW_POS + 8 * s));
        m.w32(sh + A.O_SCALE_X, 0);
        m.w32(sh + A.O_SCALE_Y, 0);
        m.w32(sh + A.O_Y, m.s32(BIG_SHADOW_POS + 8 * s + 4));
        m.w32(o(121) + A.O_IMAGE, m.s32(TEXT_IMAGES + 4 * s) + 0x10000);
        m.w32(o(121) + A.O_X, m.s32(TEXT_POS + 8 * s));
        m.w32(o(121) + A.O_Y, m.s32(TEXT_POS + 8 * s + 4));
        m.w32(o(119) + A.O_IMAGE, m.s32(PLAYERS_IMAGES + 4 * s) + 0x10000);
        m.w32(o(119) + A.O_X, m.s32(PLAYERS_POS + 8 * s));
        m.add32(M_STEP, 1);
        m.w32(o(119) + A.O_Y, m.s32(PLAYERS_POS + 8 * s + 4));
        return;
      }
      case 6: {
        // FUN_80097B3C: Cross starts the mode, Circle goes back.
        const s = sel();
        const p = this.pressed();
        if (p & 0x40 && (s >= 4 || Select.modeAvailable(s))) {
          const c = o(120);
          m.w32(c + A.O_ANIM, 2);
          const t = m.u32(ANIMS + 8);
          m.w32(c + A.O_IMAGE, m.s32(t + 4) + 0x10000);
          m.w32(c + A.O_ANIM_FRAME, 0);
          m.w32(c + A.O_X, m.s32(o(118) + A.O_X));
          m.w32(c + A.O_Y, m.s32(o(118) + A.O_Y));
          m.w32(c + A.O_ANIM_TIMER, m.s32(t));
          sePlay(this, 0);
          m.w32(M_WAIT, 0x4b);
          m.add32(M_STEP, 2);
        } else if (p & 0x20) {
          const big = o(118);
          const sh = o(s + 95);
          m.w32(o(121) + A.O_IMAGE, 0);
          m.w32(big + A.O_SCALE_X, 0x1000);
          m.w32(big + A.O_SCALE_Y, 0x1000);
          m.w32(big + A.O_IMAGE, m.s32(TILE_IMAGES + 4 * s) + 0x10000);
          m.w32(big + A.O_X, m.s32(big + A.O_4C));
          m.w32(big + A.O_Y, m.s32(big + A.O_50));
          m.w32(sh + A.O_IMAGE, 0x10011);
          m.w32(sh + A.O_SCALE_X, 0x1000);
          m.w32(sh + A.O_SCALE_Y, 0x1000);
          m.w32(sh + A.O_X, m.s32(sh + A.O_4C));
          m.w32(sh + A.O_Y, m.s32(sh + A.O_50));
          m.w32(o(119) + A.O_IMAGE, 0);
          m.w32(o(119) + A.O_X, 0);
          m.w32(o(119) + A.O_Y, 0);
          sePlay(this, 5);
          m.add32(M_STEP, 1);
        }
        return;
      }
      case 7: {
        // FUN_80097C8C: the tile shrinks back.
        const s = sel();
        const big = o(118);
        if (m.s32(big + A.O_SCALE_X) < 1) {
          for (let i = 0; i < 5; i++) m.w32(o(110 + i) + A.O_IMAGE, 0);
          m.w32(M_STEP, 4);
          m.w32(o(s + 100) + A.O_IMAGE, m.s32(big + A.O_IMAGE));
          m.w32(big + A.O_IMAGE, 0);
          return;
        }
        const z = ZOOM + 16 * s;
        const sh = o(s + 95);
        m.add32(big + A.O_SCALE_X, -0x100);
        m.add32(big + A.O_SCALE_Y, -0x100);
        m.add32(big + A.O_X, -div16(m.s32(z)));
        m.add32(big + A.O_Y, -div16(m.s32(z + 4)));
        m.add32(sh + A.O_SCALE_X, -0x100);
        m.add32(sh + A.O_SCALE_Y, -0x100);
        m.add32(sh + A.O_X, -div16(m.s32(z + 8)));
        m.add32(sh + A.O_Y, -div16(m.s32(z + 12)));
        return;
      }
      case 8: {
        // FUN_80097E18: the frame flashes for 75 ticks.
        if (m.add32(M_WAIT, -1) < 0) m.add32(M_STEP, 1);
        else this.animTick(120, false);
        return;
      }
      case 9: {
        // FUN_80097E74: off to the mode (program 9 + tile), or Option mode (state+0x4C + 1).
        m.w32(M_STEP, 0);
        const s = m.s32(M_SEL);
        if (s < 4) {
          this.leaveForMode(s, false);
        } else {
          m.w32(A.PHASE, 0);
          m.w32(A.SUBPHASE, 0);
          m.add32(A.NEXT_PARAM, 1);
        }
        return;
      }
      default:
        return;
    }
  }

  // ---- Option mode ----

  private optionMode(): void {
    const m = this.m;
    switch (m.s32(A.PHASE)) {
      case 0:
        this.optionSetup();
        return;
      case 1:
        this.optionMenu();
        return;
      case 2:
      case 3:
      case 4:
      case 5:
        cardStep(this, m.s32(A.PHASE));
        return;
      case 7:
        // FUN_800983DC: back to the mode select.
        m.w32(A.NEXT_PARAM, 0);
        m.w32(A.PHASE, 0);
        m.w32(A.SUBPHASE, 0);
        return;
      default:
        return;
    }
  }

  private rotIndex(mask: number): number {
    let i = 0;
    while (i < 8 && this.m.s32(ROT_BUTTONS + 4 * i) !== mask) i++;
    return i;
  }

  /** FUN_80097F74 */
  private optionSetup(): void {
    const m = this.m;
    bgmRequest(this, BGM_STOP);
    m.w32(A.MENU_ROWS, 1);
    this.objectsClearAll();
    m.w32(O_ROW, 0);
    m.w32(O_BGM, 0);
    m.w32(O_SE, 0);
    m.w32(O_DATA, 0);
    m.w32(O_RANKING, 0);
    m.w32(ROT_INDEX, this.rotIndex(m.s32(ROT_CCW_P1)));
    m.w32(ROT_INDEX + 8, this.rotIndex(m.s32(ROT_CCW_P2)));
    m.w32(ROT_SHOWN, m.s32(ROT_CW_P1));
    m.w32(ROT_SHOWN + 4, m.s32(ROT_CW_P2));
    m.w32(ROT_INDEX + 4, this.rotIndex(m.s32(ROT_SHOWN)));
    m.w32(ROT_INDEX + 12, this.rotIndex(m.s32(ROT_SHOWN + 4)));
    this.put(0, 0x23, 0, 8);
    this.put(1, 0x23, 0xa0, 8);
    this.put(2, 0x24, 0x74, 0x18);
    this.put(100, 0xb1, 0xb4, 0xc0);
    m.add32(A.PHASE, 1);
  }

  /** FUN_80098228: the cursor, then every row. */
  private optionMenu(): void {
    const m = this.m;
    const p = this.pressed();
    if (p & 0x1000) {
      if (m.add32(O_ROW, -1) < 0) m.w32(O_ROW, 0);
      else sePlay(this, 3);
    }
    if (p & 0x4000) {
      if (m.add32(O_ROW, 1) < 0xd) sePlay(this, 3);
      else m.w32(O_ROW, 0xc);
    }
    this.rowTurn(0);
    this.rowTurn(1);
    this.rowLevel();
    this.rowMatches();
    this.rowSound();
    this.rowMusic();
    this.hi(m.s32(O_ROW) - 6 >>> 0 < 2);
    this.put(0x19, m.s32(HIGHLIGHT) + 0x2b, 0x1c, 0x74);
    this.rowBgmTest();
    this.rowSeTest();
    this.hi(m.s32(O_ROW) - 8 >>> 0 < 2);
    this.put(0x20, m.s32(HIGHLIGHT) + 0x2c, 0x1c, 0x88);
    this.put(0x21, m.s32(HIGHLIGHT) + 0x35, 0xb4, 0x88);
    this.put(0x22, m.s32(HIGHLIGHT) + 0x36, 0xec, 0x88);
    this.rowVolume(A.MUSIC_VOLUME, 0x23, 0x37, 0x92, true);
    this.rowVolume(A.SE_VOLUME, 0x2c, 0x38, 0x9c, false);
    this.rowCard(10, O_DATA, 0x35, 0x2d, 0xa6, 2);
    this.rowCard(11, O_RANKING, 0x38, 0x2e, 0xb0, 4);
    this.rowExit();
  }

  /** Sets the highlight offset; true when the cursor is on the row. */
  private hi(on: boolean): number {
    const v = on ? 0x38 : 0;
    this.m.w32(HIGHLIGHT, v);
    return v;
  }

  /**
   * FUN_800983F8 (row 0, left turn) / FUN_800987DC (row 1, right turn): pad 1 changes player 1's
   * button, pad 2 player 2's; a button the other turn has is skipped.
   */
  private rowTurn(row: 0 | 1): void {
    const m = this.m;
    const mine = row === 0 ? [ROT_CCW_P1, ROT_CCW_P2] : [ROT_CW_P1, ROT_CW_P2];
    const other = row === 0 ? [ROT_CW_P1, ROT_CW_P2] : [ROT_CCW_P1, ROT_CCW_P2];
    const idx = row === 0 ? [ROT_INDEX, ROT_INDEX + 8] : [ROT_INDEX + 4, ROT_INDEX + 12];
    const button = (i: number) => m.s32(ROT_BUTTONS + 4 * i);
    if (m.s32(O_ROW) === row) {
      this.hi(true);
      const pads = [m.u16(PAD1_PRESSED), m.u16(PAD2_PRESSED)];
      for (let p = 0; p < 2; p++) {
        let d = 0;
        if (pads[p] === 0x2000) d = 1;
        else if (pads[p] === 0x8000) d = -1;
        if (d === 0) {
          if (p === 0) continue;
          break;
        }
        const i = (m.s32(idx[p]) + d) & 7;
        m.w32(idx[p], i);
        if (m.s32(other[p]) === button(i)) m.w32(idx[p], (i + d) & 7);
        m.w32(mine[p], button(m.s32(idx[p])));
      }
    } else {
      this.hi(false);
    }
    m.w32(ROT_SHOWN, m.s32(mine[0]));
    m.w32(ROT_SHOWN + 4, m.s32(mine[1]));
    let a = 0;
    while (true) {
      const n = a + 1;
      if (m.s32(ROT_SHOWN) === button(a)) break;
      a = n;
      if (n >= 8) break;
    }
    m.w32(ROT_SHOWN_INDEX, a);
    m.w32(ROT_SHOWN_INDEX + 4, this.rotIndex(m.s32(ROT_SHOWN + 4)));
    const h = m.s32(HIGHLIGHT);
    const y = row === 0 ? 0x38 : 0x42;
    const n = row === 0 ? 3 : 9;
    this.put(n, h + (row === 0 ? 0x25 : 0x26), 0x1c, y);
    this.put(n + 1, h + 0x30, 0x99, y);
    this.put(n + 2, h + 0x32, 0xca, y);
    this.put(n + 3, h + 0x31, 0x116, y);
    this.put(n + 4, h + m.s32(ROT_SHOWN_INDEX) + 0x55, 0xb0, y);
    this.put(n + 5, h + m.s32(ROT_SHOWN_INDEX + 4) + 0x55, 0xfd, y);
  }

  /** A 0-3 setting that wraps (level, matches). */
  private wrap4(v: number): number {
    const p = this.pressed();
    if (p & 0x2000) {
      v = (v + 1) >>> 0;
      if (v > 3) v = 0;
    }
    if (p & 0x8000) {
      v = v - 1;
      if (v < 0) v = 3;
    }
    return v;
  }

  /** FUN_80098BC4: level (state+0x4B4FE). */
  private rowLevel(): void {
    const m = this.m;
    let v = m.u8(A.DIFFICULTY);
    if (this.hi(m.s32(O_ROW) === 2)) v = this.wrap4(v);
    m.w32(O_LEVEL, v);
    m.w8(A.DIFFICULTY, v);
    const h = m.s32(HIGHLIGHT);
    this.put(0xf, h + 0x27, 0x1c, 0x4c);
    this.put(0x10, h + v + 0x3b, 0x9a, 0x4c);
  }

  /** FUN_80098CF8: number of matches (state+0x4B501). */
  private rowMatches(): void {
    const m = this.m;
    let v = m.u8(MATCHES);
    if (this.hi(m.s32(O_ROW) === 3)) v = this.wrap4(v);
    m.w32(O_MATCHES, v);
    m.w8(MATCHES, v);
    const h = m.s32(HIGHLIGHT);
    this.put(0x11, h + 0x28, 0x1c, 0x56);
    this.put(0x12, h + 0x33, 0xa7, 0x56);
    this.put(0x13, h + v * 2 + 0x44, 0x99, 0x56);
  }

  /** FUN_80098E4C: stereo / mono (state+0x4B4FC bit 0). */
  private rowSound(): void {
    const m = this.m;
    let v = m.u8(A.SETTING_4FC);
    if (this.hi(m.s32(O_ROW) === 4)) {
      const t = v ^ 1;
      m.w32(O_TOGGLE, t);
      if (this.pressed() & 0xa000) {
        this.mix.push({ kind: t === 0 ? 'stereo' : 'mono' });
        v = t;
      }
    }
    m.w32(O_TOGGLE, v);
    m.w8(A.SETTING_4FC, v);
    const h = m.s32(HIGHLIGHT);
    this.put(0x14, h + 0x29, 0x1c, 0x60);
    this.put(0x15, h + v + 0x3f, 0x9a, 0x60);
  }

  /** FUN_80098F7C: music mode, console / arcade (state+0x4B4FD). */
  private rowMusic(): void {
    const m = this.m;
    let v = m.u8(A.SETTING_4FD);
    if (this.hi(m.s32(O_ROW) === 5)) {
      if (this.pressed() & 0x2000) v ^= 1;
      if (this.pressed() & 0x8000) v ^= 1;
    }
    m.w32(O_TOGGLE, v);
    m.w8(A.SETTING_4FD, v);
    const h = m.s32(HIGHLIGHT);
    this.put(0x16, h + 0x2a, 0x1c, 0x6a);
    this.put(0x17, h + 0x34, 0xd8, 0x6a);
    this.put(0x18, h + v + 0x41, 0x9a, 0x6a);
  }

  /** A 0-49 sound test number. */
  private wrap50(a: number): void {
    const p = this.pressed();
    if (p & 0x2000 && this.m.add32(a, 1) > 0x31) this.m.w32(a, 0);
    if (p & 0x8000 && this.m.add32(a, -1) < 0) this.m.w32(a, 0x31);
  }

  /** FUN_800990F8: sound test, music: Cross plays CD track number + 2, looping. */
  private rowBgmTest(): void {
    const m = this.m;
    if (this.hi(m.s32(O_ROW) === 6)) {
      this.wrap50(O_BGM);
      if (this.pressed() & 0x40) {
        const track = m.s32(O_BGM) + 2;
        m.w32(BGM_CUR_ID, track);
        m.w32(A.TWO_PLAYER, 0);
        cdVolume(this, musicVolume(this));
        if (trackExists(this, track)) playTrack(this, track, 1);
      }
    }
    const h = m.s32(HIGHLIGHT);
    const n = m.s32(O_BGM);
    this.put(0x1a, h + 0x37, 0x9a, 0x74);
    this.put(0x1b, h + Math.trunc(n / 10) + 0x43, 0xb4, 0x74);
    this.put(0x1c, h + (n % 10) + 0x43, 0xbb, 0x74);
  }

  /** FUN_80099414: sound test, effects: Cross plays effect number. */
  private rowSeTest(): void {
    const m = this.m;
    if (this.hi(m.s32(O_ROW) === 7)) {
      this.wrap50(O_SE);
      if (this.pressed() & 0x40) {
        m.w32(A.TWO_PLAYER, 0);
        sePlay(this, m.s32(O_SE));
      }
    }
    const h = m.s32(HIGHLIGHT);
    const n = m.s32(O_SE);
    this.put(0x1d, h + 0x38, 0x9a, 0x7e);
    this.put(0x1e, h + Math.trunc(n / 10) + 0x43, 0xb4, 0x7e);
    this.put(0x1f, h + (n % 10) + 0x43, 0xbb, 0x7e);
  }

  /**
   * FUN_80099668 (row 8, music, state+0x4B4FF) / FUN_80099844 (row 9, effects, state+0x4B500):
   * volume 0-7 as eight blocks. The music row sets the CD volume every tick while a track
   * is chosen.
   */
  private rowVolume(addr: number, first: number, label: number, y: number, music: boolean): void {
    const m = this.m;
    let v = m.u8(addr);
    if (this.hi(m.s32(O_ROW) === (music ? 8 : 9))) {
      const p = this.pressed();
      if (p & 0x2000 && (v = (v + 1) >>> 0) > 7) v = 7;
      if (p & 0x8000 && (v = v - 1) < 0) v = 0;
    }
    m.w32(O_VOLUME, v);
    m.w8(addr, v);
    if (music && m.s32(BGM_CUR_ID) !== BGM_STOP) cdVolume(this, musicVolume(this));
    const h = m.s32(HIGHLIGHT);
    this.put(first, h + label, 0x9a, y);
    for (let i = 0; i < 8; i++) this.put(first + 1 + i, i < v + 1 ? h + 0x54 : h + 0x53, 0xb4 + 8 * i, y);
  }

  /**
   * FUN_800999D0 (row 10, option data) / FUN_80099B34 (row 11, ranking): load or save on the
   * memory card; Cross goes to phase `phase` + the choice (2 load, 3 save options; 4 load, 5
   * save ranking).
   */
  private rowCard(row: number, choice: number, first: number, label: number, y: number, phase: number): void {
    const m = this.m;
    let image: number;
    if (this.hi(m.s32(O_ROW) === row)) {
      image = 0x38 + label;
      const p = this.pressed();
      if (p & 0x2000) m.w32(choice, m.s32(choice) ^ 1);
      else if (p & 0x8000) m.w32(choice, m.s32(choice) ^ 1);
      else if (p & 0x40) {
        m.w32(A.PHASE, m.s32(choice) + phase);
        m.w32(A.SUBPHASE, 0);
      }
    } else {
      image = label;
    }
    const h = m.s32(HIGHLIGHT);
    const c = m.s32(choice);
    this.put(first, image, 0x1c, y);
    this.put(first + 1, Math.imul(c ^ 1, h) + 0x39, 0x9a, y);
    this.put(first + 2, Math.imul(h, c) + 0x3a, 0xba, y);
  }

  /** FUN_80099C98: exit (phase 7: back to the mode select). */
  private rowExit(): void {
    const m = this.m;
    if (this.hi(m.s32(O_ROW) === 12) && this.pressed() & 0x40) {
      bgmRequest(this, BGM_STOP);
      m.w32(A.PHASE, 7);
    }
    this.put(0x3b, m.s32(HIGHLIGHT) + 0x2f, 0x1c, 0xba);
  }

  traceRow() {
    return traceRow(this);
  }
}

/** C's signed division by 16 (the compiler's (v + 15) >> 4 for negative v). */
function div16(v: number): number {
  return (v < 0 ? v + 15 : v) >> 4;
}
