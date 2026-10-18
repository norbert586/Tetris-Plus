// SW_ON.EXE (program 1): the copyright screen and the boot-time memory card check
// (docs/re/sw_on.md). One `step` is one iteration of its main loop (0x800957B0); the state
// machine is the table at 0x800940F8, indexed by the parameter word state+0x4C. The card
// check reads the save file into the shared state block (state+0x4AD84, 0x780 bytes) or
// puts the defaults there, and shows the card screens (not inserted, initialize?, unable to
// initialize, insufficient memory, unusable card) when it finds no usable card.
import * as A from '../../core/addr';
import { decodeBase64, type Mem } from '../../core/mem';
import type { Rng } from '../../core/rng';
import type { SoundCall } from '../../core/sound';
import { FCREAT, FREAD, FWRITE, IOE, MemoryCards, NEWCARD, ERROR } from '../../flow/memcard';
import type { Program, Shared } from '../../flow/program';
import { ROM } from './rom';

const S = A.S;
/** SW_ON's BSS, cleared by `start` (0x8009A63C). */
const BSS = 0x800b5c38;
const BSS_END = 0x800bacd4;

// Pads (0x800BACC0, 6 bytes per pad): held, newly pressed.
const PAD_HELD = 0x800bacc2;
const PAD_PRESSED = 0x800bacc4;
const PAD2_HELD = 0x800bacc8;
const PAD2_PRESSED = 0x800bacca;

// Card check state.
const SLOT = 0x800b682c; // slot being checked: 0 or 1
const SLOT_RESULT = 0x800b8928; // [2] each slot's check result
const CARD_RESULT = 0x800b6894;
const USED_BLOCKS = 0x800b6890;
const CHAN = 0x800b8924; // slot << 4
const LAST_EVENT = 0x800b5c58;
const READ_COUNT = 0x800b6600;
const FD = 0x800b6774;
const FORMAT_RESULT = 0x800b5d04; // also the main loop's "reset the CD" flag
const BUFFER = 0x800b690c; // the save file (8 KB): header 0x200, then copy A and copy B
const SUM_A = 0x800b6b0c; // copy A's checksum, then copy A (0x780 bytes)
const SUM_B = 0x800b728d; // copy B's checksum, then copy B
const COPY_A = SUM_A + 1;
const COPY_B = SUM_B + 1;
const SAVE = S + 0x4ad84; // the saved block in the shared state (0x780 bytes)
const SAVE_SIZE = 0x780;
const HEADER = 0x800ba148; // the file header FUN_80097F80 builds (0x200 bytes)

const TIMER = S + 0x1fd0c;
const NO_SAVE = S + 0x4b538;
const CURSOR_X = 0x80094188; // [2] the yes/no cursor's x (16.16)
const ANIMS = 0x800af598; // animation scripts by id
const VOLUME_TABLE = 0x800af0a8; // CD volume by the music volume setting (state+0x4B4FF)

/** Sprite objects (state+0x5C, 0x7C bytes each) and their fields. */
const OBJ_COUNT = 0x41a;
const obj = (n: number) => S + 0x5c + n * 0x7c;
const O_X = 0x00;
const O_Y = 0x04;
const O_IMAGE = 0x24;
const O_ANIM = 0x2c;
const O_ANIM_TIMER = 0x30;
const O_ANIM_INDEX = 0x34;
const O_CURSOR = 0x4c;

/** The save file's name and the card paths, by slot. */
const FILE_NAME = ['bu00:baslus-00338', 'bu10:baslus-00338'];
const CARD_ALL = ['bu00:*', 'bu10:*'];

let rom: { address: number; bytes: Uint8Array }[] | null = null;

export class SwOn implements Program {
  readonly name = 'SW_ON' as const;
  readonly m: Mem;
  readonly rng: Rng;
  readonly cards: MemoryCards;
  tick = 0;
  uploads: number[] = [];
  sound: SoundCall[] = [];
  /** Box fills sorted during the logic this tick (the fade): their r=g=b. */
  fades: number[] = [];
  /** Vblanks the tick's VSync(n) waits and card calls took on the original (informative). */
  vblanks = 0;
  /** The main loop's tail reset the CD this tick (after a format; see step). */
  cdReset = false;

  constructor(shared: Shared) {
    this.m = shared.m;
    this.rng = shared.rng;
    this.cards = shared.cards ?? new MemoryCards();
    rom ??= ROM.map((r) => ({ address: r.address, bytes: decodeBase64(r.base64) }));
    this.m.loadImage(rom);
    this.m.fill(BSS, BSS_END - BSS);
    // main before its loop: the sound setup's CD volume (SsSetSerialVol); exit flag cleared.
    this.sound.push({ kind: 'cdvol', vol: this.m.s16(VOLUME_TABLE + 2 * this.m.u8(S + 0x4b4ff)) });
    this.m.w32(A.EXIT_FLAG, 0);
  }

  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  step(pad: number): void {
    const m = this.m;
    this.rng.calls = 0;
    this.cdReset = false;
    if (this.tick > 0) {
      this.sound = [];
      this.padRead(pad);
      // The main loop's tail: a format's result doubles as the "reset the CD" flag
      // (0x800B5D04): CdReset(0), and once it succeeds the flag is cleared and the CD is told
      // to play from the TOC entry of track 0x800B5CDC (FUN_80094F28; docs/re/sw_on.md §5).
      if (m.s32(FORMAT_RESULT) !== 0) {
        m.w32(FORMAT_RESULT, 0);
        this.cdReset = true;
      }
      this.rng.next();
      if (this.exited) return;
    }
    this.uploads = [];
    this.fades = [];
    this.vblanks = 0;
    this.tick++;
    m.add32(A.COUNTER, 1);
    this.cards.vblanks = 0;
    STATES[m.s32(S + 0x4c)](this);
    this.vblanks += this.cards.vblanks;
  }

  private padRead(word: number): void {
    const m = this.m;
    const p1 = word & 0xffff;
    const p2 = word >>> 16;
    m.w16(PAD_PRESSED, (m.u16(PAD_HELD) ^ p1) & p1);
    m.w16(PAD_HELD, p1);
    m.w16(PAD2_PRESSED, (m.u16(PAD2_HELD) ^ p2) & p2);
    m.w16(PAD2_HELD, p2);
  }

  traceRow(): Record<string, number | number[]> {
    const m = this.m;
    const words = (a: number, n: number, stride = 4) => Array.from({ length: n }, (_, i) => m.u32(a + i * stride));
    return {
      ctr: m.u32(A.COUNTER),
      seed: this.rng.seed >>> 0,
      next: m.u32(S + 0x48),
      param: m.u32(S + 0x4c),
      phase: m.u32(S + 0x50),
      subphase: m.u32(S + 0x54),
      exit: m.u32(A.EXIT_FLAG),
      scr: words(S + 0x4b508, 2),
      step: words(S + 0x4b510, 2),
      pad: m.u16(PAD_HELD),
      padp: m.u16(PAD_PRESSED),
      slot: m.u32(SLOT),
      slotres: [m.s32(SLOT_RESULT), m.s32(SLOT_RESULT + 4)],
      cardres: m.s32(CARD_RESULT),
      used: m.s32(USED_BLOCKS),
      ev: m.s32(LAST_EVENT),
      timer: m.s32(TIMER),
      nosave: m.s32(NO_SAVE),
      oy: m.s32(S + 0x60),
      oimg: words(S + 0x80, 4, 0x7c),
      cursor: m.s32(S + 0x1a0),
      save: words(SAVE, SAVE_SIZE / 4),
      rand: this.rng.calls,
    };
  }

  // ---- helpers ----

  /** FUN_80095F7C / the inline item_load: decompress an item and upload it (the renderer's). */
  upload(item: number): void {
    this.uploads.push(item);
  }

  advance(): void {
    this.m.add32(S + 0x4c, 1);
  }

  setParam(v: number): void {
    this.m.w32(S + 0x4c, v);
  }

  pressed(): number {
    return this.m.u16(PAD_PRESSED);
  }
}

// ---- objects ----

function objectClear(g: SwOn, n: number): void {
  g.m.fill(obj(n), 0x7c);
}

function objectsClearAll(g: SwOn): void {
  for (let n = 0; n < OBJ_COUNT; n++) objectClear(g, n);
}

/** Puts image `image` (1-based item) at (x, y) (16.16) and uploads its item. */
function objectPut(g: SwOn, n: number, image: number, x: number, y: number): void {
  const m = g.m;
  m.w32(obj(n) + O_X, x);
  m.w32(obj(n) + O_Y, y);
  m.w32(obj(n) + O_IMAGE, 0x10000 + image);
  g.upload(image - 1);
}

/** FUN_8009700C: starts the object's animation (its first frame uploaded). */
function animStart(g: SwOn, n: number): void {
  const m = g.m;
  const o = obj(n);
  const id = m.s32(o + O_ANIM);
  if (id === 0) return;
  const script = m.u32(ANIMS + 4 * id);
  const image = m.s32(script + 4);
  m.w32(o + O_IMAGE, image + 0x10000);
  g.upload(image - 1);
  m.w32(o + O_ANIM_TIMER, m.s32(script));
  m.w32(o + O_ANIM_INDEX, 0);
}

/** FUN_800971A4: advances the object's animation (each new frame uploaded). */
function animTick(g: SwOn, n: number): void {
  const m = g.m;
  const o = obj(n);
  const id = m.s32(o + O_ANIM);
  if (id === 0) return;
  const script = m.u32(ANIMS + 4 * id);
  const timer = m.add32(o + O_ANIM_TIMER, -1);
  if (timer >= 1) return;
  const index = m.s32(o + O_ANIM_INDEX);
  m.w32(o + O_ANIM_INDEX, index + 1);
  const next = m.s32(script + 4 * (index + 2));
  if (next === 0xffff) {
    m.w32(o + O_ANIM, 0);
    return;
  }
  if (next === 0xfffe) m.w32(o + O_ANIM_INDEX, 0);
  m.w32(o + O_ANIM_TIMER, m.s32(script));
  const image = m.s32(script + 4 * (m.s32(o + O_ANIM_INDEX) + 1));
  m.w32(o + O_IMAGE, image + 0x10000);
  g.upload(image - 1);
}

/** The "SLOT 1/2" label beside a card screen's text (object 3). */
function slotLabel(g: SwOn): void {
  const m = g.m;
  m.w32(obj(3) + O_IMAGE, m.s32(SLOT) + 0x10017);
  m.w32(obj(3) + O_X, m.s32(obj(0) + O_X) - 0x110000);
  m.w32(obj(3) + O_Y, m.s32(obj(0) + O_Y));
}

// ---- the save data ----

function copy(m: Mem, to: number, from: number, n: number): void {
  m.bytes.copyWithin(to & 0x1fffff, from & 0x1fffff, (from & 0x1fffff) + n);
}

/** FUN_80098598: the defaults into copy A (best times 9999, then the tables at 0x800AF5A4). */
function saveDefaults(m: Mem): void {
  for (let i = 0; i < 0x6e; i++) m.w16(COPY_A + 2 * i, 9999);
  copy(m, COPY_A + 0xdc, 0x800af5a4, 0x7e);
  copy(m, COPY_A + 0x15a, 0x800af624, 0x60e);
  copy(m, COPY_A + 0x768, 0x800afc34, 0x18);
}

/** The defaults, as state 0 and the card check without a save file put them in place. */
function defaultsToState(m: Mem): void {
  saveDefaults(m);
  copy(m, SAVE, COPY_A, SAVE_SIZE); // FUN_800989B4(0)
  for (let i = 0; i < 0x6e; i++) m.w16(SAVE + 2 * i, 9999);
  copy(m, COPY_A, SAVE, 0xdc);
}

function xorSum(m: Mem, a: number): number {
  let x = 0;
  for (let i = 0; i < SAVE_SIZE; i++) x ^= m.u8(a + i);
  return x;
}

/** FUN_800983B4: 1 if copy A is intact, else 2 if copy B is, else 0. */
function saveCheck(m: Mem): number {
  if (xorSum(m, COPY_A) === m.u8(SUM_A)) return 1;
  return xorSum(m, COPY_B) === m.u8(SUM_B) ? 2 : 0;
}

/**
 * FUN_80097B24: reads the save file into the buffer, up to 10 tries; 1 if a copy is intact
 * (copy B is copied over A if only B is). `s2` is the caller's $s2, which the routine tests
 * without setting it first (the card check's: 0x800B8928, never 1).
 */
function saveRead(g: SwOn): number {
  const m = g.m;
  const cards = g.cards;
  let ok = 0;
  for (let tries = 10; ; ) {
    m.w32(READ_COUNT, 0);
    const fd = cards.open(FILE_NAME[m.s32(SLOT)], (1 << 16) | FREAD);
    if (fd !== -1) {
      m.fill(BUFFER, 0x2000);
      const data = new Uint8Array(0x2000);
      const n = cards.read(fd, data);
      m.bytes.set(data.subarray(0, Math.max(0, n)), BUFFER & 0x1fffff);
      m.w32(READ_COUNT, n);
      if (n === 0x2000) {
        const c = saveCheck(m);
        if (c === 1) ok = 1;
        if (c === 2) {
          ok = 1;
          copy(m, SUM_A, SUM_B, SAVE_SIZE + 1); // FUN_80098438
        }
      }
    }
    cards.close(fd);
    tries--;
    if (ok === 1) return 1;
    if (tries < 1) return 0;
  }
}

/** FUN_800977CC: the card in the slot: 1 usable, 0 none, -1 error, 2 new card (cleared), 3 not formatted. */
function cardStatus(g: SwOn): number {
  const m = g.m;
  const chan = m.s32(SLOT) << 4;
  m.w32(CHAN, chan);
  const ev = g.cards.info(chan);
  m.w32(LAST_EVENT, ev);
  if (ev === NEWCARD) {
    m.w32(LAST_EVENT, g.cards.clear(chan));
    return 2;
  }
  if (ev === IOE) {
    const ev2 = g.cards.load(chan);
    m.w32(LAST_EVENT, ev2);
    if (ev2 === NEWCARD) return 3;
    if (ev2 === IOE) return 1;
  }
  return m.s32(LAST_EVENT) === ERROR ? -1 : 0;
}

/** FUN_8009832C's loop, inline in the card check: blocks in use, rounded up. */
function usedBlocks(g: SwOn): number {
  let bytes = 0x1fff;
  for (let e = g.cards.firstfile(CARD_ALL[g.m.s32(SLOT)]); e; e = g.cards.nextfile()) bytes = (bytes + e.size) | 0;
  if (bytes < 0) bytes += 0x1fff;
  return bytes >> 13;
}

/** FUN_80097F80 and FUN_80098044: the file header (title, icon) at 0x800BA148. */
function buildHeader(m: Mem): void {
  // The magic should be "SC"; the code stores the low bytes of two string addresses instead.
  m.w8(HEADER, 0xc8);
  m.w8(HEADER + 1, 0xcc);
  m.w8(HEADER + 2, 0x13); // icon: 3 frames

  m.w8(HEADER + 3, 1);
  copy(m, HEADER + 4, 0x800aed68, 0x40);
  m.fill(HEADER + 0x44, 0x1c);
  // The icon's palette and pixels (FUN_80098044's three tables).
  copy(m, HEADER + 0x60, 0x800aeb28 + 0x14, 0x20);
  copy(m, HEADER + 0x80, 0x800aeb28 + 0x40, 0x80);
  copy(m, HEADER + 0x100, 0x800aebe8 + 0x40, 0x80);
  copy(m, HEADER + 0x180, 0x800aeca8 + 0x40, 0x80);
}

/**
 * FUN_80097C2C: creates the save file and writes the defaults to it, up to 10 tries; 1 if
 * written. (State 19, which no path of the state machine reaches.)
 */
function saveCreate(g: SwOn): number {
  const m = g.m;
  const cards = g.cards;
  const name = FILE_NAME[m.s32(SLOT)];
  for (let tries = 10; tries > 0; tries--) {
    m.w32(READ_COUNT, 0);
    const fd = cards.open(name, (1 << 16) | FCREAT);
    m.w32(FD, fd);
    if (fd === -1) continue;
    cards.close(fd);
    buildHeader(m);
    defaultsToState(m); // FUN_80098FA0
    copy(m, BUFFER, HEADER, 0x200);
    copy(m, COPY_A, SAVE, SAVE_SIZE);
    copy(m, COPY_B, SAVE, SAVE_SIZE);
    const sum = xorSum(m, COPY_A);
    if (sum === xorSum(m, COPY_B)) {
      m.w8(SUM_A, sum);
      m.w8(SUM_B, sum);
      const wfd = cards.open(name, (1 << 16) | FWRITE);
      m.w32(FD, wfd);
      if (wfd !== -1) {
        const n = cards.write(wfd, m.bytes.slice(BUFFER & 0x1fffff, (BUFFER & 0x1fffff) + 0x2000));
        m.w32(READ_COUNT, n);
        cards.close(wfd);
        if (n === 0x2000) return 1;
      }
      cards.close(m.s32(FD));
      cards.delete(name);
    }
  }
  return 0;
}

// ---- the states (0x800940F8) ----

const nothing = () => {};

/** A card screen: the two halves of its text (items, 1-based) at the usual place. */
function screen(g: SwOn, left: number, right: number): void {
  objectPut(g, 0, left, 0x200000, 0x180000);
  objectPut(g, 1, right, 0xa00000, 0x180000);
}

/** Cross: check again (state 0); Circle: go on without the card (28). */
function retryOrCancel(g: SwOn): void {
  if (g.pressed() & 0x40) g.setParam(0);
  else if (g.pressed() & 0x20) g.setParam(0x1c);
}

/** The yes/no cursor: Left/Right move it, else its animation runs. */
function yesNo(g: SwOn, cross: (yes: boolean) => number, circle: number): void {
  const m = g.m;
  const p = g.pressed();
  if (p & 0x40) {
    g.setParam(cross(m.s32(obj(2) + O_CURSOR) === 0));
  } else if (p & 0x20) {
    g.setParam(circle);
  } else if (p & 0xa000) {
    const c = m.s32(obj(2) + O_CURSOR) ^ 1;
    m.w32(obj(2) + O_CURSOR, c);
    m.w32(obj(2) + O_X, m.s32(CURSOR_X + 4 * c));
    m.w32(obj(2) + O_ANIM, c + 1);
    animStart(g, 2);
  } else {
    animTick(g, 2);
  }
}

const STATES: ((g: SwOn) => void)[] = [
  // 0 (0x80099178): objects cleared, the defaults in place, no save yet.
  (g) => {
    const m = g.m;
    objectsClearAll(g);
    m.w32(SLOT, 0);
    m.w32(0x800b6904, 0);
    m.w32(SLOT_RESULT + 4, 0);
    m.w32(SLOT_RESULT, 0);
    m.w32(NO_SAVE, 1);
    defaultsToState(m);
    m.w32(0x800b6860, 0);
    g.advance();
  },
  // 1
  (g) => g.advance(),
  // 2 (0x80099348): VSync(60).
  (g) => {
    g.vblanks += 60;
    g.advance();
  },
  // 3 (0x80099384): the card check, one slot per tick.
  (g) => {
    const m = g.m;
    let r = 0;
    for (let n = 1; ; n++) {
      r = cardStatus(g);
      m.w32(SLOT_RESULT + 4 * m.s32(SLOT), r);
      if (r >= 0 || n >= 7) break;
    }
    if (r === 2) return;
    if (r === 1) {
      const ok = saveRead(g) === 1 ? 1 : 0;
      m.w32(CARD_RESULT, ok);
      if (ok === 1) {
        copy(m, SAVE, COPY_A, SAVE_SIZE);
        g.setParam(4);
        return;
      }
      defaultsToState(m);
      const used = usedBlocks(g);
      m.w32(USED_BLOCKS, used);
      if (used < 15) {
        g.setParam(4);
        return;
      }
    }
    const slot = m.s32(SLOT) ^ 1;
    m.w32(SLOT, slot);
    if (slot === 1) return;
    const r1 = m.s32(SLOT_RESULT);
    const r2 = m.s32(SLOT_RESULT + 4);
    if (r1 === 0) {
      if (r2 === 0) {
        m.w32(SLOT, 0);
        g.setParam(8);
      } else if (r2 === -1) {
        m.w32(SLOT, 1);
        g.setParam(0x20);
      } else if (r2 === 1) {
        m.w32(SLOT, 1);
        g.setParam(0x18);
      } else if (r2 === 3) {
        m.w32(SLOT, 1);
        g.setParam(0xc);
      }
      return;
    }
    m.w32(SLOT, 0);
    g.setParam(r1 === 3 ? 0xc : r1 === 1 ? 0x18 : 0x20);
  },
  // 4 (0x800997A8): the copyright text below the screen.
  (g) => {
    const m = g.m;
    objectPut(g, 0, 1, 0, 0xf00000);
    objectPut(g, 1, 2, 0xa00000, 0xf00000);
    objectClear(g, 2);
    objectClear(g, 3);
    m.w32(TIMER, 0xb4);
    g.advance();
  },
  // 5 (0x800998B8): scrolls up 2 lines a tick, then stays 180 ticks.
  (g) => {
    const m = g.m;
    if (m.s32(obj(0) + O_Y) < 1) {
      if (m.add32(TIMER, -1) === 0) {
        m.w32(TIMER, 0x40);
        g.advance();
      }
    } else {
      m.add32(obj(0) + O_Y, -0x20000);
      m.add32(obj(1) + O_Y, -0x20000);
    }
  },
  // 6 (0x80099934): fades to black over 64 ticks.
  (g) => {
    const m = g.m;
    const t = m.add32(TIMER, -1);
    if (t === 0) {
      objectsClearAll(g);
      g.advance();
    } else {
      g.fades.push(Math.trunc(((0x40 - t) * 0xff) / 0x40) & 0xff);
    }
  },
  // 7 (0x80099A5C): on to TIT_DEMO.
  (g) => {
    const m = g.m;
    m.w32(NO_SAVE, 1);
    m.w32(A.EXIT_FLAG, 1);
    m.w32(S + 0x48, 2);
    m.w32(S + 0x4c, 0);
    m.w32(S + 0x50, 0);
    m.w32(S + 0x54, 0);
  },
  // 8 (0x80099A98): "memory card is not inserted".
  (g) => {
    screen(g, 3, 4);
    g.advance();
  },
  retryOrCancel, // 9
  nothing,
  nothing,
  // 12 (0x80099BE8): "memory card is not initialized: initialize?", yes/no.
  (g) => {
    const m = g.m;
    screen(g, 7, 8);
    m.w32(obj(2) + O_CURSOR, 1);
    m.w32(obj(2) + O_Y, 0x950000);
    m.w32(obj(2) + O_X, m.s32(CURSOR_X + 4));
    m.w32(obj(2) + O_ANIM, m.s32(obj(2) + O_CURSOR) + 1);
    animStart(g, 2);
    slotLabel(g);
    g.advance();
  },
  // 13 (0x80099D54): Cross on yes formats (16), on no shows the unusable-card screen (32).
  (g) => yesNo(g, (yes) => (yes ? 0x10 : 0x20), 0x1c),
  nothing,
  nothing,
  // 16 (0x80099E54): checks the card again, then "initializing...".
  (g) => {
    const m = g.m;
    const r = cardStatus(g);
    m.w32(CARD_RESULT, r);
    if (r === 0) {
      objectClear(g, 2);
      objectClear(g, 3);
      g.setParam(8);
    } else if (r !== 2) {
      objectPut(g, 0, 0xb, 0x200000, 0x180000);
      m.w32(obj(1) + O_X, 0xa00000);
      m.w32(obj(0) + O_Y, 0x180000); // (sic: object 0's y again, not object 1's)
      m.w32(obj(1) + O_IMAGE, 0x1000c);
      g.upload(0xb);
      objectClear(g, 2);
      slotLabel(g);
      g.advance();
    }
  },
  (g) => g.advance(), // 17
  // 18 (0x80099FDC): format; on to the copyright screen, or "unable to initialize" (20).
  (g) => {
    const m = g.m;
    const r = g.cards.format(CARD_ALL[m.s32(SLOT)]);
    m.w32(FORMAT_RESULT, r);
    m.w32(CARD_RESULT, r);
    g.setParam(r === 0 ? 0x14 : 4);
  },
  // 19 (0x8009A048): create the save file (unreachable).
  (g) => {
    const m = g.m;
    const r = saveCreate(g);
    m.w32(CARD_RESULT, r);
    if (r !== 0) m.w32(NO_SAVE, 0);
    g.setParam(r === 0 ? 0x14 : 4);
  },
  // 20 (0x8009A0A4): "unable to initialize memory card".
  (g) => {
    screen(g, 0xd, 0xe);
    slotLabel(g);
    g.advance();
  },
  retryOrCancel, // 21
  nothing,
  nothing,
  // 24 (0x8009A21C): "insufficient memory".
  (g) => {
    screen(g, 0xf, 0x10);
    slotLabel(g);
    g.advance();
  },
  retryOrCancel, // 25
  nothing,
  nothing,
  // 28 (0x8009A394): no saving this session.
  (g) => {
    g.m.w32(NO_SAVE, 1);
    g.setParam(4);
  },
  // 29 (0x8009A3C4): a yes/no no state leads to (Japanese "start with defaults?").
  (g) => yesNo(g, (yes) => (yes ? 4 : 0), 0),
  nothing,
  nothing,
  // 32 (0x8009A4BC): "you won't be able to save... replace the card".
  (g) => {
    screen(g, 9, 0xa);
    objectClear(g, 2);
    slotLabel(g);
    g.advance();
  },
  retryOrCancel, // 33
  nothing,
  nothing,
];
