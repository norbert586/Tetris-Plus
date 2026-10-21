// TIT_DEMO.EXE: the story intro after the copyright at power-on (and after RANKING), before the
// title (docs/re/shell.md §7). Pictures fade up, a picture scrolls, and a typewriter writes three
// pages of text in glyph objects; Start skips to TITLE's "press start". Ported from the decompile
// of TIT_DEMO.EXE (main 0x80095718, logic 0x80096B58, draw 0x80096854).
//
// Quirks of the original kept here: the glyphs' shake offset (draw: table 0x800AEC68 indexed by
// object +0x20, times the amplitude in +0x1C) always has amplitude gp+0x5C, which nothing in the
// program writes, so the text never shakes; the soft-reset check (0x800966FC) is linked but never
// called, so Start+Select does nothing here beyond Start's own skip.
import * as A from '../../addr';
import { objectClear, objectsClearAll } from '../../objects';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800b8bb4;
const PAD = 0x800b8ba2; // P1 held; pressed +2; P2 +6

// The story's variables (gp = 0x800B5CBC), cleared by FUN_800959A0 (gp+0x3C..gp+0xB4).
const VARS = 0x800b5cf8;
const SCENE = 0x800b5cf8; // gp+0x3C: the scene machine's step (table 0x80094038)
const TEXT = 0x800b5d08; // gp+0x4C: the text machine's step (table 0x80094070)
const AMPLITUDE = 0x800b5d18; // gp+0x5C: the glyphs' shake amplitude (never set); also bgm_request's player
const PEN_X = 0x800b5d20; // gp+0x64: the typewriter's position (16.16)
const PEN_Y = 0x800b5d24; // gp+0x68
const SCRIPT = 0x800b5d28; // gp+0x6C: the script (index into 0x800AFC54)
const CHAR = 0x800b5d2c; // gp+0x70: the next code in the script
const GLYPH = 0x800b5d30; // gp+0x74: glyph objects used (from object 100)
const DELAY = 0x800b5d34; // gp+0x78: frames to the next code
const WRITER = 0x800b5d38; // gp+0x7C: the typewriter's step (table 0x800940A4)
const ORIGIN = 0x800b5d3c; // gp+0x80: the page's text origin (index into 0x800AFCB8)
const SCRIPTS_LEFT = 0x800b5d40; // gp+0x84: scripts left on the page
const CHAR_DELAY = 0x800b5d44; // gp+0x88: frames per character
const SCRIPT_HOLD = 0x800b5d48; // gp+0x8C: frames a finished script stays before the next
const SCENE_TIMER = 0x800b5d4c; // gp+0x90: scene timer / blink index
const SCROLL_STOP = 0x800b5d50; // gp+0x94: index into the scroll stops
const PAGE_HOLD = 0x800b5d54; // gp+0x98: frames a finished page stays
const PAGE = 0x800b5d58; // gp+0x9C: the page (3 pages)
const BLINK_TIMER = 0x800b5e7c; // gp+0x1C0: frames per blink step

// Tables in TIT_DEMO.EXE's data.
const SCROLL_STOPS = 0x800af784; // x (16.16) of the scrolling picture where a caption shows; -1 ends
const CAPTION_IMAGES = 0x800af794;
const CAPTION_X = 0x800af7a0;
const BLINK = 0x800af7ac; // [0] frames per step, then the caption's blend kinds; 0xFFFF ends
const PAGES = 0x800af7d0; // 0x18 bytes: script, origin, scripts, char delay, script hold, page hold
const SCRIPT_TABLE = 0x800afc54; // script pointers: codes (u32)
const GLYPH_SETS = 0x800af838; // image base by the code's high nibble
const ORIGINS = 0x800afcb8; // x, y (16.16)

const FIELDS: Field[] = [
  ...commonFields(PAD),
  ['vars', VARS, 's32', 31],
  ['blink', BLINK_TIMER, 's32'],
];

const obj = A.obj;
const O_SHAKE_AMP = A.O_PLAYER; // +0x1C
const O_SHAKE = A.O_20; // +0x20: index into the shake table
const O_W = A.O_VX; // box kinds: width and height
const O_H = A.O_VY;
const O_LEVEL = A.O_4C; // box kinds: fade level 0-64

export class TitDemo extends Program {
  readonly name = 'TIT_DEMO';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    const m = this.m;
    // main before its loop: FUN_800959A0 (the story variables, already zero), the sound init
    // (FUN_80095544: the first step's soundInit), FUN_80094B28 (8 pad records of 6 bytes from
    // 0x800B8BA0, past the end of the BSS), the exit flag.
    for (let i = 0; i < 8; i++) {
      m.w16(0x800b8ba0 + 6 * i, 0);
      m.w16(0x800b8ba2 + 6 * i, 0);
      m.w16(0x800b8ba4 + 6 * i, 0);
    }
    m.w32(A.EXIT_FLAG, 0);
  }

  step(pad: number): void {
    this.beginTick();
    if (this.tick > 0) {
      // The previous iteration's tail: PadRead, the CD watchdog, rand() (no soft-reset check).
      this.padRead(PAD, pad);
      this.cdWatchdog(); // FUN_80094FBC
      this.rand();
    }
    this.tick++;
    this.m.add32(A.COUNTER, 1);
    this.logic();
    this.draw();
  }

  traceRow() {
    return readFields(this, FIELDS);
  }

  /** FUN_80096B58: the phase machine on state+0x50 (table 0x80094000). */
  private logic(): void {
    const m = this.m;
    switch (m.s32(A.PHASE)) {
      case 0:
        // FUN_80096BE4: the init's sub-machine, then the story music, every frame.
        this.init();
        this.bgmRequest(2);
        return;
      case 1:
        // FUN_80096C0C: Start skips the story.
        if (m.u16(PAD + 2) & 0x800) {
          m.w32(A.PHASE, 3);
        } else {
          this.scene();
          this.text();
        }
        return;
      case 2:
        this.exitTo(3, 0, 0); // FUN_80096C54: the story ended; TITLE plays its whole logo
        return;
      case 3:
        this.exitTo(3, 0, 9); // FUN_80096C80: skipped; TITLE starts at "press start"
        return;
      default:
        return; // 4-9: stubs
    }
  }

  /** FUN_80096CE0: the init on state+0x54 (table 0x80094028). */
  private init(): void {
    const m = this.m;
    switch (m.s32(A.SUBPHASE)) {
      case 0:
        // FUN_80096D48
        objectsClearAll(this);
        m.fill(VARS, 0x20); // gp+0x3C..gp+0x58
        m.w32(PAGE, 0);
        m.w32(PAGE_HOLD, 0);
        m.w32(SCROLL_STOP, 0);
        m.w32(SCENE_TIMER, 0);
        m.add32(A.SUBPHASE, 1);
        return;
      case 1:
      case 2:
        m.add32(A.SUBPHASE, 1);
        return;
      case 3:
        m.w32(A.SUBPHASE, 0);
        m.add32(A.PHASE, 1);
        return;
    }
  }

  /** FUN_80097E68: fade box `n` up a step; true (at 64) when done. */
  private fadeUp(n: number): boolean {
    const m = this.m;
    const v = m.add32(obj(n) + O_LEVEL, 1);
    if (v > 0x3f) m.w32(obj(n) + O_LEVEL, 0x40);
    return v > 0x3f;
  }

  /** FUN_80097EB0: fade box `n` down a step; true (below 0) when done. */
  private fadeDown(n: number): boolean {
    const m = this.m;
    const v = m.add32(obj(n) + O_LEVEL, -1);
    if (v < 0) m.w32(obj(n) + O_LEVEL, 0);
    return v < 0;
  }

  /** The two halves of the scrolling picture (objects 5 and 6) move left 0.4375 px a frame. */
  private scroll(): void {
    this.m.add32(obj(5) + A.O_X, -0x7000);
    this.m.add32(obj(6) + A.O_X, -0x7000);
  }

  /** Clears the glyph objects 100-199 (FUN_80096E00). */
  private clearGlyphs(): void {
    for (let n = 100; n < 200; n++) objectClear(this, n);
  }

  /** FUN_80096E3C: the scene machine on gp+0x3C (table 0x80094038). */
  private scene(): void {
    const m = this.m;
    switch (m.s32(SCENE)) {
      case 0: {
        // FUN_80096EC0: the first picture (objects 0 and 1) under a dark fade box (object 2).
        m.w32(obj(0) + A.O_IMAGE, 0x10001);
        m.w32(obj(1) + A.O_IMAGE, 0x10001);
        m.w32(obj(1) + A.O_X, 0xa00000);
        m.w32(obj(2) + A.O_KIND, -2);
        m.w32(obj(2) + A.O_IMAGE, 0x10000);
        m.w32(obj(2) + O_LEVEL, 0x20);
        m.w32(obj(2) + O_W, 0x140);
        m.w32(obj(0) + A.O_X, 0);
        m.w32(obj(0) + A.O_Y, 0);
        m.w32(obj(1) + A.O_Y, 0);
        m.w32(obj(2) + A.O_X, 0);
        m.w32(obj(2) + A.O_Y, 0);
        m.w32(obj(2) + O_H, 0xf0);
        m.add32(SCENE, 1);
        return;
      }
      case 1:
        // FUN_80096F2C: when the picture is up, the scrolling picture (5, 6) and a fade box (7).
        if (this.fadeUp(2)) {
          m.w32(obj(5) + A.O_IMAGE, 0x10003);
          m.w32(obj(5) + A.O_X, 0xdc0000);
          m.w32(obj(6) + A.O_X, 0x1400000);
          m.w32(obj(7) + A.O_KIND, -2);
          m.w32(obj(7) + A.O_IMAGE, 0x10000);
          m.w32(obj(7) + A.O_Y, 0x24);
          m.w32(obj(7) + O_W, 0x140);
          m.w32(obj(5) + A.O_Y, 0x200000);
          m.w32(obj(6) + A.O_Y, 0x200000);
          m.w32(obj(6) + A.O_IMAGE, 0x10004);
          m.w32(obj(7) + O_LEVEL, 0);
          m.w32(obj(7) + A.O_X, 0);
          m.w32(obj(7) + O_H, 0x78);
          m.add32(SCENE, 1);
        }
        return;
      case 2:
        // FUN_80096FC4
        this.scroll();
        if (this.fadeUp(7)) {
          m.w32(SCROLL_STOP, 0);
          m.add32(SCENE, 1);
        }
        return;
      case 3: {
        // FUN_80097018: at the next stop, a caption (object 10) that blinks.
        const k = 4 * m.s32(SCROLL_STOP);
        this.scroll();
        if (m.s32(obj(5) + A.O_X) <= m.s32(SCROLL_STOPS + k)) {
          m.w32(obj(10) + A.O_IMAGE, m.s32(CAPTION_IMAGES + k));
          m.w32(obj(10) + A.O_Y, 0x200000);
          m.w32(SCENE_TIMER, 1);
          m.w32(obj(10) + A.O_X, m.s32(CAPTION_X + k));
          m.w32(obj(10) + A.O_KIND, m.s32(BLINK + 4));
          m.add32(SCENE, 1);
          m.w32(BLINK_TIMER, m.s32(BLINK));
        }
        return;
      }
      case 4: {
        // FUN_800970CC: the caption's blend kinds, one step every BLINK[0] frames.
        const left = m.add32(BLINK_TIMER, -1);
        this.scroll();
        if (left === 0) {
          const i = m.add32(SCENE_TIMER, 1);
          const kind = m.s32(BLINK + 4 * i);
          if (kind === 0xffff) {
            objectClear(this, 10);
            m.add32(SCENE, 1);
          } else {
            m.w32(obj(10) + A.O_KIND, kind);
            m.w32(BLINK_TIMER, m.s32(BLINK));
          }
        }
        return;
      }
      case 5: {
        // FUN_80097174: the next stop, or on when there is none.
        const i = m.add32(SCROLL_STOP, 1);
        this.scroll();
        m.add32(SCENE, m.s32(SCROLL_STOPS + 4 * i) === -1 ? 1 : -2);
        return;
      }
      case 6:
        // FUN_800971E0 (object 11 is never set up: its level goes below 0 at once).
        this.scroll();
        if (this.fadeDown(11)) {
          objectClear(this, 6);
          objectClear(this, 5);
          objectClear(this, 10);
          m.w32(SCENE_TIMER, 0x9a);
          m.add32(SCENE, 1);
        }
        return;
      case 7: {
        // FUN_80097250: the text is cleared at 0x5A; then the next picture (5, 6).
        const t = m.add32(SCENE_TIMER, -1);
        if (t === 0x5a) this.clearGlyphs();
        if (m.s32(SCENE_TIMER) < 1) {
          m.w32(SCENE_TIMER, 0x200);
          m.w32(obj(5) + A.O_IMAGE, 0x10008);
          m.w32(obj(5) + A.O_X, 0);
          m.w32(obj(5) + A.O_Y, 0x200000);
          m.w32(obj(6) + A.O_IMAGE, 0x10009);
          m.w32(obj(6) + A.O_X, 0xa00000);
          m.w32(obj(6) + A.O_Y, 0x200000);
          m.add32(SCENE, 1);
        }
        return;
      }
      case 8:
        // FUN_800972DC
        if (m.add32(SCENE_TIMER, -1) < 0) {
          m.w32(obj(5) + A.O_IMAGE, 0x1000a);
          m.w32(obj(6) + A.O_IMAGE, 0x1000b);
          this.clearGlyphs();
          m.w32(SCENE_TIMER, 0x140);
          m.add32(SCENE, 1);
        }
        return;
      case 9:
        // FUN_80097338: a white-out box (7) over the whole screen.
        if (m.add32(SCENE_TIMER, -1) < 0) {
          this.clearGlyphs();
          m.w32(obj(7) + A.O_KIND, -2);
          m.w32(obj(7) + A.O_IMAGE, 0x10000);
          m.w32(obj(7) + O_LEVEL, 0x40);
          m.w32(obj(7) + O_W, 0x140);
          m.w32(obj(7) + A.O_X, 0);
          m.w32(obj(7) + A.O_Y, 0);
          m.w32(obj(7) + O_H, 0xf0);
          m.add32(SCENE, 1);
        }
        return;
      case 10:
        // FUN_800973AC: fades on odd frames.
        if ((m.u32(A.COUNTER) & 1) !== 0 && this.fadeDown(7)) m.add32(SCENE, 1);
        return;
      case 11:
        // FUN_800973FC: the end of the story.
        m.w32(SCENE, 0);
        m.add32(A.PHASE, 1);
        return;
      default:
        return; // 12, 13: stubs
    }
  }

  /** FUN_80097428: the text machine on gp+0x4C (table 0x80094070). */
  private text(): void {
    const m = this.m;
    const page = PAGES + m.s32(PAGE) * 0x18;
    switch (m.s32(TEXT)) {
      case 0:
        // FUN_800974A8: the page's settings.
        m.w32(WRITER, 0);
        m.add32(TEXT, 1);
        m.w32(SCRIPT, m.s32(page));
        m.w32(ORIGIN, m.s32(page + 4));
        m.w32(SCRIPTS_LEFT, m.s32(page + 8));
        m.w32(CHAR_DELAY, m.s32(page + 0xc));
        m.w32(SCRIPT_HOLD, m.s32(page + 0x10));
        return;
      case 1:
        // FUN_80097534
        if (this.writer()) {
          m.w32(PAGE_HOLD, m.s32(page + 0x14));
          m.add32(TEXT, 1);
        }
        return;
      case 2:
        // FUN_80097590: the page stays, then the next (3 pages).
        if (m.add32(PAGE_HOLD, -1) < 0) {
          m.add32(TEXT, m.add32(PAGE, 1) === 3 ? 1 : -2);
        }
        return;
      default:
        return; // 3-12: stubs
    }
  }

  /** FUN_80097758: the typewriter on gp+0x7C (table 0x800940A4); true when the page is written. */
  private writer(): boolean {
    const m = this.m;
    switch (m.s32(WRITER)) {
      case 0: {
        // FUN_800977B8: a new script from the page's origin.
        this.clearGlyphs();
        m.w32(CHAR, 0);
        m.w32(GLYPH, 0);
        m.w32(DELAY, m.s32(CHAR_DELAY));
        m.add32(WRITER, 1);
        const o = ORIGINS + m.s32(ORIGIN) * 8;
        m.w32(PEN_X, m.s32(o));
        m.w32(PEN_Y, m.s32(o + 4));
        return false;
      }
      case 1:
        return this.type();
      case 2:
        // FUN_80097A94: the finished script stays, then the next.
        if (m.add32(DELAY, -1) === 0) {
          m.w32(WRITER, 0);
          m.add32(SCRIPT, 1);
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * FUN_80097840: one code of the script every CHAR_DELAY frames. -1 ends the script (true when
   * it was the page's last), -2 starts a new line (12 px down), 0xF0000000 is a space (9 px, and
   * the next code comes at once); others are glyphs: the high nibble picks the set (0x800AF838),
   * the rest the image; nibble 5 is a wide glyph in two objects (the second code follows it).
   */
  private type(): boolean {
    const m = this.m;
    if (m.add32(DELAY, -1) > 0) return false;
    m.w32(DELAY, m.s32(CHAR_DELAY));
    const script = m.u32(SCRIPT_TABLE + 4 * m.s32(SCRIPT));
    let at = m.s32(CHAR);
    let code = m.u32(script + 4 * at);
    if (code === 0xffffffff) {
      if (m.add32(SCRIPTS_LEFT, -1) <= 0) return true;
      m.add32(WRITER, 1);
      m.w32(DELAY, m.s32(SCRIPT_HOLD));
      return false;
    }
    if (code === 0xfffffffe) {
      m.w32(CHAR, at + 1);
      m.add32(PEN_Y, 0xc0000);
      m.w32(PEN_X, m.s32(ORIGINS + m.s32(ORIGIN) * 8));
      return false;
    }
    if (code === 0xf0000000) {
      m.w32(CHAR, at + 1);
      m.w32(DELAY, 0);
      m.add32(PEN_X, 0x90000);
      return false;
    }
    let dx = 0;
    if ((code & 0xf0000000) === 0x50000000) {
      // The wide glyph's left half.
      dx = -0x20000;
      const n = m.s32(GLYPH);
      const o = obj(100 + n);
      at++;
      m.w32(CHAR, at);
      m.w32(o + A.O_IMAGE, ((code & 0x0fffffff) + m.s32(GLYPH_SETS + 0x14) + 0x10000) | 0);
      m.w32(o + A.O_Y, m.s32(PEN_Y));
      m.w32(o + O_SHAKE_AMP, m.s32(AMPLITUDE));
      m.w32(o + A.O_X, m.s32(PEN_X) - 0x20000);
      m.w32(o + O_SHAKE, 2);
      m.add32(PEN_X, 0xc0000);
      m.w32(GLYPH, n + 1);
      code = m.u32(script + 4 * at);
    }
    const set = (code & 0xf0000000) >>> 0;
    const o = obj(100 + m.s32(GLYPH));
    m.w32(o + O_SHAKE_AMP, m.s32(AMPLITUDE));
    m.w32(o + A.O_IMAGE, ((code & 0x0fffffff) + m.s32(GLYPH_SETS + (set >>> 26)) + 0x10000) | 0);
    m.w32(o + A.O_X, dx + m.s32(PEN_X));
    m.w32(o + O_SHAKE, 2);
    m.w32(o + A.O_Y, m.s32(PEN_Y));
    m.add32(PEN_X, set === 0x50000000 ? 0xe0000 : 0x90000);
    m.add32(CHAR, 1);
    m.add32(GLYPH, 1);
    return false;
  }

  /** FUN_80096854 (the draw), for what it does to game state: a kind -1 box takes three rand() calls. */
  private draw(): void {
    const m = this.m;
    for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
      const o = obj(n);
      if (m.s32(o + A.O_IMAGE) === 0) continue;
      if (m.s32(o + A.O_KIND) === -1) this.boxColors.push(this.rand() & 7, this.rand() & 7, this.rand() & 7);
    }
  }
}
