// SW_ON.EXE: the memory-card check and the copyright screen (power-on, after JLOGO; docs/re/shell.md
// §7). Step 0 builds the default save data and applies it to the shared state block; step 2 waits
// a second (VSync(60)); step 3 checks the cards in both ports: a valid save file loads silently,
// a card without the file but with room goes on; otherwise a message screen (no card, card full,
// unformatted with a format prompt, error) where Cross checks again and Circle goes on without
// saving. Then the copyright scrolls up, holds and fades out, and TIT_DEMO starts. No sound, no
// soft reset. Ported from the decompile of SW_ON.EXE (main 0x800957B0, logic 0x800990F8: 36 steps
// on state+0x4C, table 0x800940F8; draw 0x80096A48).
import * as A from '../../addr';
import { objectClear, objectsClearAll } from '../../objects';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800bacd4;
const PAD = 0x800bacc2; // P1 held; pressed +2; P2 +6
const PRESSED = PAD + 2;
const TIMER = A.S + 0x1fd0c; // the copyright's hold and fade (inside object 1049)

// The card code's globals (docs/re/shell.md §2; a copy of PAZLE's, survey §4).
const CARD_PORT = 0x800b682c; // the port being checked: 0 "bu00:", 1 "bu10:"
const CARD_RESULT = 0x800b8928; // [2] each port's check result
const CARD_OK = 0x800b6894; // the last load / format / create result
const CARD_BLOCKS = 0x800b6890; // blocks in use on a card without the file
const CARD_CHAN = 0x800b8924; // port << 4
const CARD_EVENT = 0x800b5c58; // the last libcard event index
const IO_COUNT = 0x800b6600; // bytes the last read or write moved
const FD = 0x800b6774;
const DIRENT = 0x800b6648; // firstfile/nextfile's entry (size at +0x18)
const FILE_NAME = 0x800aeda8; // "bu00:baslus-00338", 0xFF bytes per port
const FILE_PATTERN = 0x800aefa8; // "bu00:*", 0x80 bytes per port
const BUF = 0x800b690c; // the 8 KB file as read or written
const CHECK1 = BUF + 0x200;
const COPY1 = BUF + 0x201; // the persistent block; its XOR at CHECK2 and a second copy follow
const CHECK2 = BUF + 0x981;
const COPY2 = BUF + 0x982;
const HEADER = 0x800ba148; // the 0x200-byte save header (title, icon)
const BLOCK = 0x2000;
const BLOCK_SIZE = 0x780;
const PERSIST = A.S + 0x4ad84;

// The CD watchdog in the main loop (bgm_poll's clone): format() stores its result in its flag.
const CD_RESTART = 0x800b5d04;
const CD_RESET_RESULT = 0x800b5d08;
const CD_TRACK = 0x800b5cdc;
const CD_END = 0x800b5d10;
const CD_END_POS = 0x800b5ccc;
const CD_TOC = A.S + 0x20550;
const CD_TRACKS = 0x800af25c; // per track (from 2), 12 bytes: length in sectors, ...

// Tables in SW_ON.EXE's data.
const ANIMS = 0x800af598; // per animation id: timer, images..., 0xFFFE loop / 0xFFFF end
const CURSOR_X = 0x80094188; // [2] Yes / No (16.16)
const DEFAULTS = 0x800af5a4; // default rankings, slots, options (FUN_80098598)

const FIELDS: Field[] = [
  ...commonFields(PAD),
  ['card', CARD_PORT, 's32'],
  ['cardres', CARD_RESULT, 's32', 2],
  ['cardok', CARD_OK, 's32'],
  ['blocks', CARD_BLOCKS, 's32'],
  ['cardev', CARD_EVENT, 's32'],
  ['timer', TIMER, 's32'],
];

const obj = A.obj;
const CROSS = 0x40;
const CIRCLE = 0x20;
const LEFT_RIGHT = 0xa000;

export class SwOn extends Program {
  readonly name = 'SW_ON';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    // main before its loop: the pad words (8 x 6 bytes from 0x800BACC0), the exit flag.
    this.m.fill(0x800bacc0, 8 * 6);
    this.m.w32(A.EXIT_FLAG, 0);
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
    return readFields(this, FIELDS);
  }

  /** FUN_800990F8: the 36 steps on state+0x4C. */
  private logic(): void {
    const m = this.m;
    const step = m.s32(A.NEXT_PARAM);
    const next = (n: number) => m.w32(A.NEXT_PARAM, n);
    const pressed = m.u16(PRESSED);
    switch (step) {
      case 0:
        this.start();
        return;
      case 1: // FUN_80099328
        next(2);
        return;
      case 2: // FUN_80099348: VSync(60)
        this.stall += 60;
        next(3);
        return;
      case 3:
        this.checkCards();
        return;
      case 4:
        this.copyrightStart();
        return;
      case 5: {
        // FUN_800998B8: both halves scroll up 2 px a frame, then the hold.
        if (m.s32(obj(0) + A.O_Y) < 1) {
          if (m.add32(TIMER, -1) === 0) {
            m.w32(TIMER, 0x40);
            next(6);
          }
        } else {
          m.add32(obj(0) + A.O_Y, -0x20000);
          m.add32(obj(1) + A.O_Y, -0x20000);
        }
        return;
      }
      case 6: {
        // FUN_80099934: a 64-frame fade, a subtractive box over the screen (GsSortBoxFill).
        const t = m.add32(TIMER, -1);
        if (t === 0) {
          objectsClearAll(this);
          next(7);
        } else {
          const c = Math.trunc(((0x40 - t) * 0xff) / 0x40) & 0xff;
          this.boxes.push({ box: { attribute: 0x60000000, x: -0xa0, y: -0x78, w: 0x140, h: 0xf0, r: c, g: c, b: c }, pri: 0 });
        }
        return;
      }
      case 7:
        // FUN_80099A5C: on to TIT_DEMO with Puzzle Mode's three menu rows.
        m.w32(A.MENU_ROWS, 1);
        this.exitTo(2, 0, 0);
        return;
      case 8: // FUN_80099A98: "no memory card" (items 2, 3)
        this.message(3, 0x180000, false);
        next(9);
        return;
      case 9: case 21: case 25: case 33:
        // FUN_80099B90 / 8009A1C4 / 8009A33C / 8009A5E4: Cross checks again, Circle goes on.
        if (pressed & CROSS) next(0);
        else if (pressed & CIRCLE) next(28);
        return;
      case 12: {
        // FUN_80099BE8: "not formatted, format it?" (items 6, 7), the Yes/No cursor on No.
        this.message(7, 0x180000, false);
        const c = obj(2);
        m.w32(c + A.O_4C, 1);
        m.w32(c + A.O_Y, 0x950000);
        m.w32(c + A.O_X, m.s32(CURSOR_X + 4));
        m.w32(c + A.O_ANIM, m.s32(c + A.O_4C) + 1);
        this.animStart(2);
        this.portMark();
        next(13);
        return;
      }
      case 13:
        // FUN_80099D54: Cross on Yes formats, on No shows "can't save" (step 32); Circle goes on.
        if (pressed & CROSS) next(m.s32(obj(2) + A.O_4C) === 0 ? 16 : 32);
        else if (pressed & CIRCLE) next(28);
        else this.cursor(pressed);
        return;
      case 16: {
        // FUN_80099E54: checks the card again: none left → step 8; a new card → again next frame.
        const r = this.cardCheck();
        m.w32(CARD_OK, r);
        if (r === 0) {
          objectClear(this, 2);
          objectClear(this, 3);
          next(8);
        } else if (r !== 2) {
          // "formatting" (items 10, 11). Quirk: object 1's y isn't written (object 0's twice).
          this.message(0xb, 0x180000, true);
          objectClear(this, 2);
          this.portMark();
          next(17);
        }
        return;
      }
      case 17: // FUN_80099FBC
        next(18);
        return;
      case 18: {
        // FUN_80099FDC: format(). Quirks: success goes straight to the copyright, so step 19
        // (creating the file) is never reached and the card stays without a save file; and the
        // result lands in the CD watchdog's flag, so the main loop resets the CD drive and
        // starts playing it (cdWatchdog).
        const r = this.cards.format(this, FILE_PATTERN + (m.s32(CARD_PORT) << 7));
        m.w32(CD_RESTART, r);
        m.w32(CARD_OK, r);
        next(r === 0 ? 0x14 : 4);
        return;
      }
      case 19: {
        // FUN_8009A048 (unreachable): creates the save file.
        const r = this.cardCreate();
        m.w32(CARD_OK, r);
        if (r !== 0) m.w32(A.MENU_ROWS, 0);
        next(r === 0 ? 0x14 : 4);
        return;
      }
      case 20: // FUN_8009A0A4: "card error" (items 12, 13)
        this.message(0xd, 0x180000, false);
        this.portMark();
        next(21);
        return;
      case 24: // FUN_8009A21C: "card full" (items 14, 15)
        this.message(0xf, 0x180000, false);
        this.portMark();
        next(25);
        return;
      case 28: // FUN_8009A394: on without saving
        m.w32(A.MENU_ROWS, 1);
        next(4);
        return;
      case 29:
        // FUN_8009A3C4 (unreachable): Yes goes on, No or Circle checks again.
        if (pressed & CROSS) next(m.s32(obj(2) + A.O_4C) === 0 ? 4 : 0);
        else if (pressed & CIRCLE) next(0);
        else this.cursor(pressed);
        return;
      case 32: // FUN_8009A4BC: "can't save" (items 8, 9)
        this.message(9, 0x180000, false);
        objectClear(this, 2);
        this.portMark();
        next(33);
        return;
      default:
        return; // 10, 11, 14, 15, 22, 23, 26, 27, 30, 31, 34, 35: empty
    }
  }

  /** FUN_80099178: the default save data in the file buffer and in the state block. */
  private start(): void {
    const m = this.m;
    objectsClearAll(this);
    m.w32(CARD_PORT, 0);
    m.w32(0x800b6904, 0);
    m.w32(CARD_RESULT + 4, 0);
    m.w32(CARD_RESULT, 0);
    m.w32(A.MENU_ROWS, 1);
    this.defaults();
    m.w32(0x800b6860, 0);
    m.add32(A.NEXT_PARAM, 1);
  }

  /** FUN_80098598, FUN_800989B4(0), then no best times (9999) back into the buffer. */
  private defaults(): void {
    const m = this.m;
    for (let i = 0; i < 0x6e; i++) m.w16(COPY1 + 2 * i, 9999);
    this.copy(DEFAULTS, COPY1 + 0xdc, 0x3c);
    this.copy(0x800af5e0, COPY1 + 0x118, 0x3c);
    this.copy(0x800af61c, COPY1 + 0x154, 6);
    this.copy(0x800af624, COPY1 + 0x15a, 0x60e);
    this.copy(0x800afc34, COPY1 + 0x768, 0x18);
    this.copy(COPY1, PERSIST, BLOCK_SIZE);
    for (let i = 0; i < 0x6e; i++) m.w16(PERSIST + 2 * i, 9999);
    this.copy(PERSIST, COPY1, 0xdc);
  }

  /**
   * FUN_80099384: checks the card in the current port (up to 7 tries while it reports an
   * error). A valid file loads; a card without the file but with room goes on (nothing is
   * created); otherwise the other port is tried, and after both the results pick a message.
   */
  private checkCards(): void {
    const m = this.m;
    let r = 0;
    for (let tries = 1; ; tries++) {
      r = this.cardCheck();
      m.w32(CARD_RESULT + 4 * m.s32(CARD_PORT), r);
      if (r >= 0 || tries >= 7) break;
    }
    if (r === 2) return; // a new card: check again next frame
    if (r === 1) {
      const ok = this.cardLoad();
      m.w32(CARD_OK, ok ? 1 : 0);
      if (ok) {
        this.copy(COPY1, PERSIST, BLOCK_SIZE);
        m.w32(A.NEXT_PARAM, 4);
        return;
      }
      this.defaults();
      let total = 0x1fff;
      const pattern = FILE_PATTERN + (m.s32(CARD_PORT) << 7);
      for (let e = this.cards.firstFile(this, pattern, DIRENT); e !== 0; e = this.cards.nextFile(this, DIRENT)) {
        total = (total + m.s32(DIRENT + 0x18)) | 0;
      }
      const blocks = (total < 0 ? total + 0x1fff : total) >> 13;
      m.w32(CARD_BLOCKS, blocks);
      if (blocks < 15) {
        m.w32(A.NEXT_PARAM, 4);
        return;
      }
    }
    const port = m.s32(CARD_PORT) ^ 1;
    m.w32(CARD_PORT, port);
    if (port === 1) return; // port 2 next frame
    const r0 = m.s32(CARD_RESULT);
    const r1 = m.s32(CARD_RESULT + 4);
    let step: number;
    if (r0 === 0) {
      // Nothing in port 1: port 2's result decides.
      if (r1 === 0) step = 8;
      else if (r1 === -1) step = 0x20;
      else if (r1 === 1) step = 0x18;
      else if (r1 === 3) step = 0xc;
      else return;
      m.w32(CARD_PORT, r1 === 0 ? 0 : 1);
    } else {
      m.w32(CARD_PORT, 0);
      step = r0 === 3 ? 0xc : r0 === 1 ? 0x18 : 0x20;
    }
    m.w32(A.NEXT_PARAM, step);
  }

  /** FUN_800997A8: the copyright's two halves below the screen, the hold timer. */
  private copyrightStart(): void {
    const m = this.m;
    m.w32(obj(0) + A.O_X, 0);
    m.w32(obj(0) + A.O_Y, 0xf00000);
    m.w32(obj(0) + A.O_IMAGE, 0x10001);
    this.itemLoad(0);
    m.w32(obj(1) + A.O_X, 0xa00000);
    m.w32(obj(1) + A.O_Y, 0xf00000);
    m.w32(obj(1) + A.O_IMAGE, 0x10002);
    this.itemLoad(1);
    objectClear(this, 2);
    objectClear(this, 3);
    m.w32(TIMER, 0xb4);
    m.add32(A.NEXT_PARAM, 1);
  }

  /** A message screen's two halves: images `first` and first + 1 (items first - 1, first) at y. */
  private message(first: number, y: number, keepY1: boolean): void {
    const m = this.m;
    m.w32(obj(0) + A.O_X, 0x200000);
    m.w32(obj(0) + A.O_Y, y);
    m.w32(obj(0) + A.O_IMAGE, 0x10000 + first);
    this.itemLoad(first - 1);
    m.w32(obj(1) + A.O_X, 0xa00000);
    if (keepY1) m.w32(obj(0) + A.O_Y, y);
    else m.w32(obj(1) + A.O_Y, y);
    m.w32(obj(1) + A.O_IMAGE, 0x10001 + first);
    this.itemLoad(first);
  }

  /** Object 3: the port's mark (image 0x10017 + port) left of the message. */
  private portMark(): void {
    const m = this.m;
    m.w32(obj(3) + A.O_IMAGE, m.s32(CARD_PORT) + 0x10017);
    m.w32(obj(3) + A.O_X, m.s32(obj(0) + A.O_X) - 0x110000);
    m.w32(obj(3) + A.O_Y, m.s32(obj(0) + A.O_Y));
  }

  /** The Yes/No cursor (object 2): Left/Right moves it, otherwise it animates. */
  private cursor(pressed: number): void {
    const m = this.m;
    const c = obj(2);
    if (pressed & LEFT_RIGHT) {
      const sel = m.u32(c + A.O_4C) ^ 1;
      m.w32(c + A.O_4C, sel);
      m.w32(c + A.O_X, m.s32(CURSOR_X + 4 * sel));
      m.w32(c + A.O_ANIM, sel + 1);
      this.animStart(2);
    } else {
      this.animTick(2);
    }
  }

  /**
   * FUN_800964EC + FUN_80095FEC: decodes item n of SW_ONE.BIN (offsets at 0x800AF4E0) and
   * uploads it again. Every SW_ONE image has a VRAM area of its own, uploaded at init, so these
   * uploads change nothing; they aren't reported (the tracer has no item hook for SW_ON, whose
   * calls take the data address rather than the item number).
   */
  private itemLoad(_n: number): void {}

  /** FUN_8009700C: starts object n's animation at its first image. */
  private animStart(n: number): void {
    const m = this.m;
    const o = obj(n);
    const id = m.s32(o + A.O_ANIM);
    if (id === 0) return;
    const rec = m.u32(ANIMS + 4 * id);
    const image = m.s32(rec + 4);
    m.w32(o + A.O_IMAGE, image + 0x10000);
    this.itemLoad(image - 1);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    m.w32(o + A.O_ANIM_FRAME, 0);
  }

  /** FUN_800971A4: object n's animation, one frame. */
  private animTick(n: number): void {
    const m = this.m;
    const o = obj(n);
    const id = m.s32(o + A.O_ANIM);
    if (id === 0) return;
    const rec = m.u32(ANIMS + 4 * id);
    if (m.add32(o + A.O_ANIM_TIMER, -1) >= 1) return;
    const f = m.s32(o + A.O_ANIM_FRAME);
    m.w32(o + A.O_ANIM_FRAME, f + 1);
    const code = m.s32(rec + 8 + 4 * f);
    if (code === 0xffff) {
      m.w32(o + A.O_ANIM, 0);
      return;
    }
    if (code === 0xfffe) m.w32(o + A.O_ANIM_FRAME, 0);
    m.w32(o + A.O_ANIM_TIMER, m.s32(rec));
    const image = m.s32(rec + 4 + 4 * m.s32(o + A.O_ANIM_FRAME));
    m.w32(o + A.O_IMAGE, image + 0x10000);
    this.itemLoad(image - 1);
  }

  // ---- the card routines (PAZLE's in card.ts, at SW_ON's addresses) ----

  /** FUN_800977CC: 1 ready, 0 no card, -1 error, 2 new card (acknowledged), 3 not formatted. */
  private cardCheck(): number {
    const m = this.m;
    m.w32(CARD_CHAN, m.s32(CARD_PORT) << 4);
    const chan = m.s32(CARD_CHAN);
    let e = this.cards.info(chan);
    m.w32(CARD_EVENT, e);
    if (e === 3) {
      this.cards.clear(chan); // _card_clear
      m.w32(CARD_EVENT, 0);
      return 2;
    }
    if (e === 0) {
      e = this.cards.load(chan);
      m.w32(CARD_EVENT, e);
      if (e === 3) return 3;
      if (e === 0) return 1;
    }
    return e === 1 ? -1 : 0;
  }

  private fileName(): number {
    return FILE_NAME + this.m.s32(CARD_PORT) * 0xff;
  }

  /** FUN_80097B24: up to 10 tries to read the file into BUF with a copy whose XOR holds. */
  private cardLoad(): boolean {
    const m = this.m;
    for (let tries = 10; ; ) {
      let ok = false;
      m.w32(IO_COUNT, 0);
      const fd = this.cards.open(this, this.fileName(), 0x10001);
      if (fd !== -1) {
        m.fill(BUF, BLOCK);
        const n = this.cards.transfer(this, fd, BUF, BLOCK, false);
        m.w32(IO_COUNT, n);
        if (n === BLOCK) {
          const c = this.copyCheck();
          if (c === 1) ok = true;
          if (c === 2) {
            this.copy(CHECK2, CHECK1, BLOCK_SIZE + 1); // FUN_80098438
            ok = true;
          }
        }
      }
      this.cards.close(fd);
      tries--;
      if (ok) return true;
      if (tries < 1) return false;
    }
  }

  /** FUN_80097C2C (only step 19 calls it, which is never reached): creates and writes the file. */
  private cardCreate(): number {
    const m = this.m;
    for (let tries = 10; tries > 0; tries--) {
      m.w32(IO_COUNT, 0);
      let fd = this.cards.open(this, this.fileName(), 0x10200);
      m.w32(FD, fd);
      if (fd === -1) continue;
      this.cards.close(fd);
      this.buildHeader();
      this.defaults(); // FUN_80098FA0
      this.copy(HEADER, BUF, 0x200);
      this.copy(PERSIST, COPY1, BLOCK_SIZE);
      this.copy(PERSIST, COPY2, BLOCK_SIZE);
      if (!this.copySeal()) continue;
      fd = this.cards.open(this, this.fileName(), 0x10002);
      m.w32(FD, fd);
      if (fd !== -1) {
        const n = this.cards.transfer(this, fd, BUF, BLOCK, true);
        m.w32(IO_COUNT, n);
        this.cards.close(fd);
        if (n === BLOCK) return 1;
      }
      this.cards.close(m.s32(FD));
      this.cards.remove(this, this.fileName());
    }
    return 0;
  }

  /** FUN_80097F80: the header; the magic is the low bytes of the addresses of "S" and "C". */
  private buildHeader(): void {
    const m = this.m;
    m.w8(HEADER, 0xc8);
    m.w8(HEADER + 1, 0xcc);
    m.w8(HEADER + 2, 0x13);
    m.w8(HEADER + 3, 1);
    this.copy(0x800aed68, HEADER + 4, 0x40);
    m.fill(HEADER + 0x44, 0x1c);
    // FUN_80098044: the icon's CLUT and three frames from TIMs in the program.
    this.copy(0x800aeb28 + 0x14, HEADER + 0x60, 0x20);
    this.copy(0x800aeb28 + 0x40, HEADER + 0x80, 0x80);
    this.copy(0x800aebe8 + 0x40, HEADER + 0x100, 0x80);
    this.copy(0x800aeca8 + 0x40, HEADER + 0x180, 0x80);
  }

  private xor(from: number): number {
    let x = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) x ^= this.m.u8(from + i);
    return x;
  }

  /** FUN_800982B8: both copies' XOR, stored if they agree. */
  private copySeal(): boolean {
    const a = this.xor(COPY1);
    const b = this.xor(COPY2);
    if (a === b) {
      this.m.w8(CHECK1, a);
      this.m.w8(CHECK2, b);
    }
    return a === b;
  }

  /** FUN_800983B4: 1 if the first copy checks, else 2 if the second does, else 0. */
  private copyCheck(): number {
    if (this.xor(COPY1) === this.m.u8(CHECK1)) return 1;
    return this.xor(COPY2) === this.m.u8(CHECK2) ? 2 : 0;
  }

  private copy(from: number, to: number, n: number): void {
    const m = this.m;
    for (let i = 0; i < n; i++) m.w8(to + i, m.u8(from + i));
  }

  /**
   * The main loop's CD watchdog (after PadRead): with its flag set (only format() sets it here),
   * CdReset(0), then a play from the current track's start (track 0 in SW_ON, so a position
   * computed from the table entry before the first) to its end: the drive starts playing. Only
   * the variables are kept; the CD itself isn't modelled for these programs.
   */
  private cdWatchdog(): void {
    const m = this.m;
    if (m.s32(CD_RESTART) === 0) return;
    m.w32(CD_RESTART, 0);
    m.w32(CD_RESET_RESULT, 0);
    const track = m.s32(CD_TRACK);
    const start = posToInt(m, CD_TOC + 4 * track);
    const end = (m.s32(CD_TRACKS + (track - 2) * 0xc) + start) | 0;
    m.w32(CD_END, end);
    intToPos(m, end, CD_END_POS);
    // FUN_80094F28(start, end): CdlPlay from start; FUN_80095070: CdlSetloc + CdlPlay.
    m.w32(0x800b5cf0, 0);
    m.w8(0x800b5cd0, 5);
    m.w32(0x800b5ce4, start);
    m.w32(0x800b5ce8, posToInt(m, CD_END_POS));
    m.w32(0x800b5cec, start);
  }
}

const bcd = (b: number) => (b >> 4) * 10 + (b & 0xf);
const toBcd = (n: number) => ((Math.trunc(n / 10) << 4) | n % 10) & 0xff;

/** CdPosToInt: minute, second, sector (BCD) to a sector number. */
function posToInt(m: Program['m'], a: number): number {
  return (bcd(m.u8(a)) * 60 + bcd(m.u8(a + 1))) * 75 + bcd(m.u8(a + 2)) - 150;
}

/** CdIntToPos. */
function intToPos(m: Program['m'], i: number, a: number): void {
  const n = i + 150;
  m.w8(a, toBcd(Math.trunc(n / 4500)));
  m.w8(a + 1, toBcd(Math.trunc(n / 75) % 60));
  m.w8(a + 2, toBcd(n % 75));
}
