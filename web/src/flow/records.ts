// The records on memory card 1, kept by the browser (docs/re/memcard.md §7): the best time of
// every stage and the Classic and Puzzle rankings, the first 0x154 bytes of the saved block
// (state+0x4AD84). On the console they reach the card only from Puzzle Mode's save screen after a
// game (and Option mode's saves); the browser has no save screen (games are saved on the pause
// screen, flow/snapshot.ts), so it writes the records into the card's save file itself whenever
// they change, in the game's own format, and SW_ON loads them at the next power-on as before.
//
// Records only improve: what is written is the card's records merged with the RAM's (the lower
// best time; the rankings' entries together, top five), because a saved game brings back the RAM
// of its moment, records included.
import * as A from '../core/addr';
import { saveHeader } from '../core/card';
import { Mem } from '../core/mem';
import { FCREAT, FREAD, FWRITE, type MemoryCards } from './memcard';

export const RECORDS = A.BEST_TIMES;
export const RECORDS_SIZE = 0x154;
export const STAGES = 100;
export const NO_TIME = 9999;

const FILE = 'bu00:baslus-00338';
const FILE_SIZE = 0x2000;
const SAVE = A.S + 0x4ad84;
const SAVE_SIZE = 0x780;
const SUM_A = 0x200;
const SUM_B = SUM_A + 1 + SAVE_SIZE;
/** The best times (u16 each), then the Classic and Puzzle rankings (5 entries of 12 bytes). */
const BEST_TIMES = 0x6e;
const RANKINGS = [0xdc, 0x118];
const ENTRY = 12;
const ENTRIES = 5;

/** A ranking entry: name letters (0-25 A-Z, 26 '.', 27 '!', 28 '?', 31 blank), score, stage, zone. */
export interface RankEntry {
  name: string;
  score: number;
  /** Puzzle: the stage record's zone (5: 100-stage mode) and stage; Classic: lines and level. */
  a: number;
  b: number;
}

export interface Records {
  /** Best time per stage record (zone * 20 + stage), in tenths; NO_TIME for none. */
  best: number[];
  classic: RankEntry[];
  puzzle: RankEntry[];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.!?';

/** The records in RAM (a copy). */
export function ramRecords(m: Mem): Uint8Array {
  return m.bytes.slice(RECORDS & 0x1fffff, (RECORDS & 0x1fffff) + RECORDS_SIZE);
}

/** Whether the records in RAM are `r`. */
export function sameRecords(m: Mem, r: Uint8Array): boolean {
  const at = RECORDS & 0x1fffff;
  for (let i = 0; i < RECORDS_SIZE; i++) if (m.bytes[at + i] !== r[i]) return false;
  return true;
}

function entries(r: Uint8Array, table: number, classic: boolean): RankEntry[] {
  const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
  const out: RankEntry[] = [];
  for (let i = 0; i < ENTRIES; i++) {
    const e = table + ENTRY * i;
    const name = [0, 1, 2].map((k) => LETTERS[r[e + k]] ?? ' ').join('').trimEnd();
    out.push(classic
      ? { name, score: v.getInt32(e + 4, true), a: v.getInt16(e + 8, true), b: v.getInt8(e + 10) }
      : { name, score: v.getInt32(e + 4, true), a: v.getInt8(e + 9), b: v.getInt8(e + 8) });
  }
  return out;
}

/** Reads records (RECORDS_SIZE bytes, as in the saved block). */
export function readRecords(r: Uint8Array): Records {
  const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
  const best: number[] = [];
  for (let i = 0; i < STAGES; i++) best.push(v.getUint16(2 * i, true));
  return { best, classic: entries(r, RANKINGS[0], true), puzzle: entries(r, RANKINGS[1], false) };
}

/**
 * `older` and `newer` together: each best time the lower of the two, each ranking the entries of
 * both (the same entry once) by score, highest first, `older`'s first among equal scores, five.
 */
export function mergeRecords(older: Uint8Array, newer: Uint8Array): Uint8Array {
  const out = newer.slice(0, RECORDS_SIZE);
  const o = new DataView(older.buffer, older.byteOffset, older.byteLength);
  const d = new DataView(out.buffer);
  for (let i = 0; i < BEST_TIMES; i++) d.setUint16(2 * i, Math.min(o.getUint16(2 * i, true), d.getUint16(2 * i, true)), true);
  for (const table of RANKINGS) {
    const all: Uint8Array[] = [];
    for (const src of [older, newer])
      for (let i = 0; i < ENTRIES; i++) {
        const e = src.slice(table + ENTRY * i, table + ENTRY * (i + 1));
        if (!all.some((x) => x.every((b, k) => b === e[k]))) all.push(e);
      }
    const score = (e: Uint8Array) => new DataView(e.buffer).getInt32(4, true);
    all.sort((x, y) => score(y) - score(x));
    for (let i = 0; i < ENTRIES; i++) out.set(all[i], table + ENTRY * i);
  }
  return out;
}

const xor = (b: Uint8Array) => b.reduce((x, v) => x ^ v, 0);

/** The save file of card 1, if there is one with an intact copy: that copy (SAVE_SIZE bytes). */
function readFile(cards: MemoryCards): { file: Uint8Array; block: Uint8Array } | null | 'none' {
  const fd = cards.open(FILE, (1 << 16) | FREAD);
  if (fd < 0) return 'none';
  const file = new Uint8Array(FILE_SIZE);
  const n = cards.read(fd, file);
  cards.close(fd);
  if (n !== FILE_SIZE) return null;
  const a = file.subarray(SUM_A + 1, SUM_A + 1 + SAVE_SIZE);
  const b = file.subarray(SUM_B + 1, SUM_B + 1 + SAVE_SIZE);
  if (xor(a) === file[SUM_A]) return { file, block: a.slice() };
  if (xor(b) === file[SUM_B]) return { file, block: b.slice() };
  return null;
}

/** The records on card 1, or null without a card, a save file or an intact copy. */
export function cardRecords(cards: MemoryCards): Uint8Array | null {
  return cards.outsideGame(() => {
    const f = readFile(cards);
    return f && f !== 'none' ? f.block.slice(0, RECORDS_SIZE) : null;
  });
}

export type StoreResult = 'unchanged' | 'updated' | 'created' | 'no card' | 'no room' | 'damaged' | 'failed';

/**
 * Writes the records in `m` to card 1, merged with the card's (both copies, as the game writes
 * them). Without a save file it creates one, as Puzzle Mode's save screen would: the header and
 * the whole saved block from `m`. A damaged file (no intact copy) is left alone.
 */
export function storeRecords(cards: MemoryCards, m: Mem): StoreResult {
  return cards.outsideGame(() => {
    const ram = m.bytes.subarray(SAVE & 0x1fffff, (SAVE & 0x1fffff) + SAVE_SIZE);
    const f = readFile(cards);
    if (f === null) return 'damaged';
    let file: Uint8Array;
    let block: Uint8Array;
    let result: StoreResult;
    if (f === 'none') {
      const fd = cards.open(FILE, (1 << 16) | FCREAT);
      if (fd < 0) return cards.image(0) ? 'no room' : 'no card';
      cards.close(fd);
      file = new Uint8Array(FILE_SIZE);
      // The header from PAZLE.EXE's data (its title and icon), as its save screen builds it.
      file.set(saveHeader(new Mem()));
      block = ram.slice();
      result = 'created';
    } else {
      file = f.file;
      block = f.block;
      const merged = mergeRecords(block, ram);
      if (merged.every((v, i) => v === block[i])) return 'unchanged';
      block.set(merged);
      result = 'updated';
    }
    file[SUM_A] = file[SUM_B] = xor(block);
    file.set(block, SUM_A + 1);
    file.set(block, SUM_B + 1);
    const fd = cards.open(FILE, (1 << 16) | FWRITE);
    if (fd < 0) return 'failed';
    const n = cards.write(fd, file);
    cards.close(fd);
    return n === FILE_SIZE ? result : 'failed';
  });
}
