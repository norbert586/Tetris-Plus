// Puzzle Mode's memory card routines (docs/re/memcard.md §5): the card check, the save file's
// read, create and write, and the copies between the save buffer and the shared state's saved
// block (state+0x4AD84, 0x780 bytes). The save screen (screen 13) and the menu's Continue use
// them. The card itself is g.cards (src/flow/memcard.ts).
import * as A from './addr';
import type { Game } from './game';
import { FCREAT, FREAD, FWRITE, IOE, ERROR, NEWCARD } from '../flow/memcard';

/** The card slot each player uses (0 or 1); the save screen's cursor doubles as it. */
export const CARD_SLOT = 0x800f2d1c; // [2]
/** The slot the card routines work on (set from CARD_SLOT before a card check). */
export const CARD_INDEX = 0x800ee9a0;
const CARD_CHAN = 0x800f1284; // CARD_INDEX << 4
const LAST_EVENT = 0x800ed2e8;
/** The card routines' last result, as the screens keep it. */
export const CARD_RESULT = 0x800eeae0;
const COUNT = 0x800ee3bc; // bytes read or written
const FD = 0x800ee708;
const FORMAT_RESULT = 0x800ed394;
/** Set while a card routine runs (FUN_800B709C takes it, FUN_800B7118 gives it back); bit 0x10: the file is new. */
export const CARD_LOCK = 0x800f2ac8;

/** The save file (8 KB): the header, then copy A and copy B, each after its checksum byte. */
const BUFFER = 0x800eebbc;
const SUM_A = 0x800eedbc;
const COPY_A = SUM_A + 1;
const SUM_B = 0x800ef53d;
const COPY_B = SUM_B + 1;
/** The header FUN_800B6858 builds (0x200 bytes). */
const HEADER = 0x800f2aec;
const SAVE = A.S + 0x4ad84;
const SAVE_SIZE = 0x780;
/** The three save slots in the saved block: (stage, zones cleared) each. */
export const SAVE_SLOTS = A.S + 0x4aed8;

/** The file's name by slot: 0x800D5244 + 255 * slot. */
const FILE_NAME = ['bu00:baslus-00338', 'bu10:baslus-00338'];
const CARD_ALL = ['bu00:*', 'bu10:*'];

function copy(g: Game, to: number, from: number, n: number): void {
  g.m.bytes.copyWithin(to & 0x1fffff, from & 0x1fffff, (from & 0x1fffff) + n);
}

// The saved block's sections (offsets in the block): best times [0, 0xDC), two 0x3C tables,
// the three save slots [0x154, 0x15A), then [0x15A, 0x768) and [0x768, 0x780).
type Ranges = [number, number][];
/** FUN_800B7128(k): copy A into the shared state, by section (measured in Unicorn). */
const TO_STATE: Ranges[] = [
  [[0, 0x780]], [[0, 0xdc]], [[0xdc, 0x118]], [[0x118, 0x154]], [[0x154, 0x15a]],
  [[0x154, 0x156]], [[0x156, 0x158]], [[0x158, 0x15a]], [[0x15a, 0x768]], [[0x768, 0x780]],
];
/**
 * FUN_800B7714(k): the shared state into copy A. Not the mirror of FUN_800B7128: case 1 copies
 * [0, 0x154), cases 4-9 copy [0xDC, 0x154) as well as their own section (measured in Unicorn).
 */
const TO_BUFFER: Ranges[] = [
  [[0, 0x780]], [[0, 0x154]], [[0xdc, 0x118]], [[0x118, 0x154]], [[0xdc, 0x15a]],
  [[0xdc, 0x156]], [[0xdc, 0x154], [0x156, 0x158]], [[0xdc, 0x154], [0x158, 0x15a]],
  [[0xdc, 0x154], [0x15a, 0x768]], [[0xdc, 0x154], [0x768, 0x780]],
];

export function saveToState(g: Game, k: number): void {
  for (const [a, b] of TO_STATE[k] ?? []) copy(g, SAVE + a, COPY_A + a, b - a);
}

export function stateToSave(g: Game, k: number): void {
  for (const [a, b] of TO_BUFFER[k] ?? []) copy(g, COPY_A + a, SAVE + a, b - a);
}

/** FUN_800B709C: takes the card lock; false if it is held. */
export function cardLock(g: Game): boolean {
  if (g.m.s32(CARD_LOCK) !== 0) return false;
  g.m.w32(CARD_LOCK, 1);
  return true;
}

/** FUN_800B7118 */
export function cardUnlock(g: Game): void {
  g.m.w32(CARD_LOCK, 0);
}

/**
 * FUN_800B6074: the card in slot CARD_INDEX: 1 usable, 0 none, -1 error, 2 a new card (cleared:
 * check again), 3 not formatted.
 */
export function cardStatus(g: Game): number {
  const m = g.m;
  const chan = m.s32(CARD_INDEX) << 4;
  m.w32(CARD_CHAN, chan);
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

function xorSum(g: Game, a: number): number {
  let x = 0;
  for (let i = 0; i < SAVE_SIZE; i++) x ^= g.m.u8(a + i);
  return x;
}

/** FUN_800B6C98: 1 if copy A is intact, else 2 if copy B is, else 0. */
function saveCheck(g: Game): number {
  if (xorSum(g, COPY_A) === g.m.u8(SUM_A)) return 1;
  return xorSum(g, COPY_B) === g.m.u8(SUM_B) ? 2 : 0;
}

/** FUN_800B6B94: both copies' checksums; if equal, stored before each copy. */
function saveSums(g: Game): boolean {
  const a = xorSum(g, COPY_A);
  const b = xorSum(g, COPY_B);
  if (a !== b) return false;
  g.m.w8(SUM_A, a);
  g.m.w8(SUM_B, b);
  return true;
}

/**
 * FUN_800B61B4 / FUN_800B61DC: reads the save file into the buffer, up to 4 tries; true if a copy
 * is intact (copy B over A if only B is). Like SW_ON's, the loop tests the caller's $s2 without
 * setting it first; the callers' $s2 is never 1 there, so this is the intended behaviour.
 */
export function saveRead(g: Game): boolean {
  const m = g.m;
  const name = FILE_NAME[m.s32(CARD_INDEX)];
  for (let tries = 4; ; ) {
    let ok = false;
    m.w32(COUNT, 0);
    const fd = g.cards.open(name, (1 << 16) | FREAD);
    if (fd !== -1) {
      m.fill(BUFFER, 0x2000);
      const data = new Uint8Array(0x2000);
      const n = g.cards.read(fd, data);
      m.bytes.set(data.subarray(0, Math.max(0, n)), BUFFER & 0x1fffff);
      m.w32(COUNT, n);
      if (n === 0x2000) {
        const c = saveCheck(g);
        if (c === 1) ok = true;
        if (c === 2) {
          ok = true;
          copy(g, SUM_A, SUM_B, SAVE_SIZE + 1); // FUN_800B6D24
        }
      }
    }
    g.cards.close(fd);
    tries--;
    if (ok) return true;
    if (tries < 1) return false;
  }
}

/** FUN_800B6858: the file header (title, icon) at 0x800F2AEC. */
function buildHeader(g: Game): void {
  const m = g.m;
  // The magic should be "SC"; the code stores the low bytes of two string addresses instead.
  m.w8(HEADER, 0x10);
  m.w8(HEADER + 1, 0x14);
  m.w8(HEADER + 2, 0x13); // icon: 3 frames
  m.w8(HEADER + 3, 1);
  copy(g, HEADER + 4, 0x800d5204, 0x40);
  m.fill(HEADER + 0x44, 0x1c);
  // FUN_800B691C: the icon's palette and its three frames.
  copy(g, HEADER + 0x60, 0x800d4fc4 + 0x14, 0x20);
  copy(g, HEADER + 0x80, 0x800d4fc4 + 0x40, 0x80);
  copy(g, HEADER + 0x100, 0x800d5084 + 0x40, 0x80);
  copy(g, HEADER + 0x180, 0x800d5144 + 0x40, 0x80);
}

function bufferBytes(g: Game): Uint8Array {
  return g.m.bytes.slice(BUFFER & 0x1fffff, (BUFFER & 0x1fffff) + 0x2000);
}

/**
 * FUN_800B62E8: creates the save file (one block) and writes the shared state's saved block to
 * both copies, up to 4 tries; 1 if written.
 */
export function saveCreate(g: Game): number {
  const m = g.m;
  const name = () => FILE_NAME[m.s32(CARD_INDEX)];
  for (let tries = 4; tries > 0; tries--) {
    m.w32(COUNT, 0);
    const fd = g.cards.open(name(), (1 << 16) | FCREAT);
    m.w32(FD, fd);
    if (fd === -1) continue;
    g.cards.close(fd);
    buildHeader(g);
    copy(g, BUFFER, HEADER, 0x200);
    copy(g, COPY_A, SAVE, SAVE_SIZE);
    copy(g, COPY_B, SAVE, SAVE_SIZE);
    if (!saveSums(g)) continue;
    const wfd = g.cards.open(name(), (1 << 16) | FWRITE);
    m.w32(FD, wfd);
    if (wfd !== -1) {
      m.w32(COUNT, g.cards.write(wfd, bufferBytes(g)));
      g.cards.close(m.s32(FD));
      if (m.s32(COUNT) === 0x2000) return 1;
    }
    g.cards.close(m.s32(FD));
    g.cards.delete(name());
  }
  return 0;
}

/** FUN_800B6638: writes the buffer (the header rebuilt, copy A also as copy B), up to 4 tries; 1 if written. */
export function saveWrite(g: Game): number {
  const m = g.m;
  buildHeader(g);
  copy(g, BUFFER, HEADER, 0x200);
  copy(g, COPY_B, COPY_A, SAVE_SIZE);
  for (let tries = 4; ; ) {
    m.w32(COUNT, 0);
    if (saveSums(g)) {
      const fd = g.cards.open(FILE_NAME[m.s32(CARD_INDEX)], (1 << 16) | FWRITE);
      m.w32(FD, fd);
      if (fd !== -1) {
        m.w32(COUNT, g.cards.write(fd, bufferBytes(g)));
        if (m.s32(COUNT) === 0x2000) {
          g.cards.close(m.s32(FD));
          return 1;
        }
      }
      g.cards.close(m.s32(FD));
    }
    tries--;
    if (tries < 1) return 0;
  }
}

/** FUN_800B6C08: the blocks in use on the card, rounded up. */
export function usedBlocks(g: Game): number {
  let bytes = 0x1fff;
  for (let e = g.cards.firstfile(CARD_ALL[g.m.s32(CARD_INDEX)]); e; e = g.cards.nextfile()) bytes = (bytes + e.size) | 0;
  if (bytes < 0) bytes += 0x1fff;
  return bytes >> 13;
}

/** FUN_800B6174: formats the card. */
export function cardFormat(g: Game): number {
  const r = g.cards.format(CARD_ALL[g.m.s32(CARD_INDEX)]);
  g.m.w32(FORMAT_RESULT, r);
  return r;
}

/** FUN_800B3184: the defaults into copy A (best times 9999, then the tables at 0x800E2F8C). */
export function saveDefaults(g: Game): void {
  for (let i = 0; i < 0x6e; i++) g.m.w16(COPY_A + 2 * i, 9999);
  copy(g, COPY_A + 0xdc, 0x800e2f8c, 0x7e);
  copy(g, COPY_A + 0x15a, 0x800e300c, 0x60e);
  copy(g, COPY_A + 0x768, 0x800e361c, 0x18);
}
