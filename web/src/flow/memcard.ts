// The memory cards (docs/re/memcard.md). The browser replaces the PlayStation's memory card with
// browser storage; the programs keep talking to it the way they talk to the BIOS: libcard's
// card checks (_card_info, _card_clear, _card_load, answered by one of four events) and the
// BIOS file functions on "bu00:" (slot 1) and "bu10:" (slot 2) paths: open, read, write,
// close, delete, firstfile/nextfile, format.
//
// A card is kept as the 128 KB raw image the emulator and the real card use (a ".mcd": 16
// blocks of 8 KB, block 0 the directory), so a card is the same bytes whether the port or the
// original wrote it (checked against PCSX-Redux's card files) and can be exported or imported.
// A backend keeps each slot's image: in memory (tests) or in localStorage (the browser, base64).
//
// Timing: every card call the programs make waits for its result inside one main-loop
// iteration (the programs spin on TestEvent or the BIOS call blocks), so a call never takes
// more than the tick it is made in; what a program sees is the result and which tick it got
// it (a new card's first check answers NEWCARD, so the check repeats a tick later). The
// vblanks each call costs on the emulator's card (the trace's `vs`) are added to `vblanks`
// (CARD_VBLANKS) for the audio and the shell; docs/re/memcard.md has the measurements.

/** The size of a card image and of a block. */
export const CARD_SIZE = 0x20000;
export const BLOCK_SIZE = 0x2000;
const FRAME = 0x80;

/** libcard's card events (SwCARD), in the order the programs test them: their wait loops return the index. */
export const IOE = 0; // done
export const ERROR = 1; // card error (a bad answer)
export const TIMEOUT = 2; // no card
export const NEWCARD = 3; // the card is new (_card_info) or not formatted (_card_load)
export type CardEvent = typeof IOE | typeof ERROR | typeof TIMEOUT | typeof NEWCARD;

/** BIOS open() modes. */
export const FREAD = 0x1;
export const FWRITE = 0x2;
export const FCREAT = 0x200;

/** A directory entry as firstfile/nextfile return it (struct DIRENTRY: name, attr, size). */
export interface DirEntry {
  name: string;
  attr: number;
  /** File size in bytes (blocks * 8192). */
  size: number;
}

/** Keeps the card image of each slot (0: slot 1, 1: slot 2); null: no card in the slot. */
export interface CardBackend {
  load(slot: number): Uint8Array | null;
  save(slot: number, image: Uint8Array | null): void;
}

/** Cards in memory (tests, and the default when no browser storage is available). */
export class MemoryBackend implements CardBackend {
  private readonly images: (Uint8Array | null)[];

  /** `images`: each slot's image (copied), null for an empty slot. */
  constructor(images: (Uint8Array | null)[] = [formattedCard(), null]) {
    this.images = [0, 1].map((i) => (images[i] ? images[i]!.slice() : null));
  }

  load(slot: number): Uint8Array | null {
    return this.images[slot] ? this.images[slot]!.slice() : null;
  }

  save(slot: number, image: Uint8Array | null): void {
    this.images[slot] = image ? image.slice() : null;
  }
}

/**
 * Cards in the browser's localStorage, one key per slot holding the image as base64. A slot
 * listed in `inserted` and without a stored card gets a formatted empty card (the port's
 * default: the browser's card in slot 1, slot 2 empty).
 */
export class LocalStorageBackend implements CardBackend {
  constructor(
    private readonly storage: Storage | undefined = globalThis.localStorage,
    private readonly prefix = 'tetris-plus.memcard',
    private readonly inserted: boolean[] = [true, false],
  ) {}

  load(slot: number): Uint8Array | null {
    if (!this.inserted[slot]) return null;
    let text: string | null = null;
    try {
      text = this.storage?.getItem(`${this.prefix}.${slot + 1}`) ?? null;
    } catch {
      text = null;
    }
    if (text) {
      const image = fromBase64(text);
      if (image.length === CARD_SIZE) return image;
    }
    return formattedCard();
  }

  save(slot: number, image: Uint8Array | null): void {
    if (!image) return;
    try {
      this.storage?.setItem(`${this.prefix}.${slot + 1}`, toBase64(image));
    } catch {
      // Storage full or blocked: the card keeps working for this session.
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A formatted card with no files, byte for byte as PCSX-Redux creates one (and as format() leaves it). */
export function formattedCard(): Uint8Array {
  const c = new Uint8Array(CARD_SIZE);
  c[0] = 0x4d; // "MC"
  c[1] = 0x43;
  c[0x7f] = 0x0e;
  for (let n = 1; n <= 15; n++) {
    const f = n * FRAME;
    c[f] = 0xa0; // free
    c[f + 8] = 0xff; // no next block
    c[f + 9] = 0xff;
    c[f + 0x7f] = 0xa0;
  }
  for (let n = 16; n <= 35; n++) {
    const f = n * FRAME; // the broken-sector list: none
    c.fill(0xff, f, f + 4);
    c[f + 8] = 0xff;
    c[f + 9] = 0xff;
  }
  c.set(c.subarray(0, FRAME), 63 * FRAME);
  return c;
}

/**
 * Vblanks each call takes on the emulator's card (docs/re/memcard.md §3): the loop the program
 * waits in plus the BIOS's own transfers. Informative only (the port never waits).
 */
export const CARD_VBLANKS = {
  info: 37, // info + load: 75 on Puzzle Mode's card check (the split is a guess)
  timeout: 3, // info with no card in the slot
  clear: 37,
  load: 38,
  open: 2,
  create: 8, // open with FCREAT
  read: 128, // 8 KB: open + read + close of the save file is 130
  write: 130,
  close: 0,
  delete: 2,
  firstfile: 2,
  nextfile: 0,
  format: 5,
} as const;

interface OpenFile {
  slot: number;
  first: number; // first block
  blocks: number[];
  pos: number;
  size: number;
  mode: number;
}

/** The two card slots as the programs see them through libcard and the BIOS. */
export class MemoryCards {
  private readonly images: (Uint8Array | null)[];
  /** The card's "new card" flag (set when a card is inserted, cleared by _card_clear or a write). */
  private readonly fresh: boolean[];
  private readonly files = new Map<number, OpenFile>();
  private search: { slot: number; pattern: RegExp; next: number } | null = null;
  /** Vblanks the calls so far would have taken on the original (CARD_VBLANKS); the caller resets it. */
  vblanks = 0;

  constructor(private readonly backend: CardBackend = new MemoryBackend()) {
    this.images = [backend.load(0), backend.load(1)];
    // At power-on the emulator's card answers its first check with NEWCARD only if it isn't
    // formatted (measured: docs/re/memcard.md §2).
    this.fresh = this.images.map((c) => c !== null && !isFormatted(c));
  }

  /** The image in a slot (a copy), null if the slot is empty. */
  image(slot: number): Uint8Array | null {
    return this.images[slot] ? this.images[slot]!.slice() : null;
  }

  /** Puts a card in a slot (null: takes it out). A card put in answers its first check with NEWCARD. */
  insert(slot: number, image: Uint8Array | null): void {
    this.images[slot] = image ? image.slice() : null;
    this.fresh[slot] = image !== null;
    for (const [fd, f] of this.files) if (f.slot === slot) this.files.delete(fd);
    this.backend.save(slot, this.images[slot]);
  }

  // ---- the programs' card set-up ----

  /**
   * InitCARD, StartCARD and _bu_init, which SW_ON, SELECT and PAZLE run when they start
   * (card_init): the BIOS writes each inserted card's frame 63 (the last frame of the directory
   * block): a copy of frame 0 when it starts with "MC" (its checksum isn't checked), else the
   * frame a format leaves there (zeros, [0x60] = 0x02, [0x68] = 0xFF). Measured on the
   * emulator's BIOS (OpenBIOS) with cards whose frame 63 differed: docs/re/memcard.md §1.1.
   */
  init(): void {
    for (let slot = 0; slot < 2; slot++) {
      const c = this.images[slot];
      if (!c) continue;
      const frame = new Uint8Array(FRAME);
      if (c[0] === 0x4d && c[1] === 0x43) frame.set(c.subarray(0, FRAME));
      else {
        frame[0x60] = 0x02;
        frame[0x68] = 0xff;
      }
      const at = 63 * FRAME;
      if (c.subarray(at, at + FRAME).every((b, i) => b === frame[i])) continue;
      c.set(frame, at);
      this.changed(slot);
    }
  }

  // ---- libcard: the checks the programs wait for (the event their TestEvent loop returns) ----

  /** _card_info(chan): is there a card, and is it new. `chan` is 0x00 (slot 1) or 0x10 (slot 2). */
  info(chan: number): CardEvent {
    const slot = slotOfChan(chan);
    if (!this.images[slot]) {
      this.vblanks += CARD_VBLANKS.timeout;
      return TIMEOUT;
    }
    this.vblanks += CARD_VBLANKS.info;
    return this.fresh[slot] ? NEWCARD : IOE;
  }

  /** _card_clear(chan): clears the new-card flag (a write to the card). */
  clear(chan: number): CardEvent {
    const slot = slotOfChan(chan);
    this.vblanks += CARD_VBLANKS.clear;
    if (!this.images[slot]) return TIMEOUT;
    this.fresh[slot] = false;
    return IOE;
  }

  /** _card_load(chan): reads the directory for the BIOS; NEWCARD if the card isn't formatted. */
  load(chan: number): CardEvent {
    const slot = slotOfChan(chan);
    this.vblanks += CARD_VBLANKS.load;
    const c = this.images[slot];
    if (!c) return TIMEOUT;
    return isFormatted(c) ? IOE : NEWCARD;
  }

  // ---- the BIOS file functions ----

  /** open(path, mode): a file descriptor, or -1. FCREAT | (blocks << 16) creates the file. */
  open(path: string, mode: number): number {
    this.vblanks += mode & FCREAT ? CARD_VBLANKS.create : CARD_VBLANKS.open;
    const p = parsePath(path);
    const c = p && this.images[p.slot];
    if (!p || !c || !isFormatted(c)) return -1;
    let first = findFile(c, p.name);
    if (mode & FCREAT) {
      if (first >= 0) return -1;
      const blocks = Math.max(1, mode >>> 16);
      first = createFile(c, p.name, blocks);
      if (first < 0) return -1;
      this.changed(p.slot);
    } else if (first < 0) {
      return -1;
    }
    const chain = chainOf(c, first);
    let fd = 2;
    while (this.files.has(fd)) fd++;
    this.files.set(fd, { slot: p.slot, first, blocks: chain, pos: 0, size: chain.length * BLOCK_SIZE, mode });
    return fd;
  }

  /** read(fd, buffer, n): bytes read into `dst` (n = dst.length), or -1. */
  read(fd: number, dst: Uint8Array): number {
    this.vblanks += CARD_VBLANKS.read;
    const f = this.files.get(fd);
    const c = f && this.images[f.slot];
    if (!f || !c || !(f.mode & FREAD)) return -1;
    const n = Math.min(dst.length, f.size - f.pos);
    for (let i = 0; i < n; i++) {
      const at = f.pos + i;
      dst[i] = c[f.blocks[at >> 13] * BLOCK_SIZE + (at & (BLOCK_SIZE - 1))];
    }
    f.pos += n;
    return n;
  }

  /** write(fd, buffer, n): bytes written from `src` (n = src.length), or -1. */
  write(fd: number, src: Uint8Array): number {
    this.vblanks += CARD_VBLANKS.write;
    const f = this.files.get(fd);
    const c = f && this.images[f.slot];
    if (!f || !c || !(f.mode & FWRITE)) return -1;
    const n = Math.min(src.length, f.size - f.pos);
    for (let i = 0; i < n; i++) {
      const at = f.pos + i;
      c[f.blocks[at >> 13] * BLOCK_SIZE + (at & (BLOCK_SIZE - 1))] = src[i];
    }
    f.pos += n;
    this.fresh[f.slot] = false;
    this.changed(f.slot);
    return n;
  }

  /** close(fd): fd, or -1 if it isn't open. */
  close(fd: number): number {
    this.vblanks += CARD_VBLANKS.close;
    return this.files.delete(fd) ? fd : -1;
  }

  /** delete(path): true if a file was deleted. */
  delete(path: string): boolean {
    this.vblanks += CARD_VBLANKS.delete;
    const p = parsePath(path);
    const c = p && this.images[p.slot];
    if (!p || !c || !isFormatted(c)) return false;
    const first = findFile(c, p.name);
    if (first < 0) return false;
    for (const n of chainOf(c, first)) {
      const e = n * FRAME;
      c[e] = (c[e] & 0x0f) | 0xa0;
      checksum(c, n);
    }
    this.changed(p.slot);
    return true;
  }

  /** firstfile(pattern): the first file matching "buXY:pattern" (* and ? wildcards), or null. */
  firstfile(pattern: string): DirEntry | null {
    this.vblanks += CARD_VBLANKS.firstfile;
    const p = parsePath(pattern);
    const c = p && this.images[p.slot];
    this.search = null;
    if (!p || !c || !isFormatted(c)) return null;
    const re = new RegExp(`^${p.name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    this.search = { slot: p.slot, pattern: re, next: 1 };
    return this.nextEntry();
  }

  /** nextfile(): the next match of the last firstfile, or null. */
  nextfile(): DirEntry | null {
    this.vblanks += CARD_VBLANKS.nextfile;
    return this.nextEntry();
  }

  /** format("buXY:"): 1, or 0 with no card. */
  format(path: string): number {
    this.vblanks += CARD_VBLANKS.format;
    const p = parsePath(path);
    if (!p || !this.images[p.slot]) return 0;
    // The BIOS's format writes block 0 like a new card's, except its last frame (measured
    // against PCSX-Redux running the original's format: docs/re/memcard.md §4).
    const block = formattedCard().subarray(0, BLOCK_SIZE);
    block.fill(0, 63 * FRAME, 64 * FRAME);
    block[63 * FRAME + 0x60] = 0x02;
    block[63 * FRAME + 0x68] = 0xff;
    this.images[p.slot]!.set(block);
    this.fresh[p.slot] = false;
    for (const [fd, f] of this.files) if (f.slot === p.slot) this.files.delete(fd);
    this.changed(p.slot);
    return 1;
  }

  /** Free blocks on the card in a slot (null if empty or not formatted). For the shell. */
  freeBlocks(slot: number): number | null {
    const c = this.images[slot];
    if (!c || !isFormatted(c)) return null;
    let free = 0;
    for (let n = 1; n <= 15; n++) if ((c[n * FRAME] & 0xf0) === 0xa0) free++;
    return free;
  }

  private nextEntry(): DirEntry | null {
    const s = this.search;
    const c = s && this.images[s.slot];
    if (!s || !c) return null;
    while (s.next <= 15) {
      const n = s.next++;
      const e = n * FRAME;
      if (c[e] !== 0x51) continue;
      const name = readName(c, e + 0x0a);
      if (!s.pattern.test(name)) continue;
      return { name, attr: c[e] , size: u32(c, e + 4) };
    }
    return null;
  }

  private changed(slot: number): void {
    this.backend.save(slot, this.images[slot]);
  }
}

function slotOfChan(chan: number): number {
  return (chan >> 4) & 1;
}

function parsePath(path: string): { slot: number; name: string } | null {
  const m = /^bu([01])[0-9]:(.*)$/.exec(path);
  return m ? { slot: Number(m[1]), name: m[2] } : null;
}

function isFormatted(c: Uint8Array): boolean {
  return c[0] === 0x4d && c[1] === 0x43;
}

function u32(c: Uint8Array, a: number): number {
  return (c[a] | (c[a + 1] << 8) | (c[a + 2] << 16) | (c[a + 3] << 24)) >>> 0;
}

function readName(c: Uint8Array, a: number): string {
  let s = '';
  for (let i = 0; i < 20 && c[a + i]; i++) s += String.fromCharCode(c[a + i]);
  return s;
}

function checksum(c: Uint8Array, n: number): void {
  const e = n * FRAME;
  let x = 0;
  for (let i = 0; i < FRAME - 1; i++) x ^= c[e + i];
  c[e + FRAME - 1] = x;
}

/** The first block of a file, or -1. */
function findFile(c: Uint8Array, name: string): number {
  for (let n = 1; n <= 15; n++) {
    const e = n * FRAME;
    if (c[e] === 0x51 && readName(c, e + 0x0a) === name) return n;
  }
  return -1;
}

function chainOf(c: Uint8Array, first: number): number[] {
  const out: number[] = [];
  for (let n = first; n >= 1 && n <= 15 && out.length < 15; ) {
    out.push(n);
    const next = c[n * FRAME + 8] | (c[n * FRAME + 9] << 8);
    if (next === 0xffff) break;
    n = next + 1;
  }
  return out;
}

/** Allocates a file of `blocks` blocks in the lowest free directory entries; its first block or -1. */
function createFile(c: Uint8Array, name: string, blocks: number): number {
  const free: number[] = [];
  for (let n = 1; n <= 15 && free.length < blocks; n++) if ((c[n * FRAME] & 0xf0) === 0xa0) free.push(n);
  if (free.length < blocks) return -1;
  free.forEach((n, i) => {
    const e = n * FRAME;
    c.fill(0, e, e + FRAME);
    c[e] = i === 0 ? 0x51 : i === free.length - 1 ? 0x53 : 0x52;
    if (i === 0) {
      const size = blocks * BLOCK_SIZE;
      c[e + 4] = size & 0xff;
      c[e + 5] = (size >> 8) & 0xff;
      c[e + 6] = (size >> 16) & 0xff;
      c[e + 7] = (size >>> 24) & 0xff;
    }
    const next = i + 1 < free.length ? free[i + 1] - 1 : 0xffff;
    c[e + 8] = next & 0xff;
    c[e + 9] = (next >> 8) & 0xff;
    for (let k = 0; k < name.length && k < 20; k++) c[e + 0x0a + k] = name.charCodeAt(k);
    checksum(c, n);
  });
  return free[0];
}
