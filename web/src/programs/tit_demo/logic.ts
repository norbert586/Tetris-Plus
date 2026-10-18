// TIT_DEMO.EXE (program 2): the story intro after the power-on screens (docs/re/title.md §2).
// Phase 0 clears the objects and starts CD track 2; phase 1 plays the scenes (a state machine
// over sprite objects 0-11) and the three caption pages (letters in objects 100-199) side by
// side; at the end it names TITLE (param 0, phase 0). START in phase 1 names TITLE with phase 9
// (the finished title screen). State lives at the original's addresses.
import { obj, ModeProgram, S, type Layout } from '../title/common';
import type { Shared } from '../../flow/program';
import { ROM } from './rom';

// Globals (TIT_DEMO.EXE's BSS)
const SCENE = 0x800b5cf8; // the scene step (table 0x80094038)
const CAPTION = 0x800b5d08; // the caption step (table 0x80094070)
const PLAYER = 0x800b5d18; // current player (always 0)
const CX = 0x800b5d20; // the next letter's position, 16.16
const CY = 0x800b5d24;
const SCRIPT = 0x800b5d28; // the caption script (pointer table 0x800AFC54)
const CHAR = 0x800b5d2c; // the next word of the script
const LETTER = 0x800b5d30; // the next letter object (100 + n)
const WAIT = 0x800b5d34; // ticks to the next letter
const PAGE_STEP = 0x800b5d38; // the page's step (table 0x800940A4)
const ORIGIN = 0x800b5d3c; // the page's start position (table 0x800AFCB8)
const REPEATS = 0x800b5d40; // scripts left on this caption
const SPEED = 0x800b5d44; // ticks per letter
const HOLD = 0x800b5d48; // ticks a finished script stays
const COUNT = 0x800b5d4c; // scene counters
const SCROLL = 0x800b5d50;
const PAUSE = 0x800b5d54; // ticks between captions
const PAGE = 0x800b5d58; // the caption (0-2)
const BLINK = 0x800b5e7c; // ticks to the next blend mode of the scroll

// Tables (TIT_DEMO.EXE's data)
const SCROLL_STOP = 0x800af784; // s32 per scroll: the y it stops at, -1 ends
const SCROLL_IMAGE = 0x800af794;
const SCROLL_X = 0x800af7a0;
const BLINK_MODES = 0x800af7ac; // s32: [0] ticks per mode, then blend modes, 0xFFFF ends
const CAPTIONS = 0x800af7d0; // 0x18 per caption: script, origin, repeats, speed, hold, pause
const SCRIPTS = 0x800afc54; // pointer per script
const ORIGINS = 0x800afcb8; // x, y per origin (16.16)
const FONT_BASE = 0x800af838; // s32 by the letter's high nibble: its font's first image
const FONT_WIDE = 0x800af84c; // the wide (0x5xxxxxxx) letters' first image

export const LAYOUT: Layout = {
  name: 'TIT_DEMO',
  rom: ROM,
  bss: [0x800b5ccc, 0x800b8bb4],
  pad: 0x800b8ba2,
  activeBuff: 0x800b5e78,
  fields: [
    ['pad', 0x800b8ba2, 'u16'],
    ['padp', 0x800b8ba4, 'u16'],
    ['pad2', 0x800b8ba8, 'u16'],
    ['padp2', 0x800b8baa, 'u16'],
    ['scene', SCENE, 's32'],
    ['caption', CAPTION, 's32'],
    ['vars', PLAYER, 's32', 17],
    ['blink', BLINK, 's32'],
    ['oimg', S + 0x5c + 0x24, 's32', 16, 0x7c],
    ['ox', S + 0x5c, 's32', 16, 0x7c],
    ['oy', S + 0x5c + 0x04, 's32', 16, 0x7c],
    ['ofade', S + 0x5c + 0x4c, 's32', 16, 0x7c],
    ['cimg', S + 0x5c + 100 * 0x7c + 0x24, 's32', 8, 0x7c],
    ['bgmcur', 0x800b5d80, 's32', 4],
  ],
  seVolume: 0x800aecec,
  seTable: 0x800aecfc,
  bgm: {
    volume: 0x800aecdc,
    track: 0x800aee8c,
    zoneTracks: 0x800af0fc,
    zone: 0x800b5d6c,
    player: PLAYER,
    state: 0x800b5d80,
    join: 0x800b5d90,
  },
};

export class TitDemo extends ModeProgram {
  constructor(shared: Shared) {
    super(shared, LAYOUT);
  }

  /** Word at state + offset (the original addresses objects through state). */
  private r(offset: number): number {
    return this.m.s32(S + offset);
  }
  private w(offset: number, v: number): void {
    this.m.w32(S + offset, v);
  }
  private g(a: number): number {
    return this.m.s32(a);
  }
  private s(a: number, v: number): void {
    this.m.w32(a, v);
  }
  private inc(a: number, d = 1): number {
    return this.m.add32(a, d);
  }

  protected startup(): void {
    const m = this.m;
    // sound_init (FUN_80095544): bgm_request's state, the CD volume.
    m.w32(0x800b5d80, 0);
    m.w32(0x800b5d84, 0x34);
    m.w32(0x800b5d88, 0x34);
    m.w32(0x800b5d8c, 0x34);
    const vol = m.s16(LAYOUT.bgm.volume + 2 * m.u8(S + 0x4b4ff));
    this.sound.push({ kind: 'cdvol', vol });
    m.w32(S + 0x1fcf4, 0);
  }

  protected logic(): void {
    switch (this.r(0x50)) {
      case 0:
        this.phase0();
        return;
      case 1:
        // FUN_80096C0C
        if (this.pressed() & 0x800) this.w(0x50, 3);
        else {
          this.sceneStep();
          this.captionStep();
        }
        return;
      case 2:
        this.exitTo(3, 0, 0);
        return;
      case 3:
        this.exitTo(3, 0, 9);
        return;
      default:
        return;
    }
  }

  /** FUN_80096BE4: the subphase steps, then CD track 2 every tick. */
  private phase0(): void {
    switch (this.r(0x54)) {
      case 0:
        // FUN_80096D48
        for (let n = 0; n < 0x41a; n++) this.objectClear(n);
        for (const a of [0x800b5cf8, 0x800b5cfc, 0x800b5d00, 0x800b5d04, CAPTION, 0x800b5d0c, 0x800b5d10, 0x800b5d14, PAGE, PAUSE, SCROLL, COUNT]) {
          this.s(a, 0);
        }
        this.inc(S + 0x54);
        break;
      case 1:
      case 2:
        this.inc(S + 0x54);
        break;
      case 3:
        this.w(0x54, 0);
        this.inc(S + 0x50);
        break;
    }
    this.bgmRequest(2);
  }

  /** object n's fade level (+0x4C) up by one; true once it reaches 64 (FUN_80097E68). */
  private fadeUp(n: number): boolean {
    const a = obj(n) + 0x4c;
    const v = this.inc(a);
    if (v > 0x3f) this.s(a, 0x40);
    return v > 0x3f;
  }
  /** Down by one; true once it went below 0 (FUN_80097EB0). */
  private fadeDown(n: number): boolean {
    const a = obj(n) + 0x4c;
    const v = this.inc(a, -1);
    if (v < 0) this.s(a, 0);
    return v < 0;
  }

  /** FUN_80096E00: clears the caption letters (objects 100-199). */
  private clearLetters(): void {
    for (let i = 0; i < 100; i++) this.objectClear(i + 100);
  }

  /** The two scroll layers (objects 5 and 6) move up 0x7000 a tick. */
  private scrollUp(): void {
    this.w(0x2c8, this.r(0x2c8) - 0x7000);
    this.w(0x344, this.r(0x344) - 0x7000);
  }

  /** FUN_80096E3C: the scene steps (table 0x80094038). */
  private sceneStep(): void {
    switch (this.g(SCENE)) {
      case 0:
        // FUN_80096EC0: the background (objects 0 and 1) under a darkening box (object 2).
        this.w(0x80, 0x10001);
        this.w(0xfc, 0x10001);
        this.w(0xd8, 0xa00000);
        this.w(0x168, -2);
        this.w(0x178, 0x10000);
        this.w(0x1a0, 0x20);
        this.w(0x18c, 0x140);
        this.w(0x5c, 0);
        this.w(0x60, 0);
        this.w(0xdc, 0);
        this.w(0x154, 0);
        this.w(0x158, 0);
        this.w(0x190, 0xf0);
        this.inc(SCENE);
        return;
      case 1:
        // FUN_80096F2C
        if (this.fadeUp(2)) {
          this.w(0x2ec, 0x10003);
          this.w(0x2c8, 0xdc0000);
          this.w(0x344, 0x1400000);
          this.w(0x3d4, -2);
          this.w(0x3e4, 0x10000);
          this.w(0x3c4, 0x24);
          this.w(0x3f8, 0x140);
          this.w(0x2cc, 0x200000);
          this.w(0x348, 0x200000);
          this.w(0x368, 0x10004);
          this.w(0x40c, 0);
          this.w(0x3c0, 0);
          this.w(0x3fc, 0x78);
          this.inc(SCENE);
        }
        return;
      case 2:
        // FUN_80096FC4
        this.w(0x344, this.r(0x344) - 0x7000);
        this.w(0x2c8, this.r(0x2c8) - 0x7000);
        if (this.fadeUp(7)) {
          this.s(SCROLL, 0);
          this.inc(SCENE);
        }
        return;
      case 3: {
        // FUN_80097018
        const i = this.g(SCROLL) * 4;
        this.scrollUp();
        if (this.r(0x2c8) <= this.g(SCROLL_STOP + i)) {
          this.w(0x558, this.g(SCROLL_IMAGE + i));
          this.w(0x538, 0x200000);
          this.s(COUNT, 1);
          this.w(0x534, this.g(SCROLL_X + i));
          this.w(0x548, this.g(BLINK_MODES + 4));
          this.inc(SCENE);
          this.s(BLINK, this.g(BLINK_MODES));
        }
        return;
      }
      case 4: {
        // FUN_800970CC
        const left = this.inc(BLINK, -1);
        this.scrollUp();
        if (left === 0) {
          const k = this.inc(COUNT);
          if (this.g(BLINK_MODES + 4 * k) === 0xffff) {
            this.objectClear(10);
            this.inc(SCENE);
          } else {
            this.w(0x548, this.g(BLINK_MODES + 4 * k));
            this.s(BLINK, this.g(BLINK_MODES));
          }
        }
        return;
      }
      case 5: {
        // FUN_80097174
        const i = this.inc(SCROLL) * 4;
        this.scrollUp();
        if (this.g(SCROLL_STOP + i) === -1) this.inc(SCENE);
        else this.inc(SCENE, -2);
        return;
      }
      case 6:
        // FUN_800971E0
        this.scrollUp();
        if (this.fadeDown(0xb)) {
          this.objectClear(6);
          this.objectClear(5);
          this.objectClear(10);
          this.s(COUNT, 0x9a);
          this.inc(SCENE);
        }
        return;
      case 7: {
        // FUN_80097250
        const c = this.inc(COUNT, -1);
        if (c === 0x5a) this.clearLetters();
        if (this.g(COUNT) < 1) {
          this.s(COUNT, 0x200);
          this.w(0x2ec, 0x10008);
          this.w(0x2c8, 0);
          this.w(0x2cc, 0x200000);
          this.w(0x368, 0x10009);
          this.w(0x344, 0xa00000);
          this.w(0x348, 0x200000);
          this.inc(SCENE);
        }
        return;
      }
      case 8:
        // FUN_800972DC
        if (this.inc(COUNT, -1) < 0) {
          this.w(0x2ec, 0x1000a);
          this.w(0x368, 0x1000b);
          this.clearLetters();
          this.s(COUNT, 0x140);
          this.inc(SCENE);
        }
        return;
      case 9:
        // FUN_80097338
        if (this.inc(COUNT, -1) < 0) {
          this.clearLetters();
          this.w(0x3d4, -2);
          this.w(0x3e4, 0x10000);
          this.w(0x40c, 0x40);
          this.w(0x3f8, 0x140);
          this.w(0x3c0, 0);
          this.w(0x3c4, 0);
          this.w(0x3fc, 0xf0);
          this.inc(SCENE);
        }
        return;
      case 10:
        // FUN_800973AC: fades out on odd ticks.
        if ((this.m.u32(S + 0x40) & 1) !== 0 && this.fadeDown(7)) this.inc(SCENE);
        return;
      case 11:
        // FUN_800973FC
        this.s(SCENE, 0);
        this.inc(S + 0x50);
        return;
      default:
        return;
    }
  }

  /** FUN_80097428: the caption steps (table 0x80094070). */
  private captionStep(): void {
    switch (this.g(CAPTION)) {
      case 0: {
        // FUN_800974A8
        this.s(PAGE_STEP, 0);
        const i = this.g(PAGE) * 0x18;
        this.inc(CAPTION);
        this.s(SCRIPT, this.g(CAPTIONS + i));
        this.s(ORIGIN, this.g(CAPTIONS + i + 4));
        this.s(REPEATS, this.g(CAPTIONS + i + 8));
        this.s(SPEED, this.g(CAPTIONS + i + 12));
        this.s(HOLD, this.g(CAPTIONS + i + 16));
        return;
      }
      case 1:
        // FUN_80097534
        if (this.pageStep() !== 0) {
          this.s(PAUSE, this.g(CAPTIONS + 20 + this.g(PAGE) * 0x18));
          this.inc(CAPTION);
        }
        return;
      case 2:
        // FUN_80097590
        if (this.inc(PAUSE, -1) < 0) {
          if (this.inc(PAGE) === 3) this.inc(CAPTION);
          else this.inc(CAPTION, -2);
        }
        return;
      default:
        return;
    }
  }

  /** FUN_80097758: one caption page's steps (table 0x800940A4); 1 when the caption is done. */
  private pageStep(): number {
    switch (this.g(PAGE_STEP)) {
      case 0:
        // FUN_800977B8: a new script: clear the letters, back to the origin.
        this.clearLetters();
        this.s(CHAR, 0);
        this.s(LETTER, 0);
        this.s(WAIT, this.g(SPEED));
        this.inc(PAGE_STEP);
        this.s(CX, this.g(ORIGINS + this.g(ORIGIN) * 8));
        this.s(CY, this.g(ORIGINS + 4 + this.g(ORIGIN) * 8));
        return 0;
      case 1:
        return this.typeLetter();
      case 2:
        // FUN_80097A94: hold the finished script, then the next one.
        if (this.inc(WAIT, -1) === 0) {
          this.s(PAGE_STEP, 0);
          this.inc(SCRIPT);
        }
        return 0;
      default:
        return 0;
    }
  }

  /** FUN_80097840: every SPEED ticks, the script's next word: a letter, a space, a new line or the end. */
  private typeLetter(): number {
    const m = this.m;
    const y0 = this.g(CY);
    const player = this.g(PLAYER);
    if (this.inc(WAIT, -1) >= 1) return 0;
    this.s(WAIT, this.g(SPEED));
    const script = m.u32(SCRIPTS + 4 * this.g(SCRIPT));
    let word = m.u32(script + 4 * this.g(CHAR));
    if (word === 0xffffffff) {
      if (this.inc(REPEATS, -1) < 1) return 1;
      this.inc(PAGE_STEP);
      this.s(WAIT, this.g(HOLD));
      return 0;
    }
    if (word === 0xfffffffe) {
      this.inc(CHAR);
      this.s(CX, this.g(ORIGINS + this.g(ORIGIN) * 8));
      this.s(CY, this.g(CY) + 0xc0000);
      return 0;
    }
    if (word === 0xf0000000) {
      this.inc(CHAR);
      this.s(WAIT, 0);
      this.s(CX, this.g(CX) + 0x90000);
      return 0;
    }
    let dx = 0;
    if ((word & 0xf0000000) >>> 0 === 0x50000000) {
      // A wide letter: its first half here, then the next word at 2 pixels to the left.
      dx = -0x20000;
      const o = obj(this.g(LETTER) + 100);
      const next = this.inc(CHAR);
      m.w32(o + 0x24, (word & 0xfffffff) + this.g(FONT_WIDE) + 0x10000);
      m.w32(o + 0x04, y0);
      m.w32(o + 0x1c, player);
      m.w32(o + 0x00, this.g(CX) - 0x20000);
      m.w32(o + 0x20, 2);
      this.s(CX, this.g(CX) + 0xc0000);
      this.inc(LETTER);
      word = m.u32(script + 4 * next);
    }
    const o = obj(this.g(LETTER) + 100);
    const base = this.g(FONT_BASE + 4 * (word >>> 28));
    m.w32(o + 0x1c, this.g(PLAYER));
    m.w32(o + 0x24, (word & 0xfffffff) + base + 0x10000);
    m.w32(o + 0x00, dx + this.g(CX));
    m.w32(o + 0x20, 2);
    m.w32(o + 0x04, this.g(CY));
    this.s(CX, this.g(CX) + ((word & 0xf0000000) >>> 0 === 0x50000000 ? 0xe0000 : 0x90000));
    this.inc(CHAR);
    this.inc(LETTER);
    return 0;
  }

  /** objects_draw (FUN_80096854), for its rand() calls: box-fill objects (kind -1). */
  protected override drawState(): void {
    for (let n = 0x419; n >= 0; n--) {
      const o = obj(n);
      if (this.m.s32(o + 0x24) !== 0 && this.m.s32(o + 0x14) === -1) {
        this.boxColors.push(this.rand() & 7, this.rand() & 7, this.rand() & 7);
      }
    }
  }
}
