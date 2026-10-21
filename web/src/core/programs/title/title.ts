// TITLE.EXE: the title screen and its logo animation (docs/re/shell.md §7). A top machine on
// state+0x4C (init, run, the two exits) and, while it runs, the animation machine on state+0x50
// (ten phases with sub-steps on +0x54) that builds the logo in steps and ends on "press start".
// Start skips the animation (phase 9) or, at phase 9, starts SELECT; 1,800 frames at phase 9
// start the attract demo (HOW_N and HOW_VS in turn). No soft reset. Ported from the decompile
// of TITLE.EXE (main 0x80095704).
import * as A from '../../addr';
import { objectClear, objectsClearAll } from '../../objects';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800b7078;
const PAD = 0x800b7066; // P1 held; pressed +2; P2 +6
const COUNT = 0x800b4318; // gp+0xFC: the animation steps' frame counter
const SIDE = 0x800b4328; // gp+0x10C: se_play/bgm_request's two-player side (always 0 here)
const SIDE_B = 0x800b4320; // gp+0x104
const ZONE_SIDES = 0x800b4334; // gp+0x118 [2]: bgm_request's per-side zone
const ATTRACT = A.S + 0x4b540; // bit 0: the next attract demo is HOW_VS

// Tables in TITLE.EXE's data.
const ANIMS = 0x800ae100; // animation records: frame time, then items (0xFFFF stop, 0xFFFE loop)
const SPARKLE_DELAY_3 = 0x800ad844; // [2] the frame each sparkle of phase 3 starts on
const SPARKLE_DELAY_5 = 0x800ad84c; // [3] phase 5
const SPARKLE_DELAY_7 = 0x800ad858; // [4] phase 7
const LETTER_IMAGE = 0x8009407c; // [14] phase 8's letters: items
const LETTER_X = 0x800940b4; // [14] x
const LETTER_Y = 0x800940ec; // [14] y

/** Object field +0x54: the scale-y velocity FUN_80096B3C adds (+0x50 the scale-x one). */
const O_54 = 0x54;

const FIELDS: Field[] = [...commonFields(PAD)];

const obj = A.obj;

export class Title extends Program {
  readonly name = 'TITLE';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    const m = this.m;
    // main before its loop: FUN_80095B18 (the sound sides, the two-player flag), the pad words,
    // the exit flag.
    m.w32(SIDE, 0);
    m.w32(ZONE_SIDES, 0);
    m.w32(ZONE_SIDES + 4, 0);
    m.w32(A.TWO_PLAYER, 0);
    m.fill(0x800b7064, 8 * 6);
    m.w32(A.EXIT_FLAG, 0);
  }

  step(pad: number): void {
    this.beginTick();
    if (this.tick > 0) {
      this.padRead(PAD, pad);
      this.cdWatchdog();
      this.rand();
    }
    this.tick++;
    this.m.add32(A.COUNTER, 1);
    this.logic();
  }

  traceRow() {
    // The tracer has no hook on TITLE's re-uploads (FUN_80095E28 takes a buffer, not an item),
    // so its rows never list them; the renderer still takes them from `uploads`.
    return { ...readFields(this, FIELDS), up: [] };
  }

  /** FUN_8009713C: the top machine on state+0x4C. */
  private logic(): void {
    const m = this.m;
    switch (m.s32(A.NEXT_PARAM)) {
      case 0: {
        // FUN_800971A8: clears the objects; object 100 blinks (animation 3).
        objectsClearAll(this);
        m.w32(A.TWO_PLAYER, 0);
        m.w32(obj(100) + A.O_ANIM, 3);
        m.add32(A.NEXT_PARAM, 1);
        m.w32(SIDE, 0);
        m.w32(SIDE_B, 0);
        this.animFirst(100);
        m.w32(obj(100) + A.O_X, 0x6b0000);
        m.w32(obj(100) + A.O_Y, 0x800000);
        return;
      }
      case 1:
        // FUN_80097244
        this.animTick(100);
        if ((m.u16(PAD + 2) & 0x800) === 0) {
          this.animation();
        } else if (m.s32(A.PHASE) === 9) {
          this.sePlay(0);
          m.w32(A.NEXT_PARAM, 3);
        } else {
          m.w32(A.PHASE, 9);
          m.w32(A.SUBPHASE, 0);
        }
        return;
      case 2: {
        // FUN_800972C0: the attract demo, HOW_N and HOW_VS in turn.
        objectsClearAll(this);
        m.w32(A.EXIT_FLAG, 1);
        const vs = m.u32(ATTRACT) & 1;
        if (vs === 0) {
          m.w32(A.NEXT_PROGRAM, 4);
          m.w32(ATTRACT, 1);
        } else {
          m.w32(A.NEXT_PROGRAM, 6);
          m.w32(ATTRACT, 0);
        }
        m.w32(A.NEXT_PARAM, 0);
        m.w32(A.PHASE, 0);
        m.w32(A.SUBPHASE, 0);
        return;
      }
      case 3:
        // FUN_80097378: on to SELECT.
        this.exitTo(8, 0, 0);
        return;
      case 4:
        this.imageViewer();
        return;
      default:
        return;
    }
  }

  /**
   * FUN_800973A4: a debug viewer (unreachable: only state 3, which exits, comes before it).
   * Left/Right (or L2/R2 held) step objects 0 and 1 through every image, on pads 1 and 2.
   */
  private imageViewer(): void {
    const m = this.m;
    const step = (o: number, pressed: number, held: number) => {
      if ((m.u16(pressed) & 0x8000) !== 0 || (m.u16(held) & 4) !== 0) {
        if (m.add32(o + A.O_IMAGE, -1) < 0x10001) m.w32(o + A.O_IMAGE, 0x10001);
      }
      if ((m.u16(pressed) & 0x2000) !== 0 || (m.u16(held) & 8) !== 0) {
        if (m.add32(o + A.O_IMAGE, 1) > 0x1008f) m.w32(o + A.O_IMAGE, 0x1008f);
      }
    };
    step(obj(0), PAD + 2, PAD);
    step(obj(1), PAD + 8, PAD + 6);
  }

  /** FUN_80097514: the animation machine on state+0x50. */
  private animation(): void {
    const m = this.m;
    const sub = m.s32(A.SUBPHASE);
    switch (m.s32(A.PHASE)) {
      case 0:
        // FUN_800975A0: the title music.
        m.w32(SIDE, 0);
        m.w32(A.TWO_PLAYER, 0);
        this.bgmRequest(0x22);
        m.w32(COUNT, 0);
        m.add32(A.PHASE, 1);
        return;
      case 1:
        // FUN_800975EC (table 0x8009403C)
        if (sub === 0) this.lettersIn();
        else if (sub === 1) this.lettersScroll();
        else if (sub === 2) {
          // FUN_800977BC
          m.w32(COUNT, 0);
          m.w32(A.SUBPHASE, 0);
          m.add32(A.PHASE, 1);
        }
        return;
      case 2:
        // FUN_800977DC (table 0x800B422C)
        if (sub === 0) this.wipeSetup(0x10017, 0xa00000, -1, 0x1001b, 0x1b0000, 1);
        else if (sub === 1) this.wipe(0x6e);
        return;
      case 3:
        // FUN_800979E0 (table 0x800B4234)
        if (sub === 0) this.buildSetup(2, 0x01, 2, 0xb80000);
        else if (sub === 1) this.build(0x3c, 2, SPARKLE_DELAY_3);
        return;
      case 4:
        // FUN_80097E08 (table 0x800B423C)
        if (sub === 0) this.wipeSetup(0x10018, 0, 1, 0x1001c, 0x870000, -1);
        else if (sub === 1) this.wipe(0x69);
        return;
      case 5:
        // FUN_80098048 (table 0x800B4244)
        if (sub === 0) this.buildSetup(3, 0x4c, 4, 0x6c0000);
        else if (sub === 1) this.build(0x37, 3, SPARKLE_DELAY_5);
        return;
      case 6:
        // FUN_80098470 (table 0x800B424C)
        if (sub === 0) this.splitSetup();
        else if (sub === 1) this.split();
        return;
      case 7:
        this.phase7(sub);
        return;
      case 8:
        this.phase8(sub);
        return;
      case 9:
        // FUN_800992F4 (table 0x800B4254)
        if (sub === 0) this.pressStart();
        else if (sub === 1) {
          // FUN_80099470: 1,800 frames, then the attract demo.
          const done = m.s32(COUNT) > 0x707;
          m.add32(COUNT, 1);
          if (done) {
            m.w32(COUNT, 0);
            m.w32(A.PHASE, 0);
            m.w32(A.SUBPHASE, 0);
            m.add32(A.NEXT_PARAM, 1);
          }
        }
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- object helpers

  /** FUN_80096B3C: moves object n by its velocity, and its scale by the scale velocity. */
  private move(n: number): void {
    const m = this.m;
    const o = obj(n);
    m.add32(o + A.O_X, m.s32(o + A.O_VX));
    m.add32(o + A.O_Y, m.s32(o + A.O_VY));
    m.add32(o + A.O_SCALE_X, m.s32(o + A.O_50));
    m.add32(o + A.O_SCALE_Y, m.s32(o + O_54));
  }

  /** FUN_80096C28: object n's velocity in whole pixels. */
  private velocity(n: number, vx: number, vy: number): void {
    this.m.w32(obj(n) + A.O_VX, vx << 16);
    this.m.w32(obj(n) + A.O_VY, vy << 16);
  }

  /** The record of the animation object n plays (table 0x800AE100). */
  private record(n: number): number {
    return this.m.u32(ANIMS + 4 * this.m.s32(obj(n) + A.O_ANIM));
  }

  /** The inline start the setup steps use: the record's first image and frame time. */
  private animFirst(n: number): void {
    const m = this.m;
    const o = obj(n);
    const rec = this.record(n);
    m.w32(o + A.O_IMAGE, m.s32(rec + 4) + 0x10000);
    m.w32(o + A.O_ANIM_FRAME, 0);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
  }

  /** FUN_80095E28 after FUN_80096314: the item decoded and uploaded again. */
  private upload(image: number): void {
    this.uploads.push(image - 0x10001);
  }

  /** FUN_80096DC8: starts object n's animation, uploading its first image. */
  private animStartLoad(n: number): void {
    const m = this.m;
    const o = obj(n);
    if (m.s32(o + A.O_ANIM) === 0) return;
    const rec = this.record(n);
    const image = m.s32(rec + 4) + 0x10000;
    m.w32(o + A.O_IMAGE, image);
    this.upload(image);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    m.w32(o + A.O_ANIM_FRAME, 0);
  }

  /**
   * FUN_80096E98 (and FUN_80096F4C with `load`, which uploads each new image): one frame of
   * object n's animation. When the frame time runs out the next image shows; 0xFFFF ends the
   * animation (the image stays), 0xFFFE starts it over.
   */
  private animTick(n: number, load = false): void {
    const m = this.m;
    const o = obj(n);
    if (m.s32(o + A.O_ANIM) === 0) return;
    const rec = this.record(n);
    if (m.add32(o + A.O_ANIM_TIMER, -1) >= 1) return;
    const frame = m.s32(o + A.O_ANIM_FRAME);
    m.w32(o + A.O_ANIM_FRAME, frame + 1);
    const next = m.u32(rec + 8 + 4 * frame);
    if (next === 0xffff) {
      m.w32(o + A.O_ANIM, 0);
      return;
    }
    if (next === 0xfffe) m.w32(o + A.O_ANIM_FRAME, 0);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    const image = m.s32(rec + 4 + 4 * m.s32(o + A.O_ANIM_FRAME)) + 0x10000;
    m.w32(o + A.O_IMAGE, image);
    if (load) this.upload(image);
  }

  /** Ends the phase: the counter and the sub-step back to 0, the next phase. */
  private nextPhase(): void {
    this.m.w32(COUNT, 0);
    this.m.w32(A.SUBPHASE, 0);
    this.m.add32(A.PHASE, 1);
  }

  /** The four logo letters (objects 22-25) hide: their images kept in field +0x4C. */
  private lettersHide(): void {
    const m = this.m;
    for (let n = 22; n < 26; n++) {
      m.w32(obj(n) + A.O_4C, m.s32(obj(n) + A.O_IMAGE));
      m.w32(obj(n) + A.O_IMAGE, 0);
    }
  }

  /** The four logo letters show again. */
  private lettersShow(): void {
    const m = this.m;
    for (let n = 22; n < 26; n++) m.w32(obj(n) + A.O_IMAGE, m.s32(obj(n) + A.O_4C));
  }

  // ---------------------------------------------------------------- the phases

  /** FUN_80097648: the four logo letters (objects 22-25), 160 px apart, drifting left. */
  private lettersIn(): void {
    const m = this.m;
    for (let i = 0; i < 4; i++) {
      const o = obj(22 + i);
      m.w32(o + A.O_IMAGE, 0x1000c + i);
      m.w32(o + A.O_X, i * 0xa00000);
      m.w32(o + A.O_Y, 0x50000);
      this.velocity(22 + i, -1, 0);
    }
    m.add32(A.SUBPHASE, 1);
  }

  /** FUN_80097730: 30 frames, the letters moving on odd frames. */
  private lettersScroll(): void {
    const m = this.m;
    if (m.s32(COUNT) < 0x1e) {
      if ((m.u32(A.COUNTER) & 1) !== 0) for (let n = 22; n < 26; n++) this.move(n);
      m.add32(COUNT, 1);
    } else {
      m.add32(A.SUBPHASE, 1);
    }
  }

  /**
   * FUN_80097828 (phase 2) / FUN_80097E54 (phase 4): the letters hide; a banner (object 18,
   * image re-uploaded) and two pieces (objects 20, 21) cross the screen.
   */
  private wipeSetup(banner: number, bannerX: number, bannerV: number, piece: number, pieceX: number, pieceV: number): void {
    const m = this.m;
    if (banner === 0x10018) {
      // FUN_80097E54 clears phase 3's objects first.
      for (let n = 0x1a; n < 0x1e; n++) objectClear(this, n);
      for (let n = 0x1e; n < 0x42; n++) objectClear(this, n);
    }
    this.lettersHide();
    if (banner === 0x10018) objectClear(this, 0x42);
    m.w32(obj(18) + A.O_IMAGE, banner);
    m.w32(obj(18) + A.O_X, bannerX);
    m.w32(obj(18) + A.O_Y, 0x50000);
    this.velocity(18, bannerV, 0);
    this.upload(banner);
    m.w32(obj(20) + A.O_IMAGE, piece);
    m.w32(obj(20) + A.O_X, pieceX);
    m.w32(obj(20) + A.O_Y, 0x400000);
    this.velocity(20, pieceV, 0);
    m.w32(obj(21) + A.O_IMAGE, 0x10015);
    m.w32(obj(21) + A.O_X, pieceX);
    m.w32(obj(21) + A.O_Y, 0x800000);
    this.velocity(21, pieceV, 0);
    m.add32(A.SUBPHASE, 1);
  }

  /** FUN_80097974 / FUN_80097FDC: the banner and pieces move every frame for `frames` frames. */
  private wipe(frames: number): void {
    const m = this.m;
    if (m.s32(COUNT) < frames) {
      this.move(18);
      this.move(20);
      this.move(21);
      m.add32(COUNT, 1);
    } else {
      this.nextPhase();
    }
  }

  /**
   * FUN_80097A2C (phase 3) / FUN_80098094 (phase 5) / FUN_80098734 (phase 7): the wipe's objects
   * go, the letters show; `bars` falling bars (objects 26 up, from y = top) and a grid of rising
   * blocks (objects 30 up: 3 columns from x -15, then 4 from x 177, 48 px apart, `rows` rows from
   * y0) build the logo, and a sparkle (objects 66 up, animation 1) follows each bar. Returns the
   * last block's index from 30.
   */
  private buildSetup(bars: number, top: number, rows: number, y0: number): number {
    const m = this.m;
    objectClear(this, 0x12);
    if (bars === 4) objectClear(this, 0x13);
    objectClear(this, 0x14);
    objectClear(this, 0x15);
    this.lettersShow();
    for (let i = 0; i < bars; i++) {
      const o = obj(0x1a + i);
      m.w32(o + A.O_IMAGE, 0x1001f);
      m.w32(o + A.O_X, 0x810000);
      m.w32(o + A.O_Y, (top - 0x30 * i) << 16);
      this.velocity(0x1a + i, 0, 1);
    }
    let k = 0;
    for (const [x0, columns] of [[-0xf0000, 3], [0xb10000, 4]]) {
      for (let c = 0; c < columns; c++) {
        for (let r = 0; r < rows; r++) {
          const o = obj(0x1e + k);
          m.w32(o + A.O_IMAGE, 0x10023);
          m.w32(o + A.O_X, x0 + c * 0x300000);
          m.w32(o + A.O_Y, y0 + r * 0x300000);
          this.velocity(0x1e + k, 0, -1);
          k++;
        }
      }
    }
    if (bars === 4) {
      // FUN_80098734's one more block, under the middle bar.
      const o = obj(0x1e + k);
      m.w32(o + A.O_X, 0x810000);
      m.w32(o + A.O_IMAGE, 0x10023);
      m.w32(o + A.O_Y, 0xe30000);
      this.velocity(0x1e + k, 0, -1);
    }
    for (let i = 0; i < bars; i++) {
      m.w32(obj(0x42 + i) + A.O_ANIM, 1);
      this.animFirst(0x42 + i);
    }
    m.add32(A.SUBPHASE, 1);
    return k;
  }

  /** Bars and blocks move on odd frames (and in phases 3 and 5 the letters too). */
  private buildMove(letters: boolean): void {
    if ((this.m.u32(A.COUNTER) & 1) === 0) return;
    for (let n = 0x1a; n < 0x1e; n++) this.move(n);
    for (let n = 0x1e; n < 0x42; n++) this.move(n);
    if (letters) for (let n = 22; n < 26; n++) this.move(n);
  }

  /** Each sparkle that has started follows its bar and animates (flipped on frames 5-6). */
  private sparkles(count: number, delays: number): void {
    const m = this.m;
    for (let i = 0; i < count; i++) {
      if (m.s32(delays + 4 * i) > m.s32(COUNT)) continue;
      const s = obj(0x42 + i);
      const bar = obj(0x1a + i);
      m.w32(s + A.O_X, m.s32(bar + A.O_X));
      m.w32(s + A.O_Y, m.s32(bar + A.O_Y));
      this.animTick(0x42 + i);
      if (m.s32(s + A.O_ANIM_FRAME) === 5) m.w32(s + A.O_FLIP, 3);
      if (m.s32(s + A.O_ANIM_FRAME) === 7) m.w32(s + A.O_FLIP, 0);
    }
  }

  /** FUN_80097C78 (phase 3) / FUN_800982E0 (phase 5): the build-up for `frames` frames. */
  private build(frames: number, count: number, delays: number): void {
    const m = this.m;
    if (m.s32(COUNT) < frames) {
      this.buildMove(true);
      this.sparkles(count, delays);
      m.add32(COUNT, 1);
    } else {
      this.nextPhase();
    }
  }

  /** FUN_800984BC: the logo splits: four halves (objects 18-21) part up and down. */
  private splitSetup(): void {
    const m = this.m;
    for (let n = 0x1a; n < 0x1e; n++) objectClear(this, n);
    for (let n = 0x1e; n < 0x42; n++) objectClear(this, n);
    this.lettersHide();
    for (let n = 0x42; n < 0x45; n++) objectClear(this, n);
    const halves: [number, number, number, number][] = [
      [0x10019, 0, 0x70000, 1],
      [0x1001a, 0xa00000, 0x70000, 1],
      [0x1001d, 0, 0x420000, -1],
      [0x1001e, 0xa00000, 0x420000, -1],
    ];
    halves.forEach(([image, x, y, v], i) => {
      m.w32(obj(18 + i) + A.O_IMAGE, image);
      m.w32(obj(18 + i) + A.O_X, x);
      m.w32(obj(18 + i) + A.O_Y, y);
      this.velocity(18 + i, 0, v);
    });
    m.add32(A.SUBPHASE, 1);
  }

  /** FUN_80098630: 90 frames, the halves moving on odd frames. */
  private split(): void {
    const m = this.m;
    if (m.s32(COUNT) < 0x5a) {
      if ((m.u32(A.COUNTER) & 1) !== 0) for (let n = 18; n < 22; n++) this.move(n);
      m.add32(COUNT, 1);
    } else {
      this.nextPhase();
    }
  }

  /** FUN_800986C0 (table 0x80094048): the last build-up, then the logo's two halves animate in. */
  private phase7(sub: number): void {
    const m = this.m;
    switch (sub) {
      case 0:
        this.buildSetup(4, 0x97, 5, 0x230000);
        return;
      case 1:
        // FUN_800989CC: 28 frames of bars and blocks.
        if (m.s32(COUNT) < 0x1c) {
          this.buildMove(false);
          m.add32(COUNT, 1);
        } else {
          m.w32(COUNT, 0);
          m.add32(A.SUBPHASE, 1);
        }
        return;
      case 2:
        // FUN_80098A78: the sparkles, until the first one's animation ends.
        if (m.s32(obj(0x42) + A.O_ANIM) === 0) {
          m.w32(COUNT, 0);
          m.add32(A.SUBPHASE, 1);
        } else {
          this.sparkles(4, SPARKLE_DELAY_7);
          m.add32(COUNT, 1);
        }
        return;
      case 3:
        // FUN_80098B90
        for (let n = 0x42; n < 0x46; n++) objectClear(this, n);
        for (let n = 22; n < 26; n++) objectClear(this, n);
        m.add32(A.SUBPHASE, 1);
        return;
      case 4: {
        // FUN_80098C04: the background halves (objects 10, 11) and the logo halves (22, 23,
        // animations 8 and 9, each image uploaded as it shows).
        for (let n = 0x1a; n < 0x1e; n++) objectClear(this, n);
        for (let n = 0x1e; n < 0x42; n++) objectClear(this, n);
        m.w32(obj(10) + A.O_Y, 0x50000);
        m.w32(obj(11) + A.O_Y, 0x50000);
        m.w32(obj(10) + A.O_IMAGE, 0x1004f);
        m.w32(obj(10) + A.O_X, 0);
        m.w32(obj(11) + A.O_IMAGE, 0x1004f);
        m.w32(obj(11) + A.O_X, 0xa00000);
        m.w32(obj(22) + A.O_ANIM, 8);
        this.animStartLoad(22);
        m.w32(obj(22) + A.O_X, 0);
        m.w32(obj(22) + A.O_Y, 0);
        m.w32(obj(23) + A.O_ANIM, 9);
        this.animStartLoad(23);
        m.w32(obj(23) + A.O_X, 0xa00000);
        m.w32(obj(23) + A.O_Y, 0);
        m.add32(A.SUBPHASE, 1);
        return;
      }
      case 5:
        // FUN_80098CCC: until the logo's animation ends; then the subtitle (object 12).
        if (m.s32(obj(22) + A.O_ANIM) === 0) {
          objectClear(this, 22);
          objectClear(this, 23);
          m.w32(COUNT, 0);
          m.w32(obj(12) + A.O_IMAGE, 0x10056);
          m.w32(obj(12) + A.O_X, 0x1b0000);
          m.w32(obj(12) + A.O_Y, 0x250000);
          m.w32(A.SUBPHASE, 0);
          m.add32(A.PHASE, 1);
        } else {
          this.animTick(22, true);
          this.animTick(23, true);
          m.add32(COUNT, 1);
        }
        return;
      default:
        return;
    }
  }

  /** A white additive box over the whole screen at `level` (GsSortBoxFill, attribute 0x50000000). */
  private flash(level: number): void {
    this.boxes.push({ box: { attribute: 0x50000000, x: -0xb4, y: -0x78, w: 0x168, h: 0xf0, r: level, g: level, b: level }, pri: 0 });
  }

  /** FUN_80098D60 (table 0x80094060): the letters drop in one by one, then the flash. */
  private phase8(sub: number): void {
    const m = this.m;
    switch (sub) {
      case 0:
        // FUN_80098DE0
        this.sePlay(0x19);
        m.add32(A.SUBPHASE, 1);
        return;
      case 1: {
        // FUN_80098E18: one letter a frame (objects 66-79), each replacing the one before.
        const c = m.s32(COUNT);
        if (c < 0xe) {
          const o = obj(c + 0x42);
          m.w32(o + A.O_X, m.s32(LETTER_X + 4 * c) << 16);
          m.w32(o + A.O_IMAGE, m.s32(LETTER_IMAGE + 4 * c) + 0x10000);
          m.w32(o + A.O_Y, m.s32(LETTER_Y + 4 * c) << 16);
          objectClear(this, c + 0x41);
          m.w32(COUNT, c + 1);
        } else {
          m.add32(A.SUBPHASE, 1);
          objectClear(this, c + 0x41);
          m.w32(COUNT, 0);
        }
        return;
      }
      case 2:
        // FUN_80098FB0: two halves (objects 13, 14, animations 6 and 7).
        for (const [n, anim, x] of [[13, 6, 0], [14, 7, 0xa00000]]) {
          m.w32(obj(n) + A.O_ANIM, anim);
          this.animFirst(n);
          m.w32(obj(n) + A.O_X, x);
          m.w32(obj(n) + A.O_Y, 0x5f0000);
        }
        m.add32(A.SUBPHASE, 1);
        return;
      case 3:
        // FUN_80099038
        if (m.s32(obj(13) + A.O_ANIM) === 0) {
          m.w32(COUNT, 0);
          m.add32(A.SUBPHASE, 1);
        } else {
          this.animTick(13);
          this.animTick(14);
          m.add32(COUNT, 1);
        }
        return;
      case 4:
        // FUN_80099098: the halves' last images, and a white flash.
        m.w32(obj(13) + A.O_IMAGE, 0x10051);
        m.w32(obj(14) + A.O_X, 0xa00000);
        m.w32(obj(13) + A.O_X, 0);
        m.w32(obj(13) + A.O_Y, 0x5f0000);
        m.w32(obj(14) + A.O_IMAGE, 0x10052);
        m.w32(obj(14) + A.O_Y, 0x5f0000);
        this.flash(0xff);
        m.add32(A.SUBPHASE, 1);
        return;
      case 5: {
        // FUN_8009915C: six frames of white.
        this.flash(0xff);
        const done = m.s32(COUNT) > 4;
        m.add32(COUNT, 1);
        if (done) {
          m.w32(COUNT, 0);
          m.add32(A.SUBPHASE, 1);
        }
        return;
      }
      case 6: {
        // FUN_80099208: the flash fades out over 30 frames.
        const c = m.s32(COUNT);
        this.flash(Math.trunc(((0x1e - c) * 0xff) / 0x1e) & 0xff);
        m.add32(COUNT, 1);
        if (c > 0x1d) this.nextPhase();
        return;
      }
      default:
        return;
    }
  }

  /** FUN_80099340: the finished title screen and the blinking "press start" (object 100). */
  private pressStart(): void {
    const m = this.m;
    objectsClearAll(this);
    const put = (n: number, image: number, x: number, y: number) => {
      m.w32(obj(n) + A.O_IMAGE, image);
      m.w32(obj(n) + A.O_X, x);
      m.w32(obj(n) + A.O_Y, y);
    };
    put(10, 0x1004f, 0, 0x50000);
    put(11, 0x1004f, 0xa00000, 0x50000);
    put(12, 0x10054, 0x1b0000, 0x250000);
    put(13, 0x10051, 0, 0x5f0000);
    put(14, 0x10052, 0xa00000, 0x5f0000);
    put(17, 0x10050, 0x250000, 0xa30000);
    put(15, 0x10055, 0x11c0000, 0x7b0000);
    m.w32(obj(100) + A.O_ANIM, 3);
    this.animFirst(100);
    m.w32(obj(100) + A.O_X, 0x6b0000);
    m.w32(obj(100) + A.O_Y, 0x800000);
    m.w32(COUNT, 0);
    m.add32(A.SUBPHASE, 1);
  }
}
