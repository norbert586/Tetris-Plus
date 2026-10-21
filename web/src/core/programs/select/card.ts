// SELECT.EXE's memory-card routines (0x8009AE40-0x8009D214): close copies of PAZLE's
// (web/src/core/card.ts), with SELECT's own buffers, retry counts and a few quirks noted below.
// They answer from the same virtual card (CardSlots); card I/O blocks inside one logic tick in
// the original (TestEvent loops), so it costs no ticks.
import * as A from '../../addr';
import type { CardSlots } from '../../card';
import type { Mem } from '../../mem';

interface Host {
  m: Mem;
  cards: CardSlots;
}

export const CARD_PORT = 0x800b9c90; // the port the prompt's cursor chose (0 or 1)
const CARD_CHAN = 0x800bbd70; // port << 4
const CARD_EVENT = 0x800b9050; // the last libcard event index
const IO_COUNT = 0x800b9a48; // bytes read or written by the last call
const FD = 0x800b9bd0;
/** The CD watchdog flag of the main loop; format()'s result lands in it (see cardFormat). */
export const CD_RESET = 0x800b911c;
const FILE_NAME = 0x800b1cb4; // "bu00:baslus-00338", 0xFF bytes per port
const FILE_PATTERN = 0x800b1eb4; // "bu00:*", 0x80 bytes per port
const DIRENT = 0x800b9a94;
const BUF = 0x800b9d58; // the 8 KB file as read or written
const CHECK1 = BUF + 0x200;
const COPY1 = BUF + 0x201;
const CHECK2 = BUF + 0x981;
const COPY2 = BUF + 0x982;
const HEADER = 0x800bd590; // FUN_8009BB1C's 0x200-byte header
const TITLE = 0x800b1c74; // the save title, Shift-JIS
const ICONS = [0x800b1a34, 0x800b1af4, 0x800b1bb4]; // three 16x16 4-bit TIMs
const BLOCK = 0x2000;
const BLOCK_SIZE = 0x780;
const PERSIST = A.S + 0x4ad84;

const port = (g: Host) => g.m.s32(CARD_PORT);
const fileName = (g: Host) => FILE_NAME + port(g) * 0xff;

function copy(m: Mem, from: number, to: number, n: number): void {
  for (let i = 0; i < n; i++) m.w8(to + i, m.u8(from + i));
}

function xor(m: Mem, from: number): number {
  let x = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) x ^= m.u8(from + i);
  return x;
}

/**
 * FUN_8009B348: checks the card in the chosen port. 1 ready, 0 no card, -1 error, 2 new card
 * (acknowledged, ask again), 3 not formatted.
 */
export function cardProbe(g: Host): number {
  const m = g.m;
  m.w32(CARD_CHAN, port(g) << 4);
  const chan = m.s32(CARD_CHAN);
  let e = g.cards.info(chan);
  m.w32(CARD_EVENT, e);
  if (e === 3) {
    g.cards.acknowledge(chan); // _card_clear: a dummy write
    m.w32(CARD_EVENT, 0);
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

/**
 * FUN_8009B63C: format(). Quirk: the result is stored in the main loop's CD watchdog flag
 * (0x800B911C), so a successful format makes the next tick's tail run CdReset and restart the
 * music; the caller takes format()'s result from $v0.
 */
export function cardFormat(g: Host): number {
  const r = g.cards.format(g, FILE_PATTERN + (port(g) << 7));
  g.m.w32(CD_RESET, r);
  return r;
}

/** FUN_8009B678 (FUN_8009B6B4): 1 loaded (a copy checks), 0 no file, -1 a file that doesn't check. */
export function cardLoad(g: Host): number {
  const m = g.m;
  let opened = false;
  for (let tries = 7; ; ) {
    m.w32(IO_COUNT, 0);
    const fd = g.cards.open(g, fileName(g), 0x10001);
    let ok = false;
    if (fd !== -1) {
      opened = true;
      m.fill(BUF, BLOCK);
      const n = g.cards.transfer(g, fd, BUF, BLOCK, false);
      m.w32(IO_COUNT, n);
      if (n === BLOCK) {
        // FUN_8009BF50: 1 if the first copy checks, else 2 if the second does.
        const c = xor(m, COPY1) === m.u8(CHECK1) ? 1 : xor(m, COPY2) === m.u8(CHECK2) ? 2 : 0;
        if (c === 1) ok = true;
        if (c === 2) {
          ok = true;
          copy(m, CHECK2, CHECK1, BLOCK_SIZE + 1); // FUN_8009BFD4
        }
      }
    }
    g.cards.close(fd);
    tries--;
    if (ok) return 1;
    if (tries < 1) return opened ? -1 : 0;
  }
}

/** FUN_8009BB1C, then the header into BUF (FUN_8009B7D0, FUN_8009D214). The magic is the low bytes of "S"/"C"'s addresses (0x800941D8/DC). */
function buildHeader(g: Host): void {
  const m = g.m;
  m.w8(HEADER, 0xd8);
  m.w8(HEADER + 1, 0xdc);
  m.w8(HEADER + 2, 0x13);
  m.w8(HEADER + 3, 1);
  copy(m, TITLE, HEADER + 4, 0x40);
  m.fill(HEADER + 0x44, 0x1c);
  // FUN_8009BBE0: the icon's CLUT and three frames.
  copy(m, ICONS[0] + 0x14, HEADER + 0x60, 0x20);
  copy(m, ICONS[0] + 0x40, HEADER + 0x80, 0x80);
  copy(m, ICONS[1] + 0x40, HEADER + 0x100, 0x80);
  copy(m, ICONS[2] + 0x40, HEADER + 0x180, 0x80);
  copy(m, HEADER, BUF, 0x200);
}

/** FUN_8009BE54: stores both copies' XOR if they agree. */
function copySeal(m: Mem): boolean {
  const a = xor(m, COPY1);
  const b = xor(m, COPY2);
  if (a === b) {
    m.w8(CHECK1, a);
    m.w8(CHECK2, b);
  }
  return a === b;
}

/** FUN_8009B7D0: creates the save file with the whole persistent block; 1 on success (10 tries). */
export function cardCreate(g: Host): number {
  const m = g.m;
  for (let tries = 10; tries > 0; tries--) {
    m.w32(IO_COUNT, 0);
    let fd = g.cards.open(g, fileName(g), 0x10200);
    m.w32(FD, fd);
    if (fd === -1) continue;
    g.cards.close(fd);
    buildHeader(g);
    copy(m, PERSIST, COPY1, BLOCK_SIZE);
    copy(m, PERSIST, COPY2, BLOCK_SIZE);
    if (!copySeal(m)) continue;
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

/** FUN_8009D214: rewrites the existing file from the loaded buffer (copy 1 into copy 2); 1 on success (16 tries). */
export function cardRewrite(g: Host): number {
  const m = g.m;
  for (let tries = 16; ; ) {
    m.w32(IO_COUNT, 0);
    const fd = g.cards.open(g, fileName(g), 0x10002);
    m.w32(FD, fd);
    if (fd !== -1) {
      buildHeader(g);
      copy(m, COPY1, COPY2, BLOCK_SIZE);
      if (copySeal(m)) {
        const n = g.cards.transfer(g, fd, BUF, BLOCK, true);
        m.w32(IO_COUNT, n);
        if (n === BLOCK) {
          g.cards.close(fd);
          return 1;
        }
      }
    }
    tries--;
    g.cards.close(m.s32(FD));
    if (tries < 1) return 0;
  }
}

/** FUN_8009BEC8: blocks in use on the card (rounded up). */
export function cardBlocksUsed(g: Host): number {
  const m = g.m;
  let total = 0x1fff;
  for (let r = g.cards.firstFile(g, FILE_PATTERN + (port(g) << 7), DIRENT); r !== 0; r = g.cards.nextFile(g, DIRENT)) {
    total = (total + m.s32(DIRENT + 0x18)) | 0;
  }
  return (total < 0 ? total + 0x1fff : total) >> 13;
}

/** FUN_8009CE00: the loaded options (0x18 bytes) into the state block. */
export function loadOptions(g: Host): void {
  copy(g.m, COPY1 + 0x768, PERSIST + 0x768, 0x18);
}

/** FUN_8009CED8: the loaded rankings (Classic and Puzzle, 0x78 bytes) into the state block. */
export function loadRankings(g: Host): void {
  copy(g.m, COPY1 + 0xdc, PERSIST + 0xdc, 0x78);
}

/** FUN_8009CFA8: the options and (as PAZLE's part 9) the rankings into the loaded file's first copy. */
export function saveOptions(g: Host): void {
  copy(g.m, PERSIST + 0x768, COPY1 + 0x768, 0x18);
  copy(g.m, PERSIST + 0xdc, COPY1 + 0xdc, 0x78);
}

/** FUN_8009D144: the rankings into the loaded file's first copy. */
export function saveRankings(g: Host): void {
  copy(g.m, PERSIST + 0xdc, COPY1 + 0xdc, 0x78);
}
