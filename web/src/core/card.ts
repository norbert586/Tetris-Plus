// Memory cards (docs/re/shell.md §2). The original saves its persistent block (state+0x4AD84,
// 0x780 bytes: best times, rankings, the three save slots, a 0x60E-byte block and the options)
// to one 8 KB file, "BASLUS-00338", through libcard and the BIOS file functions. The port keeps
// the game's card code (PAZLE.EXE 0x800B5B6C-0x800B7714) and answers its BIOS calls from a
// model of the card: a 128 KB image in the standard layout (frame 0 "MC", directory frames 1-15,
// blocks 1-15), so a card can be exchanged with emulators as a .mcd file.
//
// Card I/O blocks inside one logic tick in the original (TestEvent loops), so it costs no ticks.
import * as A from './addr';
import type { Game } from './game';
import type { Mem } from './mem';

/** What the BIOS calls need of a program: its memory (any program with card code, not only PAZLE). */
export type HasMem = { m: Mem };

export const CARD_SIZE = 0x20000;
const FRAME = 0x80;
const BLOCK = 0x2000;

/** One memory card: its 128 KB of flash and the "new card" flag a real card raises on insertion. */
export class MemoryCard {
  data: Uint8Array;
  /** Set until the first write after the card is inserted (libcard reports EvSpNEW). */
  fresh: boolean;
  /** Counts writes, so the shell knows when to store the card. */
  version = 0;

  /**
   * `fresh` defaults to the flag a card has at power-on in the emulator: set on an unformatted
   * card, clear on a formatted one (SW_ON's first _card_info reports a new card only for the
   * unformatted card; movie sw-on-format, docs/re/shell.md §7).
   */
  constructor(data?: Uint8Array, fresh?: boolean) {
    this.data = data ? data.slice() : MemoryCard.blank();
    this.fresh = fresh ?? !this.formatted();
  }

  /** A formatted, empty card, byte for byte as PCSX-Redux creates one. */
  static blank(): Uint8Array {
    const d = new Uint8Array(CARD_SIZE);
    formatImage(d);
    return d;
  }

  formatted(): boolean {
    return this.data[0] === 0x4d && this.data[1] === 0x43;
  }
}

function frameChecksum(d: Uint8Array, frame: number): void {
  let x = 0;
  for (let i = 0; i < FRAME - 1; i++) x ^= d[frame * FRAME + i];
  d[frame * FRAME + FRAME - 1] = x;
}

function formatImage(d: Uint8Array): void {
  d.fill(0);
  d[0] = 0x4d;
  d[1] = 0x43;
  frameChecksum(d, 0);
  for (let f = 1; f < 16; f++) {
    const o = f * FRAME;
    d[o] = 0xa0;
    d[o + 8] = 0xff;
    d[o + 9] = 0xff;
    frameChecksum(d, f);
  }
  for (let f = 16; f < 36; f++) {
    const o = f * FRAME;
    d.fill(0xff, o, o + 4);
    d[o + 8] = 0xff;
    d[o + 9] = 0xff;
    frameChecksum(d, f);
  }
  d.set(d.subarray(0, FRAME), 63 * FRAME);
}

// ---- the BIOS file functions on bu00:/bu10: (B0 tables; only what the game calls) ----

const FREAD = 1;
const FWRITE = 2;
const FCREAT = 0x200;

interface Fd {
  card: MemoryCard;
  first: number; // directory entry (1-15) of the file's first block
  pos: number;
}

/** Splits "bu00:NAME" / "bu10:NAME" into the port (0 or 1) and the file name. */
function device(g: HasMem, path: number): { port: number; name: string } | null {
  let s = '';
  for (let a = path; g.m.u8(a) !== 0 && s.length < 64; a++) s += String.fromCharCode(g.m.u8(a));
  const m = /^bu([01])0:(.*)$/.exec(s);
  return m ? { port: Number(m[1]), name: m[2] } : null;
}

function entryName(d: Uint8Array, e: number): string {
  let s = '';
  for (let i = 0; i < 20 && d[e * FRAME + 0x0a + i] !== 0; i++) s += String.fromCharCode(d[e * FRAME + 0x0a + i]);
  return s;
}

const entryState = (d: Uint8Array, e: number) => d[e * FRAME];

function findFile(d: Uint8Array, name: string): number {
  for (let e = 1; e < 16; e++) if (entryState(d, e) === 0x51 && entryName(d, e) === name) return e;
  return -1;
}

/** The blocks of the file starting at entry e, following the directory's links. */
function fileBlocks(d: Uint8Array, e: number): number[] {
  const out = [e];
  for (let next = d[e * FRAME + 8] | (d[e * FRAME + 9] << 8); next !== 0xffff && out.length < 15; ) {
    out.push(next + 1);
    const o = (next + 1) * FRAME;
    next = d[o + 8] | (d[o + 9] << 8);
  }
  return out;
}

function writeEntry(d: Uint8Array, e: number, state: number, size: number, next: number, name: string): void {
  const o = e * FRAME;
  d.fill(0, o, o + FRAME);
  d[o] = state;
  new DataView(d.buffer, d.byteOffset).setUint32(o + 4, size, true);
  d[o + 8] = next & 0xff;
  d[o + 9] = (next >> 8) & 0xff;
  for (let i = 0; i < name.length && i < 20; i++) d[o + 0x0a + i] = name.charCodeAt(i);
  frameChecksum(d, e);
}

/** The card behind the BIOS calls: the game's two ports, each holding a card or nothing. */
export class CardSlots {
  cards: (MemoryCard | null)[];
  private fds = new Map<number, Fd>();
  private nextFd = 2;
  private dirent: { port: number; pattern: string; at: number } | null = null;

  constructor(cards: (MemoryCard | null)[] = [new MemoryCard(), null]) {
    this.cards = cards;
  }

  /** open(path, mode): mode bit 0x200 creates a file of mode >> 16 blocks. Returns fd or -1. */
  open(g: HasMem, path: number, mode: number): number {
    const dev = device(g, path);
    const card = dev && this.cards[dev.port];
    if (!dev || !card || !card.formatted()) return -1;
    const d = card.data;
    let first = findFile(d, dev.name);
    if (mode & FCREAT) {
      if (first >= 0) return -1;
      const blocks = Math.max(1, mode >>> 16);
      const free: number[] = [];
      for (let e = 1; e < 16 && free.length < blocks; e++) if ((entryState(d, e) & 0xf0) === 0xa0) free.push(e);
      if (free.length < blocks) return -1;
      free.forEach((e, i) => {
        const state = i === 0 ? 0x51 : i === blocks - 1 ? 0x53 : 0x52;
        const next = i === blocks - 1 ? 0xffff : free[i + 1] - 1;
        writeEntry(d, e, state, i === 0 ? blocks * BLOCK : 0, next, i === 0 ? dev.name : '');
      });
      // The emulator's BIOS (OpenBIOS) also writes frame 0 over frame 63 when it creates a file:
      // a formatted card whose frame 63 held the _card_clear dummy write's bytes has frame 0
      // there after SELECT creates its save file (movie select-card-saved; checked with a card
      // from sw-on-format, where format() alone leaves frame 63 as it was).
      d.copyWithin(63 * FRAME, 0, FRAME);
      card.version++;
      first = free[0];
    } else if (first < 0 || !(mode & (FREAD | FWRITE))) {
      return -1;
    }
    const fd = this.nextFd;
    this.nextFd = fd === 15 ? 2 : fd + 1;
    this.fds.set(fd, { card, first, pos: 0 });
    return fd;
  }

  /** read(fd, buffer, length) / write(fd, buffer, length): whole 128-byte sectors, at the position. */
  transfer(g: HasMem, fd: number, buf: number, len: number, write: boolean): number {
    const f = this.fds.get(fd);
    if (!f || len % FRAME !== 0) return -1;
    const blocks = fileBlocks(f.card.data, f.first);
    let done = 0;
    while (done < len && f.pos < blocks.length * BLOCK) {
      const at = blocks[Math.floor(f.pos / BLOCK)] * BLOCK + (f.pos % BLOCK);
      const n = Math.min(FRAME, len - done);
      for (let i = 0; i < n; i++) {
        if (write) f.card.data[at + i] = g.m.u8(buf + done + i);
        else g.m.w8(buf + done + i, f.card.data[at + i]);
      }
      if (write) {
        f.card.fresh = false;
        f.card.version++;
      }
      f.pos += n;
      done += n;
    }
    return done;
  }

  close(fd: number): number {
    return this.fds.delete(fd) ? fd : -1;
  }

  /** delete(path): marks the file's directory entries deleted (0x51-0x53 to 0xA1-0xA3). */
  remove(g: HasMem, path: number): number {
    const dev = device(g, path);
    const card = dev && this.cards[dev.port];
    if (!dev || !card) return 0;
    const e = findFile(card.data, dev.name);
    if (e < 0) return 0;
    for (const b of fileBlocks(card.data, e)) {
      card.data[b * FRAME] = 0xa0 | (card.data[b * FRAME] & 0x0f);
      frameChecksum(card.data, b);
    }
    card.fresh = false;
    card.version++;
    return 1;
  }

  /** firstfile(pattern, dirent) / nextfile(dirent): the files in use; fills name, attr, size, head. */
  firstFile(g: HasMem, path: number, dirent: number): number {
    const dev = device(g, path);
    if (!dev || !this.cards[dev.port]) return 0;
    this.dirent = { port: dev.port, pattern: dev.name, at: 1 };
    return this.nextFile(g, dirent);
  }

  nextFile(g: HasMem, dirent: number): number {
    const it = this.dirent;
    const card = it && this.cards[it.port];
    if (!it || !card) return 0;
    const d = card.data;
    const re = new RegExp('^' + it.pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    for (; it.at < 16; it.at++) {
      const e = it.at;
      if (entryState(d, e) !== 0x51 || !re.test(entryName(d, e))) continue;
      it.at++;
      const m = g.m;
      m.fill(dirent, 0x28);
      const name = entryName(d, e);
      for (let i = 0; i < name.length; i++) m.w8(dirent + i, name.charCodeAt(i));
      m.w32(dirent + 0x14, 0x51);
      m.w32(dirent + 0x18, new DataView(d.buffer, d.byteOffset).getUint32(e * FRAME + 4, true));
      m.w32(dirent + 0x20, e);
      return dirent;
    }
    return 0;
  }

  /** format("bu00:"): 1 on success. */
  format(g: HasMem, path: number): number {
    const dev = device(g, path);
    const card = dev && this.cards[dev.port];
    if (!card) return 0;
    // The BIOS's format doesn't write frame 63 (the write-test frame; a blank card as
    // PCSX-Redux creates one has frame 0 there): movie sw-on-format.
    const test = card.data.slice(63 * FRAME, 64 * FRAME);
    formatImage(card.data);
    card.data.set(test, 63 * FRAME);
    card.fresh = false;
    card.version++;
    return 1;
  }

  /** libcard _card_info(chan): 0 IOE, 2 TIMEOUT (no card), 3 NEWCARD. */
  info(chan: number): number {
    const card = this.cards[chan >> 4];
    if (!card) return 2;
    return card.fresh ? 3 : 0;
  }

  /** libcard _card_load(chan): 0 IOE, 2 TIMEOUT, 3 NEWCARD (not formatted). */
  load(chan: number): number {
    const card = this.cards[chan >> 4];
    if (!card) return 2;
    return card.formatted() ? 0 : 3;
  }

  /**
   * SW_ON's libcard _card_clear(chan): a dummy write of libcard's 128-byte buffer to frame 63
   * that clears the card's new flag. The frame then holds 2 at 0x60 and 0xFF at 0x68, zeros
   * elsewhere (the card images after movies sw-on-format and sw-on-noformat).
   */
  clear(chan: number): void {
    const card = this.cards[chan >> 4];
    if (!card) return;
    card.data.fill(0, 63 * FRAME, 64 * FRAME);
    card.data[63 * FRAME + 0x60] = 2;
    card.data[63 * FRAME + 0x68] = 0xff;
    card.fresh = false;
    card.version++;
  }

  /** _new_card(); _card_write(chan, 0x3F, 0): a dummy write that clears the card's new flag. */
  acknowledge(chan: number): void {
    const card = this.cards[chan >> 4];
    if (card) card.fresh = false;
  }
}

// ---- PAZLE.EXE's card routines ----

const CARD_PORT_CUR = 0x800ee9a0; // the port FUN_800b6074 checks (0 or 1)
const CARD_CHAN = 0x800f1284; // port << 4
const CARD_EVENT = 0x800ed2e8; // the last event index FUN_800b5ebc returned
export const CARD_PORT = 0x800f2d1c; // [2] the port each player chose
export const CARD_RESULT = 0x800eeae0;
const IO_COUNT = 0x800ee3bc; // bytes read or written by the last call
const FD = 0x800ee708;
const FILE_NAME = 0x800d5244; // "bu00:baslus-00338", 0xFF bytes per port
const FILE_PATTERN = 0x800d5444; // "bu00:*", 0x80 bytes per port
const DIRENT = 0x800ee538;
export const BUF = 0x800eebbc; // the 8 KB file as read or written
const CHECK1 = BUF + 0x200;
const COPY1 = BUF + 0x201; // the persistent block, then its XOR at COPY2 - 1 and a second copy
const CHECK2 = BUF + 0x981;
const COPY2 = BUF + 0x982;
const HEADER = 0x800f2aec; // the 0x200-byte save header (title, icon) as built by FUN_800b6858
const BLOCK_SIZE = 0x780;
const PERSIST = A.S + 0x4ad84;

/** FUN_800b6074: checks the card in the current port. 1 ready, 0 no card, -1 error, 2 new card, 3 not formatted. */
export function cardCheck(g: Game): number {
  const m = g.m;
  m.w32(CARD_CHAN, m.s32(CARD_PORT_CUR) << 4);
  const chan = m.s32(CARD_CHAN);
  let e = g.cards.info(chan);
  m.w32(CARD_EVENT, e);
  if (e === 3) {
    g.cards.acknowledge(chan);
    m.w32(CARD_EVENT, 0); // FUN_800b5f98: the dummy write's hardware event (IOE)
    return 2;
  }
  if (e === 0) {
    e = g.cards.load(chan);
    m.w32(CARD_EVENT, e);
    if (e === 3) return 3;
    if (e === 0) return 1;
  }
  return e === 1 ? -1 : 0;
}

/** FUN_800b6174: formats the card in the current port. */
export function cardFormat(g: Game): number {
  // format() takes the device name built from the port; the original passes "bu00:" or "bu10:".
  const r = g.cards.format(g, FILE_PATTERN + (g.m.s32(CARD_PORT_CUR) << 7));
  g.m.w32(0x800ed394, r);
  return r;
}

const fileName = (g: Game) => FILE_NAME + g.m.s32(CARD_PORT_CUR) * 0xff;

/** FUN_800b61b4 (FUN_800b61dc): loads the save file into BUF; true if a copy's checksum holds. */
export function cardLoad(g: Game): boolean {
  const m = g.m;
  let ok = false;
  for (let tries = 4; ; ) {
    m.w32(IO_COUNT, 0);
    const fd = g.cards.open(g, fileName(g), 0x10001);
    if (fd !== -1) {
      m.fill(BUF, BLOCK);
      const n = g.cards.transfer(g, fd, BUF, BLOCK, false);
      m.w32(IO_COUNT, n);
      if (n === BLOCK) {
        const c = copyCheck(g);
        if (c === 1) ok = true;
        if (c === 2) {
          ok = true;
          copyRepair(g);
        }
      }
    }
    g.cards.close(fd);
    tries--;
    if (ok) return true;
    if (tries < 1) return false;
  }
}

/** FUN_800b62e8: creates the save file and writes header and block; 1 on success. */
export function cardCreate(g: Game): number {
  const m = g.m;
  for (let tries = 4; tries > 0; tries--) {
    m.w32(IO_COUNT, 0);
    let fd = g.cards.open(g, fileName(g), 0x10200);
    m.w32(FD, fd);
    if (fd === -1) continue;
    g.cards.close(fd);
    buildFile(g);
    if (!copySeal(g)) continue;
    fd = g.cards.open(g, fileName(g), 0x10002);
    m.w32(FD, fd);
    if (fd !== -1) {
      const n = g.cards.transfer(g, fd, BUF, BLOCK, true);
      m.w32(IO_COUNT, n);
      g.cards.close(fd);
      if (n === BLOCK) return 1;
    }
    g.cards.close(m.s32(FD));
    g.cards.remove(g, fileName(g));
  }
  return 0;
}

/** FUN_800b6638: rewrites the existing save file from the state block; 1 on success. */
export function cardRewrite(g: Game): number {
  const m = g.m;
  buildHeader(g);
  copy(m, COPY1, COPY2, BLOCK_SIZE); // the first copy (FUN_800b7714 filled it) is the second too
  for (let tries = 4; ; ) {
    m.w32(IO_COUNT, 0);
    if (copySeal(g)) {
      const fd = g.cards.open(g, fileName(g), 0x10002);
      m.w32(FD, fd);
      if (fd !== -1) {
        const n = g.cards.transfer(g, fd, BUF, BLOCK, true);
        m.w32(IO_COUNT, n);
        if (n === BLOCK) {
          g.cards.close(fd);
          return 1;
        }
      }
      g.cards.close(m.s32(FD));
    }
    if (--tries < 1) return 0;
  }
}

/** The header and both copies of the state block (FUN_800b62e8). */
function buildFile(g: Game): void {
  const m = g.m;
  buildHeader(g);
  copy(m, PERSIST, COPY1, BLOCK_SIZE);
  copy(m, PERSIST, COPY2, BLOCK_SIZE);
}

/**
 * FUN_800b6858, then the header into BUF. Quirk: the two magic bytes are the low bytes of the
 * addresses of the strings "S" and "C" (0x80094910, 0x80094914), not 'S' and 'C', so the file
 * starts 10 14 13 01.
 */
function buildHeader(g: Game): void {
  const m = g.m;
  m.w8(HEADER, 0x10);
  m.w8(HEADER + 1, 0x14);
  m.w8(HEADER + 2, 0x13); // three icon frames
  m.w8(HEADER + 3, 1); // one block
  for (let i = 0; i < 0x40; i++) m.w8(HEADER + 4 + i, m.u8(0x800d5204 + i)); // the title, Shift-JIS
  m.fill(HEADER + 0x44, 0x1c);
  // FUN_800b691c: the icon's CLUT and its three 16x16 4-bit frames, from TIMs in the program.
  copy(m, 0x800d4fc4 + 0x14, HEADER + 0x60, 0x20);
  copy(m, 0x800d4fc4 + 0x40, HEADER + 0x80, 0x80);
  copy(m, 0x800d5084 + 0x40, HEADER + 0x100, 0x80);
  copy(m, 0x800d5144 + 0x40, HEADER + 0x180, 0x80);
  copy(m, HEADER, BUF, 0x200);
}

function copy(m: Game['m'], from: number, to: number, n: number): void {
  for (let i = 0; i < n; i++) m.w8(to + i, m.u8(from + i));
}

function xor(m: Game['m'], from: number): number {
  let x = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) x ^= m.u8(from + i);
  return x;
}

/** FUN_800b6b94: stores both copies' XOR if they agree. */
function copySeal(g: Game): boolean {
  const m = g.m;
  const a = xor(m, COPY1);
  const b = xor(m, COPY2);
  if (a === b) {
    m.w8(CHECK1, a);
    m.w8(CHECK2, b);
  }
  return a === b;
}

/** FUN_800b6c98: 1 if the first copy checks, else 2 if the second does, else 0. */
function copyCheck(g: Game): number {
  const m = g.m;
  if (xor(m, COPY1) === m.u8(CHECK1)) return 1;
  return xor(m, COPY2) === m.u8(CHECK2) ? 2 : 0;
}

/** FUN_800b6d24: the second copy (with its XOR) over the first. */
function copyRepair(g: Game): void {
  copy(g.m, CHECK2, CHECK1, BLOCK_SIZE + 1);
}

/** Byte ranges of the persistent block: whole, best times, rankings, save slots, a 0x60E-byte block, options. */
const PART: [number, number][] = [
  [0, 0x780], [0, 0xdc], [0xdc, 0x3c], [0x118, 0x3c], [0x154, 6],
  [0x154, 2], [0x156, 2], [0x158, 2], [0x15a, 0x60e], [0x768, 0x18],
];

/** FUN_800b7128(k): part k of the loaded file into the state block. */
export function cardToState(g: Game, k: number): void {
  if (k >= PART.length) return;
  const [o, n] = PART[k];
  copy(g.m, COPY1 + o, PERSIST + o, n);
}

/** FUN_800b7714(k): part k of the state block into the file buffer; parts 1 and 4-9 take the rankings too. */
export function stateToCard(g: Game, k: number): void {
  if (k >= PART.length) return;
  const [o, n] = PART[k];
  if (k === 1) {
    copy(g.m, PERSIST + 0xdc, COPY1 + 0xdc, 0x78);
  } else if (k >= 4) {
    copy(g.m, PERSIST + 0xdc, COPY1 + 0xdc, 0x78);
  }
  copy(g.m, PERSIST + o, COPY1 + o, n);
}

/** FUN_800b6c08: blocks in use on the card in the current port (rounded up). */
export function cardBlocksUsed(g: Game): number {
  const m = g.m;
  let total = 0x1fff;
  for (let r = g.cards.firstFile(g, FILE_PATTERN + (m.s32(CARD_PORT_CUR) << 7), DIRENT); r !== 0; r = g.cards.nextFile(g, DIRENT)) {
    total += m.s32(DIRENT + 0x18);
  }
  return (total < 0 ? total + 0x1fff : total) >> 13;
}

/** FUN_800b3184: a fresh file's block in BUF: no best times, the default rankings, slots, options. */
export function cardDefaults(g: Game): void {
  const m = g.m;
  for (let i = 0; i < 0x6e; i++) m.w16(COPY1 + 2 * i, 9999);
  copy(m, 0x800e2f8c, COPY1 + 0xdc, 0x3c);
  copy(m, 0x800e2fc8, COPY1 + 0x118, 0x3c);
  copy(m, 0x800e3004, COPY1 + 0x154, 6);
  copy(m, 0x800e300c, COPY1 + 0x15a, 0x60e);
  copy(m, 0x800e361c, COPY1 + 0x768, 0x18);
}

/**
 * What SW_ON.EXE's card check leaves in the state block at power-on, until that program is
 * ported: a valid save file in port 1 loads its whole persistent block; otherwise the boot
 * defaults stay. Run on a fresh Game before its first tick; the file buffer is cleared again
 * so Puzzle Mode starts with the zero BSS it would find.
 */
export function powerOnLoad(g: Game): boolean {
  const m = g.m;
  m.w32(CARD_PORT_CUR, 0);
  const ok = cardCheck(g) === 1 && cardLoad(g);
  if (ok) cardToState(g, 0);
  g.relaunch(); // back to fresh program data and zero BSS: the card code wrote globals and the buffer
  return ok;
}
