// SELECT.EXE: the mode select and Option mode (docs/re/shell.md §7). Ported from the decompile of
// SELECT.EXE (main 0x80095800, logic FUN_80097114, draw FUN_80096B7C).
//
// The top machine on state+0x4C: 0 the mode select (its steps on 0x800B9094), 1 Option mode (its
// phases on state+0x50: init, the option screen, the four card sub-machines on state+0x54, the
// way back), 2 an exit no step reaches, 3 nothing. A mode chosen on the mode select ends the
// program with state+0x48 = cursor + 9 (NOMAL, PAZLE, VSPUZ, EDIT).
//
// Image re-uploads: the Yes/No cursor's animations (FUN_80096E5C/FUN_80096FF4) decode their frame
// and LoadImage it again. Those items (0xA4-0xAF) share no VRAM with any other item, so the
// upload changes no pixel; the port doesn't record them (the tracer has no hook for them either).
import * as A from '../../addr';
import { objectClear, objectsClearAll } from '../../objects';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import * as Card from './card';
import { ROM } from './rom';
import { BGM_STOP, SELECT_SOUND } from '../../sound';

const BSS_END = 0x800be138;
const PAD = 0x800be126; // P1 held; pressed +2; P2 +6
const PRESSED = PAD + 2;
const PRESSED2 = PAD + 8;
const RESET = 0x800b26c0; // [2] soft-reset counters
const TIMER = A.S + 0x1fd0c; // the card messages' timer

// Mode select.
const STEP = 0x800b9094;
const CURSOR = 0x800b90a0; // 0 Classic, 1 Puzzle, 2 VS Puzzle, 3 Edit, 4 Option
const WAIT = 0x800b90a4;
const BGM_PLAYER = 0x800b90a8; // bgm_request's player (always 0 here)

// Option mode.
const ROW = 0x800b9a4c; // 0-12
const MUSIC_NO = 0x800b9adc; // music test 0-49
const SOUND_NO = 0x800b9a34; // sound test 0-49
const PICK_OPTIONS = 0x800b9c48; // card row: 0 load, 1 save
const PICK_RANKINGS = 0x800b9c84;
const HIGHLIGHT = 0x800be048; // 0x38: the image offset of a selected row's pictures
const BUTTON_IDX = 0x800be114; // [4] indices into BUTTONS: P1 row 0, P1 row 1, P2 row 0, P2 row 1
const SHOWN = 0x800be024; // [2] the two buttons a row shows
const SHOWN_IDX = 0x800b9ac0; // [2]
const DIFF = 0x800b9a3c;
const VS = 0x800b9a2c;
const TOGGLE = 0x800b9a38;
const VOLUME = 0x800b9bac;


// Tables in SELECT.EXE's data.
const ANIMS = 0x800b2744; // animation records: frame time, images..., 0xFFFE loop / 0xFFFF end
const NEIGHBOURS = 0x800b2760; // per item: right, left, down, up
const ZOOM_STEP = 0x800b27b0; // per item: the zoomed icon's dx, dy, the box's dx, dy (x16)
const ICON_IMG = 0x800b2800;
const ICON_POS = 0x800b2814;
const LABEL_IMG = 0x800b283c;
const LABEL_POS = 0x800b2850; // also the cursor's places
const DIM_POS = 0x800b2878;
const BIG_IMG = 0x800b28a0;
const BIG_POS = 0x800b28b4;
const BOX_POS = 0x800b28dc;
const TEXT1_IMG = 0x800b2904;
const TEXT1_POS = 0x800b2918;
const TEXT2_IMG = 0x800b2940;
const TEXT2_POS = 0x800b2954;
const BUTTONS = 0x800b297c; // the eight pad bits a rotation can take
const PORT_X = 0x80094120; // the port prompt's cursor x (16.16), port 1 / port 2
const YES_NO_X = 0x80094160; // the Yes/No cursor's x (16.16)

const FIELDS: Field[] = [
  ...commonFields(PAD),
  ['msel', STEP, 's32', 5],
  ['row', ROW, 's32'],
  ['tests', SOUND_NO, 's32'],
  ['mtest', MUSIC_NO, 's32'],
  ['picks', PICK_OPTIONS, 's32'],
  ['pickr', PICK_RANKINGS, 's32'],
  ['cport', Card.CARD_PORT, 's32'],
  ['cres', 0x800b9cec, 's32'],
  ['reset', RESET, 's32', 2],
];

const obj = A.obj;
/** C's division by 16 of a signed int (rounds toward zero). */
const div16 = (v: number) => (v < 0 ? v + 15 : v) >> 4;

export class Select extends Program {
  readonly name = 'SELECT';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    // The sound init (FUN_800955F0) is the first step's soundInit.
    this.m.w32(A.EXIT_FLAG, 0);
  }

  step(pad: number): void {
    this.beginTick();
    const m = this.m;
    if (this.tick > 0) {
      this.padRead(PAD, pad);
      // The CD watchdog: CdReset and the track restarted (the CD callback sets the flag on a
      // drive error or the disc's end, and the card format's result lands in it).
      this.cdWatchdog();
      this.rand();
      this.softResetCheck(PAD, RESET);
      if (this.exited) return;
    }
    this.tick++;
    m.add32(A.COUNTER, 1);
    this.logic();
  }

  traceRow() {
    return readFields(this, FIELDS);
  }

  private get pressed(): number {
    return this.m.u16(PRESSED);
  }

  /** FUN_80097114: the top machine on state+0x4C. */
  private logic(): void {
    const m = this.m;
    switch (m.s32(A.NEXT_PARAM)) {
      case 0:
        m.w32(BGM_PLAYER, 0);
        this.modeSelect();
        return;
      case 1:
        m.w32(BGM_PLAYER, 0);
        this.option();
        return;
      case 2:
        // FUN_800971D0 (no step leads here)
        this.exitTo(m.s32(CURSOR) + 9, 0, 0);
        return;
      default:
        return;
    }
  }

  // ---- animations (object +0x2C id, +0x30 timer, +0x34 frame) ----

  private animRecord(n: number): number {
    return this.m.u32(ANIMS + 4 * this.m.s32(obj(n) + A.O_ANIM));
  }

  /** FUN_80096E5C: starts object n's animation at its first frame (and uploads it). */
  private animStart(n: number): void {
    const m = this.m;
    const o = obj(n);
    if (m.s32(o + A.O_ANIM) === 0) return;
    const rec = this.animRecord(n);
    m.w32(o + A.O_IMAGE, m.s32(rec + 4) + 0x10000);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    m.w32(o + A.O_ANIM_FRAME, 0);
  }

  /** FUN_80096F38 / FUN_80096FF4 (the latter also uploads the new frame): one frame of object n's animation. */
  private animStep(n: number): void {
    const m = this.m;
    const o = obj(n);
    if (m.s32(o + A.O_ANIM) === 0) return;
    const rec = this.animRecord(n);
    const t = m.add32(o + A.O_ANIM_TIMER, -1);
    if (t >= 1) return;
    const f = m.s32(o + A.O_ANIM_FRAME);
    m.w32(o + A.O_ANIM_FRAME, f + 1);
    const code = m.u32(rec + 4 * (f + 2));
    if (code === 0xffff) {
      m.w32(o + A.O_ANIM, 0);
      return;
    }
    if (code === 0xfffe) m.w32(o + A.O_ANIM_FRAME, 0);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    m.w32(o + A.O_IMAGE, m.s32(rec + 4 * (m.s32(o + A.O_ANIM_FRAME) + 1)) + 0x10000);
  }

  // ---- the mode select (FUN_80097210, steps on 0x800B9094) ----

  private modeSelect(): void {
    const m = this.m;
    const c = m.s32(CURSOR);
    const tbl = (base: number, i: number) => m.s32(base + 4 * i);
    switch (m.s32(STEP)) {
      case 0: {
        // FUN_80097298: the two banners.
        objectsClearAll(this);
        m.w32(CURSOR, 0);
        this.bgmRequest(0x2f);
        m.w32(obj(11) + A.O_IMAGE, 0x10004);
        m.w32(obj(10) + A.O_IMAGE, 0x10003);
        m.w32(obj(10) + A.O_X, 0);
        m.w32(obj(10) + A.O_Y, 0x50000);
        m.w32(obj(11) + A.O_X, 0xa00000);
        m.w32(obj(11) + A.O_Y, 0x50000);
        m.add32(STEP, 1);
        return;
      }
      case 1:
        // FUN_80097330: the title bar and its shadow, off to the right.
        m.w32(obj(20) + A.O_IMAGE, 0x10013);
        m.w32(obj(20) + A.O_X, 0x1520000);
        m.w32(obj(20) + A.O_Y, 0xe0000);
        m.w32(obj(19) + A.O_X, 0x1550000);
        m.w32(obj(19) + A.O_Y, 0x110000);
        m.w32(obj(19) + A.O_IMAGE, 0x10014);
        m.w32(obj(19) + A.O_KIND, 3);
        this.sePlay(6);
        m.add32(STEP, 1);
        return;
      case 2:
        // FUN_800973B0: slides in 6 px a frame.
        if (m.s32(obj(20) + A.O_X) < 0x120001) {
          m.add32(STEP, 1);
        } else {
          m.add32(obj(20) + A.O_X, -0x60000);
          m.add32(obj(19) + A.O_X, -0x60000);
        }
        return;
      case 3: {
        // FUN_8009740C: icons (100-104), their shadows (95-99), labels (105-109), dimmers (110-114), the cursor (116).
        for (let i = 0; i < 5; i++) {
          const o = obj(100 + i);
          m.w32(o + A.O_IMAGE, tbl(ICON_IMG, i) + 0x10000);
          m.w32(o + A.O_X, tbl(ICON_POS, 2 * i));
          m.w32(o + A.O_Y, tbl(ICON_POS, 2 * i + 1));
        }
        for (let i = 0; i < 5; i++) {
          const o = obj(95 + i);
          m.w32(o + A.O_IMAGE, 0x10011);
          m.w32(o + A.O_X, tbl(ICON_POS, 2 * i) + 0x80000);
          m.w32(o + A.O_KIND, 3);
          m.w32(o + A.O_Y, tbl(ICON_POS, 2 * i + 1) + 0x80000);
        }
        for (let i = 0; i < 5; i++) {
          const o = obj(105 + i);
          m.w32(o + A.O_IMAGE, tbl(LABEL_IMG, i) + 0x10000);
          m.w32(o + A.O_X, tbl(LABEL_POS, 2 * i));
          m.w32(o + A.O_Y, tbl(LABEL_POS, 2 * i + 1));
        }
        for (let i = 0; i < 5; i++) {
          const o = obj(110 + i);
          m.w32(o + A.O_IMAGE, 0);
          m.w32(o + A.O_X, tbl(DIM_POS, 2 * i));
          m.w32(o + A.O_KIND, 3);
          m.w32(o + A.O_Y, tbl(DIM_POS, 2 * i + 1));
        }
        const cur = obj(116);
        const rec = m.u32(ANIMS + 4);
        m.w32(cur + A.O_ANIM, 1);
        m.w32(cur + A.O_IMAGE, m.s32(rec + 4) + 0x10000);
        m.w32(cur + A.O_ANIM_FRAME, 0);
        m.w32(cur + A.O_ANIM_TIMER, m.s32(rec));
        m.w32(cur + A.O_X, tbl(LABEL_POS, 2 * c));
        m.add32(STEP, 1);
        m.w32(cur + A.O_Y, tbl(LABEL_POS, 2 * c + 1));
        return;
      }
      case 4:
        this.choose();
        return;
      case 5:
        this.zoomIn();
        return;
      case 6:
        this.confirm();
        return;
      case 7:
        this.zoomOut();
        return;
      case 8:
        // FUN_80097E18: 75 frames with the chosen icon flashing.
        if (m.add32(WAIT, -1) < 0) m.add32(STEP, 1);
        else this.animStep(120);
        return;
      case 9:
        // FUN_80097E74: the program for the item, or Option mode.
        m.w32(STEP, 0);
        if (c < 4) {
          this.exitTo((c & 3) + 9, 0, 0);
        } else {
          m.w32(A.PHASE, 0);
          m.w32(A.SUBPHASE, 0);
          m.add32(A.NEXT_PARAM, 1);
        }
        return;
    }
  }

  /** FUN_80097650: the D-pad moves the cursor; Cross picks the item and starts its zoom. */
  private choose(): void {
    const m = this.m;
    const p = this.pressed;
    if (p & 0x40) {
      const c = m.s32(CURSOR);
      for (let i = 0; i < 5; i++) if (i !== c) m.w32(obj(110 + i) + A.O_IMAGE, 0x10015);
      const icon = obj(c + 100);
      const big = obj(118);
      m.w32(obj(116) + A.O_IMAGE, 0);
      m.w32(big + A.O_IMAGE, m.s32(icon + A.O_IMAGE));
      m.w32(big + A.O_X, m.s32(icon + A.O_X));
      m.w32(big + A.O_SCALE_X, 0);
      m.w32(big + A.O_SCALE_Y, 0);
      m.w32(big + A.O_Y, m.s32(icon + A.O_Y));
      m.w32(icon + A.O_IMAGE, 0);
      this.sePlay(5);
      m.add32(STEP, 1);
      return;
    }
    const dir = p & 0xf000;
    const k = dir === 0x2000 ? 0 : dir === 0x8000 ? 1 : dir === 0x4000 ? 2 : dir === 0x1000 ? 3 : -1;
    if (k >= 0) {
      m.w32(CURSOR, m.s32(NEIGHBOURS + m.s32(CURSOR) * 0x10 + 4 * k));
      this.sePlay(3);
    }
    const c = m.s32(CURSOR);
    m.w32(obj(116) + A.O_X, m.s32(LABEL_POS + 8 * c));
    m.w32(obj(116) + A.O_Y, m.s32(LABEL_POS + 8 * c + 4));
    this.animStep(116);
  }

  /** The zoom's per-frame moves of the big icon (118) and the item's shadow box (95 + item), sign +1 or -1. */
  private zoomMove(c: number, sign: number): void {
    const m = this.m;
    const z = (i: number) => sign * div16(m.s32(ZOOM_STEP + c * 0x10 + 4 * i));
    const big = obj(118);
    m.add32(big + A.O_SCALE_X, sign * 0x100);
    m.add32(big + A.O_SCALE_Y, sign * 0x100);
    m.add32(big + A.O_X, z(0));
    m.add32(big + A.O_Y, z(1));
    const box = obj(c + 95);
    m.add32(box + A.O_SCALE_X, sign * 0x100);
    m.add32(box + A.O_SCALE_Y, sign * 0x100);
    m.add32(box + A.O_X, z(2));
    m.add32(box + A.O_Y, z(3));
  }

  /** FUN_80097868: 16 frames of zoom (Circle backs out), then the item's big picture and texts. */
  private zoomIn(): void {
    const m = this.m;
    const c = m.s32(CURSOR);
    const big = obj(118);
    if (m.s32(big + A.O_SCALE_X) < 0x1000) {
      this.zoomMove(c, 1);
      if (this.pressed & 0x20) m.add32(STEP, 2);
      return;
    }
    const tbl = (base: number, i: number) => m.s32(base + 4 * i);
    m.w32(big + A.O_4C, m.s32(big + A.O_X));
    m.w32(big + A.O_50, m.s32(big + A.O_Y));
    m.w32(big + A.O_IMAGE, tbl(BIG_IMG, c) + 0x10000);
    m.w32(big + A.O_X, tbl(BIG_POS, 2 * c));
    m.w32(big + A.O_SCALE_X, 0);
    m.w32(big + A.O_SCALE_Y, 0);
    m.w32(big + A.O_Y, tbl(BIG_POS, 2 * c + 1));
    const box = obj(c + 95);
    m.w32(box + A.O_IMAGE, 0x1000f);
    m.w32(box + A.O_4C, m.s32(box + A.O_X));
    m.w32(box + A.O_50, m.s32(box + A.O_Y));
    m.w32(box + A.O_X, tbl(BOX_POS, 2 * c));
    m.w32(box + A.O_SCALE_X, 0);
    m.w32(box + A.O_SCALE_Y, 0);
    m.w32(box + A.O_Y, tbl(BOX_POS, 2 * c + 1));
    m.w32(obj(121) + A.O_IMAGE, tbl(TEXT1_IMG, c) + 0x10000);
    m.w32(obj(121) + A.O_X, tbl(TEXT1_POS, 2 * c));
    m.w32(obj(121) + A.O_Y, tbl(TEXT1_POS, 2 * c + 1));
    m.w32(obj(119) + A.O_IMAGE, tbl(TEXT2_IMG, c) + 0x10000);
    m.w32(obj(119) + A.O_X, tbl(TEXT2_POS, 2 * c));
    m.add32(STEP, 1);
    m.w32(obj(119) + A.O_Y, tbl(TEXT2_POS, 2 * c + 1));
  }

  /** FUN_80097B3C: Cross confirms (the flash, 75 frames); Circle puts the item back and zooms out. */
  private confirm(): void {
    const m = this.m;
    const c = m.s32(CURSOR);
    const p = this.pressed;
    const big = obj(118);
    if (p & 0x40) {
      const flash = obj(120);
      const rec = m.u32(ANIMS + 8);
      m.w32(flash + A.O_ANIM, 2);
      m.w32(flash + A.O_IMAGE, m.s32(rec + 4) + 0x10000);
      m.w32(flash + A.O_ANIM_FRAME, 0);
      m.w32(flash + A.O_X, m.s32(big + A.O_X));
      m.w32(flash + A.O_Y, m.s32(big + A.O_Y));
      m.w32(flash + A.O_ANIM_TIMER, m.s32(rec));
      this.sePlay(0);
      m.w32(WAIT, 0x4b);
      m.add32(STEP, 2);
    } else if (p & 0x20) {
      m.w32(obj(121) + A.O_IMAGE, 0);
      m.w32(big + A.O_SCALE_X, 0x1000);
      m.w32(big + A.O_SCALE_Y, 0x1000);
      m.w32(big + A.O_IMAGE, m.s32(ICON_IMG + 4 * c) + 0x10000);
      m.w32(big + A.O_X, m.s32(big + A.O_4C));
      m.w32(big + A.O_Y, m.s32(big + A.O_50));
      const box = obj(c + 95);
      m.w32(box + A.O_IMAGE, 0x10011);
      m.w32(box + A.O_SCALE_X, 0x1000);
      m.w32(box + A.O_SCALE_Y, 0x1000);
      m.w32(box + A.O_X, m.s32(box + A.O_4C));
      m.w32(box + A.O_Y, m.s32(box + A.O_50));
      m.w32(obj(119) + A.O_IMAGE, 0);
      m.w32(obj(119) + A.O_X, 0);
      m.w32(obj(119) + A.O_Y, 0);
      this.sePlay(5);
      m.add32(STEP, 1);
    }
  }

  /** FUN_80097C8C: the zoom backwards, then the icon back in its place and the cursor again. */
  private zoomOut(): void {
    const m = this.m;
    const big = obj(118);
    if (m.s32(big + A.O_SCALE_X) < 1) {
      for (let i = 0; i < 5; i++) m.w32(obj(110 + i) + A.O_IMAGE, 0);
      m.w32(STEP, 4);
      m.w32(obj(m.s32(CURSOR) + 100) + A.O_IMAGE, m.s32(big + A.O_IMAGE));
      m.w32(big + A.O_IMAGE, 0);
      return;
    }
    this.zoomMove(m.s32(CURSOR), -1);
  }

  // ---- Option mode (FUN_80097EEC, phases on state+0x50) ----

  private option(): void {
    const m = this.m;
    switch (m.s32(A.PHASE)) {
      case 0:
        this.optionInit();
        return;
      case 1:
        this.optionScreen();
        return;
      case 2:
        this.cardLoadMachine(false);
        return;
      case 3:
        this.cardSaveMachine(false);
        return;
      case 4:
        this.cardLoadMachine(true);
        return;
      case 5:
        this.cardSaveMachine(true);
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

  /** FUN_80099D24: object n shows image 0x10000 + image at (x, y). */
  private put(n: number, image: number, x: number, y: number): void {
    const m = this.m;
    const o = obj(n);
    m.w32(o + A.O_IMAGE, image + 0x10000);
    m.w32(o + A.O_X, x << 16);
    m.w32(o + A.O_Y, y << 16);
  }

  /** The index of `value` in BUTTONS (8 if none). */
  private buttonIndex(value: number): number {
    let i = 0;
    while (i < 8 && this.m.s32(BUTTONS + 4 * i) !== value) i++;
    return i;
  }

  /** FUN_80097F74: Option mode's set-up. */
  private optionInit(): void {
    const m = this.m;
    this.bgmRequest(0x34);
    m.w32(A.MENU_ROWS, 1);
    objectsClearAll(this);
    m.w32(ROW, 0);
    m.w32(MUSIC_NO, 0);
    m.w32(SOUND_NO, 0);
    m.w32(PICK_OPTIONS, 0);
    m.w32(PICK_RANKINGS, 0);
    m.w32(BUTTON_IDX, this.buttonIndex(m.s32(A.S + 0x4b4ec)));
    m.w32(BUTTON_IDX + 8, this.buttonIndex(m.s32(A.S + 0x4b4f0)));
    m.w32(SHOWN, m.s32(A.S + 0x4b4f4));
    m.w32(SHOWN + 4, m.s32(A.S + 0x4b4f8));
    m.w32(BUTTON_IDX + 4, this.buttonIndex(m.s32(SHOWN)));
    m.w32(BUTTON_IDX + 12, this.buttonIndex(m.s32(SHOWN + 4)));
    this.put(0, 0x23, 0, 8);
    this.put(1, 0x23, 0xa0, 8);
    this.put(2, 0x24, 0x74, 0x18);
    this.put(100, 0xb1, 0xb4, 0xc0);
    m.add32(A.PHASE, 1);
  }

  /** FUN_80098228: Up/Down pick a row; every row's handler runs. */
  private optionScreen(): void {
    const m = this.m;
    const p = this.pressed;
    if (p & 0x1000) {
      if (m.add32(ROW, -1) < 0) m.w32(ROW, 0);
      else this.sePlay(3);
    }
    if (p & 0x4000) {
      if (m.add32(ROW, 1) < 0xd) this.sePlay(3);
      else m.w32(ROW, 0xc);
    }
    this.rowButtons(0);
    this.rowButtons(1);
    this.rowCycle(2, DIFF, 0x4b4fe, 0xf, 0x27, 0x4c);
    this.rowCycle(3, VS, 0x4b501, 0x11, 0x28, 0x56);
    this.rowStereo();
    this.rowMusicMode();
    this.highlight(m.s32(ROW) - 6 >>> 0 < 2);
    this.put(0x19, m.s32(HIGHLIGHT) + 0x2b, 0x1c, 0x74);
    this.rowMusicTest();
    this.rowSoundTest();
    this.highlight(m.s32(ROW) - 8 >>> 0 < 2);
    const h = m.s32(HIGHLIGHT);
    this.put(0x20, h + 0x2c, 0x1c, 0x88);
    this.put(0x21, h + 0x35, 0xb4, 0x88);
    this.put(0x22, h + 0x36, 0xec, 0x88);
    this.rowVolume(8, 0x4b4ff, 0x23, 0x37, 0x92);
    this.rowVolume(9, 0x4b500, 0x2c, 0x38, 0x9c);
    this.rowCard(10, PICK_OPTIONS, 2, 0x35, 0x2d, 0xa6);
    this.rowCard(11, PICK_RANKINGS, 4, 0x38, 0x2e, 0xb0);
    // FUN_80099C98: Exit.
    if (this.highlight(m.s32(ROW) === 0xc) && p & 0x40) {
      this.bgmRequest(0x34);
      m.w32(A.PHASE, 7);
    }
    this.put(0x3b, m.s32(HIGHLIGHT) + 0x2f, 0x1c, 0xba);
  }

  /** Sets HIGHLIGHT for a row (0x38 when selected); returns whether it is. */
  private highlight(on: boolean): boolean {
    this.m.w32(HIGHLIGHT, on ? 0x38 : 0);
    return on;
  }

  /**
   * FUN_800983F8 (row 0) / FUN_800987DC (row 1): the rotation buttons. Pad 1's Left/Right steps
   * player 1's button, pad 2's player 2's, skipping the button the other row gives that player.
   */
  private rowButtons(row: number): void {
    const m = this.m;
    const own = (pl: number) => A.S + 0x4b4ec + 8 * row + 4 * pl; // row 0: +0x4B4EC/F0, row 1: +0x4B4F4/F8
    const other = (pl: number) => A.S + 0x4b4ec + 8 * (row ^ 1) + 4 * pl;
    const idx = (pl: number) => BUTTON_IDX + 4 * row + 8 * pl;
    if (this.highlight(m.s32(ROW) === row)) {
      for (let pl = 0; pl < 2; pl++) {
        const pr = m.u16(pl === 0 ? PRESSED : PRESSED2);
        const d = pr === 0x2000 ? 1 : pr === 0x8000 ? -1 : 0;
        if (d === 0) {
          if (pl === 0) continue;
          break;
        }
        const i = (m.s32(idx(pl)) + d) & 7;
        m.w32(idx(pl), i);
        if (m.s32(other(pl)) === m.s32(BUTTONS + 4 * i)) m.w32(idx(pl), (i + d) & 7);
        m.w32(own(pl), m.s32(BUTTONS + 4 * m.s32(idx(pl))));
      }
    }
    m.w32(SHOWN, m.s32(own(0)));
    m.w32(SHOWN + 4, m.s32(own(1)));
    m.w32(SHOWN_IDX, this.buttonIndex(m.s32(SHOWN)));
    m.w32(SHOWN_IDX + 4, this.buttonIndex(m.s32(SHOWN + 4)));
    const h = m.s32(HIGHLIGHT);
    const y = row === 0 ? 0x38 : 0x42;
    const n = row === 0 ? 3 : 9;
    this.put(n, h + 0x25 + row, 0x1c, y);
    this.put(n + 1, h + 0x30, 0x99, y);
    this.put(n + 2, h + 0x32, 0xca, y);
    this.put(n + 3, h + 0x31, 0x116, y);
    this.put(n + 4, h + m.s32(SHOWN_IDX) + 0x55, 0xb0, y);
    this.put(n + 5, h + m.s32(SHOWN_IDX + 4) + 0x55, 0xfd, y);
  }

  /** FUN_80098BC4 (difficulty) / FUN_80098CF8 (VS setting): 0-3, wrapping. */
  private rowCycle(row: number, v: number, setting: number, n: number, label: number, y: number): void {
    const m = this.m;
    m.w32(v, m.u8(A.S + setting));
    if (this.highlight(m.s32(ROW) === row)) {
      const p = this.pressed;
      if (p & 0x2000) {
        const x = m.u32(v) + 1;
        m.w32(v, x > 3 ? 0 : x);
      }
      if (p & 0x8000 && m.add32(v, -1) < 0) m.w32(v, 3);
    }
    m.w8(A.S + setting, m.u32(v) & 0xff);
    const h = m.s32(HIGHLIGHT);
    this.put(n, h + label, 0x1c, y);
    if (row === 2) {
      this.put(0x10, h + m.s32(v) + 0x3b, 0x9a, y);
    } else {
      this.put(0x12, h + 0x33, 0xa7, y);
      this.put(0x13, h + m.s32(v) * 2 + 0x44, 0x99, y);
    }
  }

  /** FUN_80098E4C: stereo/mono, Left or Right toggles (the SPU and CD mix follow). */
  private rowStereo(): void {
    const m = this.m;
    let v = m.u8(A.SETTING_4FC);
    if (this.highlight(m.s32(ROW) === 4)) {
      m.w32(TOGGLE, v ^ 1);
      if (this.pressed & 0xa000) {
        // SsSetMono / SsSetStereo and the matching CdMix, at once.
        v = m.u32(TOGGLE);
        this.sound.push({ kind: 'mono', mono: v !== 0 });
      }
    }
    m.w32(TOGGLE, v);
    m.w8(A.SETTING_4FC, v & 0xff);
    const h = m.s32(HIGHLIGHT);
    this.put(0x14, h + 0x29, 0x1c, 0x60);
    this.put(0x15, h + m.s32(TOGGLE) + 0x3f, 0x9a, 0x60);
  }

  /** FUN_80098F7C: the music arrangement, Right and Left each toggle. */
  private rowMusicMode(): void {
    const m = this.m;
    m.w32(TOGGLE, m.u8(A.SETTING_4FD));
    if (this.highlight(m.s32(ROW) === 5)) {
      if (this.pressed & 0x2000) m.w32(TOGGLE, m.u32(TOGGLE) ^ 1);
      if (this.pressed & 0x8000) m.w32(TOGGLE, m.u32(TOGGLE) ^ 1);
    }
    m.w8(A.SETTING_4FD, m.u8(TOGGLE));
    const h = m.s32(HIGHLIGHT);
    this.put(0x16, h + 0x2a, 0x1c, 0x6a);
    this.put(0x17, h + 0x34, 0xd8, 0x6a);
    this.put(0x18, h + m.s32(TOGGLE) + 0x41, 0x9a, 0x6a);
  }

  /** A 0-49 number that wraps, stepped by Right/Left. */
  private stepNumber(v: number): void {
    const m = this.m;
    if (this.pressed & 0x2000 && m.add32(v, 1) > 0x31) m.w32(v, 0);
    if (this.pressed & 0x8000 && m.add32(v, -1) < 0) m.w32(v, 0x31);
  }

  /** FUN_800990F8: the music test; Cross plays CD track number + 2 (straight to the CD, no bgm_request). */
  private rowMusicTest(): void {
    const m = this.m;
    if (this.highlight(m.s32(ROW) === 6)) {
      this.stepNumber(MUSIC_NO);
      if (this.pressed & 0x40) {
        // bgm_request's "playing" id becomes the track; the CD volume, then the track, looping.
        m.w32(SELECT_SOUND.curId, m.s32(MUSIC_NO) + 2);
        m.w32(A.TWO_PLAYER, 0);
        this.sound.push({ kind: 'cdvol', vol: m.s16(SELECT_SOUND.musicVol + 2 * m.u8(A.MUSIC_VOLUME)) });
        this.sound.push({ kind: 'play', track: m.s32(MUSIC_NO) + 2, mode: 1 });
      }
    }
    const h = m.s32(HIGHLIGHT);
    const n = m.s32(MUSIC_NO);
    this.put(0x1a, h + 0x37, 0x9a, 0x74);
    this.put(0x1b, h + Math.trunc(n / 10) + 0x43, 0xb4, 0x74);
    this.put(0x1c, h + (n % 10) + 0x43, 0xbb, 0x74);
  }

  /** FUN_80099414: the sound test; Cross plays the effect. */
  private rowSoundTest(): void {
    const m = this.m;
    if (this.highlight(m.s32(ROW) === 7)) {
      this.stepNumber(SOUND_NO);
      if (this.pressed & 0x40) {
        m.w32(A.TWO_PLAYER, 0);
        this.sePlay(m.s32(SOUND_NO));
      }
    }
    const h = m.s32(HIGHLIGHT);
    const n = m.s32(SOUND_NO);
    this.put(0x1d, h + 0x38, 0x9a, 0x7e);
    this.put(0x1e, h + Math.trunc(n / 10) + 0x43, 0xb4, 0x7e);
    this.put(0x1f, h + (n % 10) + 0x43, 0xbb, 0x7e);
  }

  /** FUN_80099668 (BGM, applied at once) / FUN_80099844 (SE): volume 0-7 as a bar of 8. */
  private rowVolume(row: number, setting: number, n: number, label: number, y: number): void {
    const m = this.m;
    m.w32(VOLUME, m.u8(A.S + setting));
    if (this.highlight(m.s32(ROW) === row)) {
      if (this.pressed & 0x2000) {
        const x = m.u32(VOLUME) + 1;
        m.w32(VOLUME, x > 7 ? 7 : x);
      }
      if (this.pressed & 0x8000 && m.add32(VOLUME, -1) < 0) m.w32(VOLUME, 0);
    }
    m.w8(A.S + setting, m.u32(VOLUME) & 0xff);
    // The music volume applies at once, every frame, unless bgm_request has stopped the music.
    if (setting === 0x4b4ff && m.s32(SELECT_SOUND.curId) !== BGM_STOP) {
      this.sound.push({ kind: 'cdvol', vol: m.s16(SELECT_SOUND.musicVol + 2 * m.u8(A.MUSIC_VOLUME)) });
    }
    const h = m.s32(HIGHLIGHT);
    this.put(n, h + label, 0x9a, y);
    for (let i = 0; i < 8; i++) this.put(n + 1 + i, h + (i < m.s32(VOLUME) + 1 ? 0x54 : 0x53), 0xb4 + 8 * i, y);
  }

  /** FUN_800999D0 (options) / FUN_80099B34 (rankings): Load or Save; Cross starts the card machine. */
  private rowCard(row: number, pick: number, phase: number, n: number, label: number, y: number): void {
    const m = this.m;
    if (this.highlight(m.s32(ROW) === row)) {
      const p = this.pressed;
      if (p & 0x2000) m.w32(pick, m.u32(pick) ^ 1);
      else if (p & 0x8000) m.w32(pick, m.u32(pick) ^ 1);
      else if (p & 0x40) {
        m.w32(A.PHASE, m.u32(pick) + phase);
        m.w32(A.SUBPHASE, 0);
      }
    }
    const h = m.s32(HIGHLIGHT);
    const k = m.u32(pick);
    this.put(n, h + label, 0x1c, y);
    this.put(n + 1, Math.imul(k ^ 1, h) + 0x39, 0x9a, y);
    this.put(n + 2, Math.imul(h, k) + 0x3a, 0xba, y);
  }

  // ---- the card machines (state+0x54) ----

  /** Object 63 shows a card message for `time` frames (step 3), objects 60 and 62 cleared. */
  private message(image: number, time: number | null, next: number): void {
    const m = this.m;
    objectClear(this, 0x3c);
    objectClear(this, 0x3e);
    m.w32(obj(63) + A.O_IMAGE, image);
    m.w32(obj(63) + A.O_X, 0x600000);
    m.w32(obj(63) + A.O_Y, 0x400000);
    if (time !== null) m.w32(TIMER, time);
    m.w32(A.SUBPHASE, next);
  }

  /** The prompt in object 60 and the port cursor (object 62, animation 3), as FUN_80099E24 / FUN_8009A2FC. */
  private portPrompt(image: number, y: number): void {
    const m = this.m;
    m.w32(obj(60) + A.O_IMAGE, image);
    m.w32(obj(60) + A.O_X, 0x600000);
    m.w32(obj(60) + A.O_Y, 0x400000);
    m.w32(obj(62) + A.O_IMAGE, 0x10000);
    m.w32(obj(62) + A.O_X, 0x770000);
    m.w32(obj(62) + A.O_Y, y);
    m.w32(obj(62) + A.O_ANIM, 3);
    this.animStart(0x3e);
    m.w32(Card.CARD_PORT, 0);
    m.add32(A.SUBPHASE, 1);
  }

  /** A Yes/No prompt in object 60, the cursor (object 62 field 0x4C, animation 5/6) on No. */
  private yesNoPrompt(image: number, y: number, next: number): void {
    const m = this.m;
    const o = obj(62);
    m.w32(obj(60) + A.O_IMAGE, image);
    m.w32(obj(60) + A.O_X, 0x600000);
    m.w32(obj(60) + A.O_Y, 0x400000);
    m.w32(o + A.O_4C, 1);
    m.w32(o + A.O_IMAGE, 0x10000);
    m.w32(o + A.O_Y, y);
    m.w32(o + A.O_X, m.s32(0x8009415c) << 16); // DAT_8009415C = 0xA7: on No
    m.w32(o + A.O_ANIM, m.s32(o + A.O_4C) + 5);
    this.animStart(0x3e);
    m.w32(A.SUBPHASE, next);
  }

  /** FUN_80099EA8: the port cursor; Cross goes on, Circle leaves (step 4). */
  private portChoose(): void {
    const m = this.m;
    const p = this.pressed;
    if (p & 0x40) {
      this.sePlay(0);
      m.add32(A.SUBPHASE, 1);
    } else if (p & 0x20) {
      this.sePlay(0x12);
      m.w32(A.SUBPHASE, 4);
    } else if (p & 0xa000) {
      const k = m.u32(Card.CARD_PORT) ^ 1;
      m.w32(Card.CARD_PORT, k);
      m.w32(obj(62) + A.O_ANIM, k + 3);
      m.w32(obj(62) + A.O_X, m.s32(PORT_X + 4 * k));
      this.animStart(0x3e);
      this.sePlay(3);
    } else {
      this.animStep(0x3e);
    }
  }

  /** The Yes/No cursor (FUN_8009A6F4 / FUN_8009AA40): returns 'yes' on Cross over Yes, else handles No/Circle/moves. */
  private yesNo(): boolean {
    const m = this.m;
    const p = this.pressed;
    const o = obj(62);
    if (p & 0x40) {
      this.sePlay(0);
      const k = m.s32(o + A.O_4C);
      if (k === 0) return true;
      if (k === 1) {
        this.backToPrompt();
        return false;
      }
    }
    if (p & 0x20) {
      this.sePlay(0x12);
      this.backToPrompt();
    } else if (p & 0xa000) {
      const k = m.u32(o + A.O_4C) ^ 1;
      m.w32(o + A.O_4C, k);
      m.w32(o + A.O_ANIM, k + 5);
      this.animStart(0x3e);
      m.w32(o + A.O_X, m.s32(YES_NO_X + 4 * m.s32(o + A.O_4C)));
      this.sePlay(3);
    } else {
      this.animStep(0x3e);
    }
    return false;
  }

  private backToPrompt(): void {
    objectClear(this, 0x3c);
    objectClear(this, 0x3e);
    this.m.w32(A.SUBPHASE, 0);
  }

  /** FUN_8009A114: the message's timer, then back to the prompt. */
  private messageWait(): void {
    const m = this.m;
    if (m.add32(TIMER, -1) === 0) {
      m.w32(obj(63) + A.O_IMAGE, 0x10000);
      m.w32(obj(63) + A.O_X, 0);
      m.w32(obj(63) + A.O_Y, 0);
      m.w32(Card.CARD_PORT, 0);
      m.w32(A.SUBPHASE, 0);
    }
  }

  /** FUN_8009A168: back to the option screen. */
  private cardDone(): void {
    objectClear(this, 0x3c);
    objectClear(this, 0x3e);
    objectClear(this, 0x3f);
    this.m.w32(A.PHASE, 1);
    this.m.w32(A.SUBPHASE, 0);
  }

  private setResult(r: number): number {
    this.m.w32(0x800b9cec, r);
    return r;
  }

  /** Phases 2 and 4 (tables 0x80094128 / 0x80094140): load the options or the rankings. */
  private cardLoadMachine(rankings: boolean): void {
    const m = this.m;
    switch (m.s32(A.SUBPHASE)) {
      case 0:
        this.portPrompt(0x10095, 0x6d0000);
        return;
      case 1:
        this.portChoose();
        return;
      case 2: {
        // FUN_80099F9C
        this.stall += 90;
        const r = this.setResult(Card.cardProbe(this));
        if (r === 2) return; // a new card: probe again next frame
        let msg: number;
        if (r === 0) msg = 0x10096;
        else if (r === 1) {
          const l = this.setResult(Card.cardLoad(this));
          if (l === 0) msg = 0x10097;
          else if (l !== -1) {
            m.w32(A.SUBPHASE, 5);
            return;
          } else msg = 0x1009a;
        } else if (r === 3) msg = 0x10097;
        else msg = 0x10098;
        this.message(msg, 0x78, m.s32(A.SUBPHASE) + 1);
        return;
      }
      case 3:
        this.messageWait();
        return;
      case 4:
        this.cardDone();
        return;
      case 5:
        // FUN_8009A1AC / FUN_8009A1DC
        if (rankings) Card.loadRankings(this);
        else Card.loadOptions(this);
        m.w32(A.SUBPHASE, 4);
        return;
    }
  }

  /** Phases 3 and 5 (tables 0x80094168 / 0x800941A0): save the options or the rankings. */
  private cardSaveMachine(rankings: boolean): void {
    const m = this.m;
    switch (m.s32(A.SUBPHASE)) {
      case 0:
        this.portPrompt(0x10099, 0x780000);
        return;
      case 1:
        this.portChoose();
        return;
      case 2: {
        // FUN_8009A380
        this.stall += 90;
        const r = this.setResult(Card.cardProbe(this));
        if (r === 2) return;
        if (r === 0) this.message(0x10096, 0x78, 3);
        else if (r === 3) this.yesNoPrompt(0x1009b, 0x820000, 0xb); // format?
        else if (r === 1) m.w32(A.SUBPHASE, 5);
        else this.message(0x1009a, 0x78, 3);
        return;
      }
      case 3:
        this.messageWait();
        return;
      case 4:
        this.cardDone();
        return;
      case 5: {
        // FUN_8009A514: a file there? Overwrite prompt; none: room for one more block?
        const r = this.setResult(Card.cardLoad(this));
        if (r === 0) {
          const used = Card.cardBlocksUsed(this);
          m.w32(0x800b9ce8, used);
          if (used < 0xf) this.message(0x100a0, null, 0xc);
          else this.message(0x1009e, 0x78, 3);
        } else {
          this.yesNoPrompt(0x1009f, 0x720000, 7);
        }
        return;
      }
      case 6:
        // FUN_8009A668: create the file.
        if (this.setResult(Card.cardCreate(this)) === 0) this.message(0x100a1, 0x78, 3);
        else m.w32(A.SUBPHASE, 4);
        return;
      case 7:
        // FUN_8009A6F4: overwrite?
        if (this.yesNo()) {
          m.w32(A.SUBPHASE, 0xd);
          m.w32(TIMER, 4);
        }
        return;
      case 8:
        // FUN_8009A9C8 / FUN_8009AA04
        if (rankings) Card.saveRankings(this);
        else Card.saveOptions(this);
        m.add32(A.SUBPHASE, 1);
        return;
      case 9:
        // FUN_8009A838: rewrite the file.
        if (this.setResult(Card.cardProbe(this)) === 1 && this.setResult(Card.cardRewrite(this)) !== 0) {
          m.w32(A.SUBPHASE, 4);
          return;
        }
        this.message(0x100a1, 0x78, 3);
        return;
      case 10:
        // FUN_8009A8E0: format after a few frames.
        if (m.add32(TIMER, -1) === 0) {
          if (this.setResult(Card.cardFormat(this)) === 0) this.message(0x1009d, 0x78, 3);
          else this.message(0x100a0, null, 0xc);
        }
        return;
      case 11:
        // FUN_8009AA40: format?
        if (this.yesNo()) {
          if (this.setResult(Card.cardProbe(this)) !== 3) this.message(0x1009d, 0x78, 3);
          else this.message(0x1009c, 3, 10);
        }
        return;
      case 12:
        // FUN_8009AC28
        m.w32(A.SUBPHASE, 6);
        return;
      case 13:
        // FUN_8009AC3C: after a few frames, check the card again.
        if (m.add32(TIMER, -1) === 0) {
          if (Card.cardProbe(this) === 1) this.message(0x100a0, null, 8);
          else this.message(0x100a1, 0x78, 3);
        }
        return;
    }
  }
}
