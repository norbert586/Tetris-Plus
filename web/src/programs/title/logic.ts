// TITLE.EXE (program 3): the title screen (docs/re/title.md §3). state+0x4C ("param") picks the
// top-level routine: 0 set-up, 1 the title (its phases in state+0x50, steps in state+0x54),
// 2 the attract timeout (names HOW_N or HOW_VS by turns), 3 leave for SELECT, 4 an unused image
// viewer. Phases 0-8 animate the logo (blocks falling into TETRIS, the PLUS letters, the
// professor), phase 9 is the finished title with PRESS START, which times out after 1,801
// ticks. START in phases 0-8 jumps to phase 9; START in phase 9 plays effect 0 and leaves for
// SELECT. State lives at the original's addresses.
import type { Shared } from '../../flow/program';
import type { Box } from '../../render/libgs';
import { obj, ModeProgram, S, type Layout } from './common';
import { ROM } from './rom';

const TIMER = 0x800b4318; // the current step's tick counter
const PLAYER = 0x800b4328;
const ITEMS = 0x800adc9c; // offset of each packed item in TITLEE.BIN (loaded at 0x800F4000)
const ANIMS = 0x800ae100; // pointer per animation: { ticks per frame, frames..., 0xFFFF end / 0xFFFE loop }
const DROP_START = [0x800ad844, 0x800ad84c, 0x800ad858]; // per round: the tick each block's dust starts
const LETTERS = [0x8009407c, 0x800940b4, 0x800940ec]; // 14 each: image, x, y of the PLUS letters

export const LAYOUT: Layout = {
  name: 'TITLE',
  rom: ROM,
  bss: [0x800b425c, 0x800b7078],
  pad: 0x800b7066,
  activeBuff: 0x800b4314,
  fields: [
    ['pad', 0x800b7066, 'u16'],
    ['padp', 0x800b7068, 'u16'],
    ['pad2', 0x800b706c, 'u16'],
    ['padp2', 0x800b706e, 'u16'],
    ['timer', TIMER, 's32'],
    ['attract', S + 0x4b540, 's32'],
    ['twop', S + 0x4b53c, 's32'],
    ['oimg', S + 0x5c + 0x24, 's32', 72, 0x7c],
    ['ox', S + 0x5c, 's32', 72, 0x7c],
    ['oy', S + 0x5c + 0x04, 's32', 72, 0x7c],
    ['oimg100', S + 0x5c + 100 * 0x7c + 0x24, 's32'],
    ['bgmcur', 0x800b4294, 's32', 4],
  ],
  seVolume: 0x800ad878,
  seTable: 0x800ad888,
  bgm: {
    volume: 0x800ad868,
    track: 0x800ada18,
    zoneTracks: 0x800adc88,
    zone: 0x800b4334,
    player: PLAYER,
    state: 0x800b4294,
    join: 0x800b42a4,
  },
};

// Object fields (offsets within an object)
const X = 0x00;
const Y = 0x04;
const IMAGE = 0x24;
const ANIM = 0x2c;
const ANIM_TIMER = 0x30;
const ANIM_FRAME = 0x34;
const VX = 0x38;
const VY = 0x3c;
const FLIP = 0x44;
const SAVED = 0x4c;

export class Title extends ModeProgram {
  /** GsSortBoxFill calls made by the logic this tick (sorted before the objects). */
  boxes: { box: Box; pri: number }[] = [];
  /** The trace's `up`: the packed address of every item the decompressor unpacked this tick. */
  unpacked: number[] = [];

  constructor(shared: Shared) {
    super(shared, LAYOUT);
  }

  override step(pad: number): void {
    this.boxes = [];
    this.unpacked = [];
    super.step(pad);
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
  private og(n: number, f: number): number {
    return this.m.s32(obj(n) + f);
  }
  private os(n: number, f: number, v: number): void {
    this.m.w32(obj(n) + f, v);
  }
  private get timer(): number {
    return this.g(TIMER);
  }
  private odd(): boolean {
    return (this.m.u32(S + 0x40) & 1) !== 0;
  }

  protected startup(): void {
    const m = this.m;
    // FUN_80095B18
    m.w32(S + 0x4b53c, 0);
    // sound_init (FUN_80095518)
    m.w32(0x800b4294, 0);
    m.w32(0x800b4298, 0x34);
    m.w32(0x800b429c, 0x34);
    m.w32(0x800b42a0, 0x34);
    const vol = m.s16(LAYOUT.bgm.volume + 2 * m.u8(S + 0x4b4ff));
    this.sound.push({ kind: 'cdvol', vol });
    // FUN_80095D14: every item is unpacked once and uploaded (the renderer does the upload).
    for (let i = 0; i < 0x8f; i++) this.unpacked.push(0x800f4000 + m.s32(ITEMS + 4 * i));
    m.w32(S + 0x1fcf4, 0);
  }

  /** Unpacks item n and uploads it to its own VRAM position (FUN_80096314 + FUN_80095E28). */
  private upload(item: number): void {
    this.unpacked.push((0x800f4000 + this.g(ITEMS + 4 * item)) >>> 0);
    this.uploads.push(item);
  }

  protected logic(): void {
    switch (this.g(S + 0x4c)) {
      case 0:
        this.setup();
        return;
      case 1:
        this.title();
        return;
      case 2:
        this.attract();
        return;
      case 3:
        // FUN_80097378
        this.exitTo(8, 0, 0);
        return;
      case 4:
        this.viewer();
        return;
      default:
        return;
    }
  }

  private clearAll(): void {
    for (let n = 0; n < 0x41a; n++) this.objectClear(n);
  }

  /** Sets object n's animation `anim` going from its first frame (no upload). */
  private animStart(n: number, anim: number): void {
    const t = this.g(ANIMS + 4 * anim);
    this.os(n, ANIM, anim);
    this.os(n, IMAGE, this.g(t + 4) + 0x10000);
    this.os(n, ANIM_TIMER, this.g(t));
    this.os(n, ANIM_FRAME, 0);
  }

  /** FUN_800971A8 */
  private setup(): void {
    this.clearAll();
    const param = this.g(S + 0x4c);
    this.s(S + 0x4b53c, 0);
    this.os(100, ANIM, 3);
    this.s(S + 0x4c, param + 1);
    this.s(PLAYER, 0);
    this.s(0x800b4320, 0);
    const t = this.g(ANIMS + 12);
    this.os(100, IMAGE, this.g(t + 4) + 0x10000);
    this.os(100, X, 0x6b0000);
    this.os(100, ANIM_FRAME, 0);
    this.os(100, Y, 0x800000);
    this.os(100, ANIM_TIMER, this.g(t));
  }

  /** FUN_80097244 */
  private title(): void {
    this.animStep(100);
    if ((this.pressed() & 0x800) === 0) {
      this.phase();
    } else if (this.g(S + 0x50) === 9) {
      this.sePlay(0);
      this.s(S + 0x4c, 3);
    } else {
      this.s(S + 0x50, 9);
      this.s(S + 0x54, 0);
    }
  }

  /** FUN_800972C0: the attract timeout names HOW_N and HOW_VS by turns (state+0x4B540). */
  private attract(): void {
    this.clearAll();
    this.s(S + 0x1fcf4, 1);
    const turn = this.g(S + 0x4b540) & 1;
    if (turn === 0) {
      this.s(S + 0x48, 4);
      this.s(S + 0x4b540, 1);
    } else {
      this.s(S + 0x48, 6);
      this.s(S + 0x4b540, 0);
    }
    this.s(S + 0x4c, 0);
    this.s(S + 0x50, 0);
    this.s(S + 0x54, 0);
  }

  /** FUN_800973A4: steps objects 0 and 1 through the images with the d-pad (never reached). */
  private viewer(): void {
    const held1 = this.held();
    const p1 = this.pressed();
    const held2 = this.m.u16(LAYOUT.pad + 6);
    const p2 = this.m.u16(LAYOUT.pad + 8);
    const a0 = obj(0) + IMAGE;
    const a1 = obj(1) + IMAGE;
    if (p1 & 0x8000 || held1 & 4) if (this.inc(a0, -1) < 0x10001) this.s(a0, 0x10001);
    if (p1 & 0x2000 || held1 & 8) if (this.inc(a0) > 0x1008f) this.s(a0, 0x1008f);
    if (p2 & 0x8000 || held2 & 4) if (this.inc(a1, -1) < 0x10001) this.s(a1, 0x10001);
    if (p2 & 0x2000 || held2 & 8) if (this.inc(a1) > 0x1008f) this.s(a1, 0x1008f);
  }

  // ---- object helpers (FUN_80096xxx) ----

  /** FUN_80096C28 */
  private velocity(n: number, vx: number, vy: number): void {
    this.os(n, VX, vx << 16);
    this.os(n, VY, vy << 16);
  }
  /** FUN_80096B3C */
  private move(n: number): void {
    this.os(n, X, this.og(n, X) + this.og(n, VX));
    this.os(n, Y, this.og(n, Y) + this.og(n, VY));
    this.os(n, 0x08, this.og(n, 0x08) + this.og(n, 0x50));
    this.os(n, 0x0c, this.og(n, 0x0c) + this.og(n, 0x54));
  }
  private moveRange(first: number, count: number): void {
    for (let i = 0; i < count; i++) this.move(first + i);
  }
  private clearRange(first: number, count: number): void {
    for (let i = 0; i < count; i++) this.objectClear(first + i);
  }
  private place(n: number, image: number, x: number, y: number): void {
    this.os(n, IMAGE, image);
    this.os(n, X, x);
    this.os(n, Y, y);
  }

  /**
   * FUN_80096E98 (and FUN_80096F4C with `upload`: the new frame's image is unpacked and
   * uploaded): the animation's next frame when its timer runs out.
   */
  private animStep(n: number, upload = false): void {
    const anim = this.og(n, ANIM);
    if (anim === 0) return;
    const t = this.g(ANIMS + 4 * anim);
    const left = this.og(n, ANIM_TIMER) - 1;
    this.os(n, ANIM_TIMER, left);
    if (left >= 1) return;
    const f = this.og(n, ANIM_FRAME);
    this.os(n, ANIM_FRAME, f + 1);
    const next = this.g(t + 4 * (f + 2));
    if (next === 0xffff) {
      this.os(n, ANIM, 0);
      return;
    }
    if (next === 0xfffe) this.os(n, ANIM_FRAME, 0);
    this.os(n, ANIM_TIMER, this.g(t));
    const value = this.g(t + 4 * (this.og(n, ANIM_FRAME) + 1));
    this.os(n, IMAGE, value + 0x10000);
    if (upload) this.upload(value - 1);
  }

  /** FUN_80096DC8: starts object n's animation (already set) and uploads its first frame. */
  private animStartUpload(n: number): void {
    const anim = this.og(n, ANIM);
    if (anim === 0) return;
    const t = this.g(ANIMS + 4 * anim);
    const value = this.g(t + 4);
    this.os(n, IMAGE, value + 0x10000);
    this.upload(value - 1);
    this.os(n, ANIM_TIMER, this.g(t));
    this.os(n, ANIM_FRAME, 0);
  }

  private nextStep(): void {
    this.inc(S + 0x54);
  }
  private nextPhase(): void {
    this.s(TIMER, 0);
    this.s(S + 0x54, 0);
    this.inc(S + 0x50);
  }

  /** A full-screen additive white box at priority 0, level c (FUN_80099098 and on). */
  private flash(c: number): void {
    this.boxes.push({ box: { attribute: 0x50000000, x: -0xb4, y: -0x78, w: 0x168, h: 0xf0, r: c, g: c, b: c }, pri: 0 });
  }

  // ---- the phases (table 0x80094014) ----

  private phase(): void {
    const sub = this.g(S + 0x54);
    switch (this.g(S + 0x50)) {
      case 0:
        // FUN_800975A0: the title music.
        this.s(PLAYER, 0);
        this.s(S + 0x4b53c, 0);
        this.bgmRequest(0x22);
        this.s(TIMER, 0);
        this.inc(S + 0x50);
        return;
      case 1:
        return this.phase1(sub);
      case 2:
        return this.phase2(sub);
      case 3:
        return this.dropRound(sub, 0);
      case 4:
        return this.phase4(sub);
      case 5:
        return this.dropRound(sub, 1);
      case 6:
        return this.phase6(sub);
      case 7:
        return this.phase7(sub);
      case 8:
        return this.phase8(sub);
      case 9:
        return this.phase9(sub);
      default:
        return;
    }
  }

  /** Phase 1 (0x8009403C): the four TETRIS blocks slide in from the right. */
  private phase1(sub: number): void {
    switch (sub) {
      case 0:
        // FUN_80097648
        this.place(22, 0x1000c, 0, 0x50000);
        this.velocity(22, -1, 0);
        this.place(23, 0x1000d, 0xa00000, 0x50000);
        this.velocity(23, -1, 0);
        this.place(24, 0x1000e, 0x1400000, 0x50000);
        this.velocity(24, -1, 0);
        this.place(25, 0x1000f, 0x1e00000, 0x50000);
        this.velocity(25, -1, 0);
        this.nextStep();
        return;
      case 1:
        // FUN_80097730
        if (this.timer < 0x1e) {
          if (this.odd()) this.moveRange(22, 4);
          this.inc(TIMER);
        } else this.nextStep();
        return;
      case 2:
        // FUN_800977BC
        this.nextPhase();
        return;
    }
  }

  /** Hides the TETRIS blocks (22-25), keeping their images at +0x4C. */
  private hideBlocks(): void {
    const imgs = [22, 23, 24, 25].map((n) => this.og(n, IMAGE));
    imgs.forEach((v, i) => {
      this.os(22 + i, IMAGE, 0);
      this.os(22 + i, SAVED, v);
    });
  }
  /** Shows them again. */
  private showBlocks(): void {
    for (let n = 22; n < 26; n++) this.os(n, IMAGE, this.og(n, SAVED));
  }

  /** Phase 2 (0x800B422C): a scene with the professor walking right. */
  private phase2(sub: number): void {
    if (sub === 0) {
      // FUN_80097828
      this.hideBlocks();
      this.place(18, 0x10017, 0xa00000, 0x50000);
      this.velocity(18, -1, 0);
      this.upload(this.og(18, IMAGE) - 0x10001);
      this.place(20, 0x1001b, 0x1b0000, 0x400000);
      this.velocity(20, 1, 0);
      this.place(21, 0x10015, 0x1b0000, 0x800000);
      this.velocity(21, 1, 0);
      this.nextStep();
    } else if (sub === 1) {
      // FUN_80097974
      if (this.timer < 0x6e) {
        this.move(18);
        this.move(20);
        this.move(21);
        this.inc(TIMER);
      } else this.nextPhase();
    }
  }

  /** Phase 4 (0x800B423C): the professor walking left. */
  private phase4(sub: number): void {
    if (sub === 0) {
      // FUN_80097E54
      this.clearRange(0x1a, 4);
      this.clearRange(0x1e, 0x24);
      this.hideBlocks();
      this.objectClear(0x42);
      this.place(18, 0x10018, 0, 0x50000);
      this.velocity(18, 1, 0);
      this.upload(this.og(18, IMAGE) - 0x10001);
      this.place(20, 0x1001c, 0x870000, 0x400000);
      this.velocity(20, -1, 0);
      this.place(21, 0x10015, 0x870000, 0x800000);
      this.velocity(21, -1, 0);
      this.nextStep();
    } else if (sub === 1) {
      // FUN_80097FDC
      if (this.timer < 0x69) {
        this.move(18);
        this.move(20);
        this.move(21);
        this.inc(TIMER);
      } else this.nextPhase();
    }
  }

  /** Phase 6 (0x800B424C) */
  private phase6(sub: number): void {
    if (sub === 0) {
      // FUN_800984BC
      this.clearRange(0x1a, 4);
      this.clearRange(0x1e, 0x24);
      this.hideBlocks();
      this.clearRange(0x42, 3);
      this.place(18, 0x10019, 0, 0x70000);
      this.velocity(18, 0, 1);
      this.place(19, 0x1001a, 0xa00000, 0x70000);
      this.velocity(19, 0, 1);
      this.place(20, 0x1001d, 0, 0x420000);
      this.velocity(20, 0, -1);
      this.place(21, 0x1001e, 0xa00000, 0x420000);
      this.velocity(21, 0, -1);
      this.nextStep();
    } else if (sub === 1) {
      // FUN_80098630
      if (this.timer < 0x5a) {
        if (this.odd()) {
          this.move(18);
          this.move(19);
          this.move(20);
          this.move(21);
        }
        this.inc(TIMER);
      } else this.nextPhase();
    }
  }

  /**
   * Set-up of a block drop (FUN_80097A2C, FUN_80098094, FUN_80098734; round 0, 1, 2): `count`
   * falling blocks (26-), two columns of rubble rows (30-) and their dust clouds (66-).
   */
  private dropSetup(round: number): void {
    const count = [2, 3, 4][round];
    const rows = [2, 4, 5][round];
    const y0 = [0xb80000, 0x6c0000, 0x230000][round];
    if (round === 2) this.clearRange(0x12, 4);
    else {
      this.objectClear(0x12);
      this.objectClear(0x14);
      this.objectClear(0x15);
    }
    this.showBlocks();
    let yb = [1, 0x4c, 0x97][round];
    for (let i = 0; i < count; i++) {
      const n = 0x1a + i;
      this.place(n, 0x1001f, 0x810000, yb << 16);
      this.velocity(n, 0, 1);
      yb -= 0x30;
    }
    let k = 0;
    for (const [cols, x0] of [
      [3, -0xf0000],
      [4, 0xb10000],
    ]) {
      let x = x0;
      for (let c = 0; c < cols; c++) {
        let y = y0;
        for (let r = 0; r < rows; r++) {
          const n = 0x1e + k++;
          this.place(n, 0x10023, x, y);
          this.velocity(n, 0, -1);
          y += 0x300000;
        }
        x += 0x300000;
      }
    }
    if (round === 2) {
      // One more rubble block above the middle (object 0x1E + 35).
      const n = 0x1e + k;
      this.os(n, X, 0x810000);
      this.os(n, IMAGE, 0x10023);
      this.os(n, Y, 0xe30000);
      this.velocity(n, 0, -1);
    }
    for (let i = 0; i < count; i++) this.animStart(0x42 + i, 1);
    this.nextStep();
  }

  /** The dust clouds follow their blocks once their start tick has come (FUN_80097C78 and others). */
  private dust(round: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.g(DROP_START[round] + 4 * i) <= this.timer) {
        const n = 0x42 + i;
        this.os(n, X, this.og(0x1a + i, X));
        this.os(n, Y, this.og(0x1a + i, Y));
        this.animStep(n);
        if (this.og(n, ANIM_FRAME) === 5) this.os(n, FLIP, 3);
        if (this.og(n, ANIM_FRAME) === 7) this.os(n, FLIP, 0);
      }
    }
  }

  /** Phases 3 and 5 (0x800B4234, 0x800B4244): blocks drop into the logo. */
  private dropRound(sub: number, round: number): void {
    if (sub === 0) {
      this.dropSetup(round);
      return;
    }
    if (sub !== 1) return;
    // FUN_80097C78 / FUN_800982E0
    if (this.timer < [0x3c, 0x37][round]) {
      if (this.odd()) {
        this.moveRange(0x1a, 4);
        this.moveRange(0x1e, 0x24);
        this.moveRange(22, 4);
      }
      this.dust(round, round + 2);
      this.inc(TIMER);
    } else this.nextPhase();
  }

  /** Phase 7 (0x80094048): the last drop, then the TETRIS letters' animation. */
  private phase7(sub: number): void {
    switch (sub) {
      case 0:
        this.dropSetup(2);
        return;
      case 1:
        // FUN_800989CC
        if (this.timer < 0x1c) {
          if (this.odd()) {
            this.moveRange(0x1a, 4);
            this.moveRange(0x1e, 0x24);
          }
          this.inc(TIMER);
        } else {
          this.s(TIMER, 0);
          this.nextStep();
        }
        return;
      case 2:
        // FUN_80098A78
        if (this.og(0x42, ANIM) === 0) {
          this.s(TIMER, 0);
          this.nextStep();
        } else {
          this.dust(2, 4);
          this.inc(TIMER);
        }
        return;
      case 3:
        // FUN_80098B90
        this.clearRange(0x42, 4);
        this.clearRange(22, 4);
        this.nextStep();
        return;
      case 4:
        // FUN_80098C04
        this.clearRange(0x1a, 4);
        this.clearRange(0x1e, 0x24);
        this.os(10, Y, 0x50000);
        this.os(11, Y, 0x50000);
        this.os(10, IMAGE, 0x1004f);
        this.os(10, X, 0);
        this.os(11, IMAGE, 0x1004f);
        this.os(11, X, 0xa00000);
        this.os(22, ANIM, 8);
        this.animStartUpload(22);
        this.os(22, X, 0);
        this.os(22, Y, 0);
        this.os(23, ANIM, 9);
        this.animStartUpload(23);
        this.os(23, X, 0xa00000);
        this.os(23, Y, 0);
        this.nextStep();
        return;
      case 5:
        // FUN_80098CCC
        if (this.og(22, ANIM) === 0) {
          this.objectClear(22);
          this.objectClear(23);
          this.s(TIMER, 0);
          this.place(12, 0x10056, 0x1b0000, 0x250000);
          this.s(S + 0x54, 0);
          this.inc(S + 0x50);
        } else {
          this.animStep(22, true);
          this.animStep(23, true);
          this.inc(TIMER);
        }
        return;
    }
  }

  /** Phase 8 (0x80094060): PLUS, the professor's bow, a white flash. */
  private phase8(sub: number): void {
    switch (sub) {
      case 0:
        // FUN_80098DE0
        this.sePlay(0x19);
        this.nextStep();
        return;
      case 1: {
        // FUN_80098E18: one letter a tick, each replacing the one before.
        const i = this.timer;
        if (i < 0xe) {
          const n = i + 0x42;
          this.os(n, X, this.g(LETTERS[1] + 4 * i) << 16);
          this.os(n, IMAGE, this.g(LETTERS[0] + 4 * i) + 0x10000);
          this.os(n, Y, this.g(LETTERS[2] + 4 * i) << 16);
          this.objectClear(i + 0x41);
          this.inc(TIMER);
        } else {
          this.nextStep();
          this.objectClear(i + 0x41);
          this.s(TIMER, 0);
        }
        return;
      }
      case 2:
        // FUN_80098FB0
        this.animStart(13, 6);
        this.os(13, X, 0);
        this.os(13, Y, 0x5f0000);
        this.animStart(14, 7);
        this.os(14, X, 0xa00000);
        this.os(14, Y, 0x5f0000);
        this.nextStep();
        return;
      case 3:
        // FUN_80099038
        if (this.og(13, ANIM) === 0) {
          this.s(TIMER, 0);
          this.nextStep();
        } else {
          this.animStep(13);
          this.animStep(14);
          this.inc(TIMER);
        }
        return;
      case 4:
        // FUN_80099098
        this.os(13, IMAGE, 0x10051);
        this.os(14, X, 0xa00000);
        this.os(13, X, 0);
        this.os(13, Y, 0x5f0000);
        this.os(14, IMAGE, 0x10052);
        this.os(14, Y, 0x5f0000);
        this.flash(0xff);
        this.nextStep();
        return;
      case 5: {
        // FUN_8009915C
        this.flash(0xff);
        const done = this.timer > 4;
        this.inc(TIMER);
        if (done) {
          this.s(TIMER, 0);
          this.nextStep();
        }
        return;
      }
      case 6: {
        // FUN_80099208: the flash fades over 30 ticks.
        this.flash(Math.trunc(((0x1e - this.timer) * 0xff) / 0x1e) & 0xff);
        const done = this.timer > 0x1d;
        this.inc(TIMER);
        if (done) this.nextPhase();
        return;
      }
    }
  }

  /** Phase 9 (0x800B4254): the finished title screen, then the attract timeout. */
  private phase9(sub: number): void {
    if (sub === 0) {
      // FUN_80099340
      this.clearAll();
      this.os(10, Y, 0x50000);
      this.os(11, Y, 0x50000);
      this.os(10, IMAGE, 0x1004f);
      this.os(11, IMAGE, 0x1004f);
      this.os(12, X, 0x1b0000);
      this.os(13, Y, 0x5f0000);
      this.os(14, Y, 0x5f0000);
      this.os(17, Y, 0xa30000);
      this.os(15, X, 0x11c0000);
      this.os(15, Y, 0x7b0000);
      this.os(10, X, 0);
      this.os(11, X, 0xa00000);
      this.os(12, IMAGE, 0x10054);
      this.os(12, Y, 0x250000);
      this.os(13, IMAGE, 0x10051);
      this.os(13, X, 0);
      this.os(14, IMAGE, 0x10052);
      this.os(14, X, 0xa00000);
      this.os(17, IMAGE, 0x10050);
      this.os(17, X, 0x250000);
      this.os(15, IMAGE, 0x10055);
      this.animStart(100, 3);
      this.os(100, X, 0x6b0000);
      this.os(100, Y, 0x800000);
      this.s(TIMER, 0);
      this.nextStep();
    } else if (sub === 1) {
      // FUN_80099470
      const done = this.timer > 0x707;
      this.inc(TIMER);
      if (done) {
        this.s(TIMER, 0);
        this.s(S + 0x50, 0);
        this.s(S + 0x54, 0);
        this.inc(S + 0x4c);
      }
    }
  }

  override traceRow(): Record<string, number | number[]> {
    const row = super.traceRow();
    row.up = this.unpacked.slice();
    return row;
  }
}
