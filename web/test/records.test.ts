// The records the browser keeps on memory card 1 (src/flow/records.ts): written in the game's own
// save-file format, so SW_ON loads them at the next power-on; merged with the card's so records
// only improve; card calls that leave the programs' view of the card as it was. And Puzzle Mode's
// save screen without its card options.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as A from '../src/core/addr';
import type { Mem } from '../src/core/mem';
import { Console } from '../src/flow/console';
import { formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import { FACTORIES } from '../src/flow/registry';
import { cardRecords, mergeRecords, NO_TIME, readRecords, RECORDS, RECORDS_SIZE, storeRecords } from '../src/flow/records';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { gameForTrace } from './replay';

const ROOT = join(import.meta.dirname, '..', '..');

const records = (m: Mem) => m.bytes.slice(RECORDS & 0x1fffff, (RECORDS & 0x1fffff) + RECORDS_SIZE);

/** Powers on with `card` in slot 1 and runs SW_ON: the state block as it hands over to TIT_DEMO. */
function powerOn(card: Uint8Array): Console {
  const c = new Console(FACTORIES, { cards: new MemoryCards(new MemoryBackend([card, null])) });
  for (let i = 0; i < 2000 && c.program.name === 'SW_ON'; i++) c.step(0);
  expect(c.program.name).toBe('TIT_DEMO');
  return c;
}

/** Sets a stage's best time and a Puzzle ranking entry (name ZZZ) in RAM. */
function play(m: Mem, stage: number, time: number, score?: number): void {
  m.w16(RECORDS + 2 * stage, time);
  if (score === undefined) return;
  // The top entry, as name entry would put a winning score there (the rest move down).
  const table = RECORDS + 0x118;
  for (let i = 4; i > 0; i--) m.bytes.copyWithin((table + 12 * i) & 0x1fffff, (table + 12 * (i - 1)) & 0x1fffff, ((table + 12 * (i - 1)) & 0x1fffff) + 12);
  m.w8(table, 25);
  m.w8(table + 1, 25);
  m.w8(table + 2, 25);
  m.w32(table + 4, score);
  m.w8(table + 8, 3);
  m.w8(table + 9, 1);
}

describe('records on the memory card', () => {
  it('a blank card gets a save file that SW_ON loads at the next power-on', () => {
    const first = powerOn(formattedCard());
    const cards = first.shared.cards!;
    expect(cardRecords(cards)).toBeNull();
    play(first.m, 7, 456, 20000);
    expect(storeRecords(cards, first.m)).toBe('created');
    const written = records(first.m);
    expect(cardRecords(cards)).toEqual(written);

    const next = powerOn(cards.image(0)!);
    expect(records(next.m)).toEqual(written);
    const r = readRecords(records(next.m));
    expect(r.best[7]).toBe(456);
    expect(r.best[8]).toBe(NO_TIME);
    expect(r.puzzle[0]).toEqual({ name: 'ZZZ', score: 20000, a: 1, b: 3 });
    expect(r.puzzle[1].name).toBe('ABC');
  });

  it('an existing save file keeps its other parts; only the records change', () => {
    const first = powerOn(formattedCard());
    const cards = first.shared.cards!;
    expect(storeRecords(cards, first.m)).toBe('created');
    const before = cards.image(0)!;
    // Unchanged records: nothing is written.
    expect(storeRecords(cards, first.m)).toBe('unchanged');
    expect(cards.image(0)).toEqual(before);
    // The rest of the saved block (the save slots, the settings) in RAM differs from the card's:
    // it is not written.
    first.m.w8(A.S + 0x4aed8, 0x05);
    first.m.w8(A.S + 0x4b4fe, 3);
    play(first.m, 2, 300);
    expect(storeRecords(cards, first.m)).toBe('updated');
    const next = powerOn(cards.image(0)!);
    expect(next.m.u16(RECORDS + 4)).toBe(300);
    expect(next.m.u8(A.S + 0x4aed8)).toBe(0xff);
    expect(next.m.u8(A.S + 0x4b4fe)).toBe(1);
  });

  it('records only improve: older RAM (a loaded save) merges with the card', () => {
    const c = powerOn(formattedCard());
    const cards = c.shared.cards!;
    play(c.m, 4, 200, 30000);
    expect(storeRecords(cards, c.m)).toBe('created');
    // A saved game from before: stage 4 slower, no 30000; but a new best on stage 9.
    const older = powerOn(formattedCard());
    play(older.m, 4, 500);
    play(older.m, 9, 111, 15000);
    expect(storeRecords(cards, older.m)).toBe('updated');
    const r = readRecords(cardRecords(cards)!);
    expect(r.best[4]).toBe(200);
    expect(r.best[9]).toBe(111);
    expect(r.puzzle.map((e) => e.score)).toEqual([30000, 15000, 10000, 5000, 3000]);
  });

  it('merging: lower times, entries by score once each, the older first among equals', () => {
    const base = records(powerOn(formattedCard()).m);
    const a = base.slice();
    const b = base.slice();
    const dv = (x: Uint8Array) => new DataView(x.buffer);
    dv(a).setUint16(0, 100, true);
    dv(b).setUint16(0, 90, true);
    dv(a).setUint16(2, 80, true);
    dv(b).setUint16(2, NO_TIME, true);
    // b's top Puzzle entry: another name with the same score as the default top.
    b[0x118] = 3;
    const m = readRecords(mergeRecords(a, b));
    expect(m.best.slice(0, 2)).toEqual([90, 80]);
    expect(m.puzzle.map((e) => `${e.name} ${e.score}`)).toEqual(['ABC 10000', 'DBC 10000', 'DEF 5000', 'GHI 3000', 'JKL 2000']);
    // The Classic table is the same in both: unchanged.
    expect(readRecords(mergeRecords(a, b)).classic).toEqual(readRecords(a).classic);
  });

  it('leaves the programs\' view of the card as it was: the new-card flag and the waits', () => {
    const c = powerOn(formattedCard());
    const cards = c.shared.cards!;
    cards.insert(0, cards.image(0)!);
    const waits = cards.vblanks;
    play(c.m, 1, 50);
    expect(storeRecords(cards, c.m)).toBe('created');
    expect(cards.vblanks).toBe(waits);
    // The next card check still sees a new card (libcard's NEWCARD event, 3).
    expect(cards.info(0)).toBe(3);
  });

  it('without a card nothing is written; a damaged file is left alone', () => {
    const c = powerOn(formattedCard());
    const none = new MemoryCards(new MemoryBackend([null, null]));
    expect(storeRecords(none, c.m)).toBe('no card');
    const cards = c.shared.cards!;
    play(c.m, 1, 50);
    storeRecords(cards, c.m);
    const image = cards.image(0)!;
    // Both copies' checksums broken.
    // The file's block: its directory frame (1-15) says 0x51, the first block of a file.
    let block = 1;
    while (image[block * 0x80] !== 0x51) block++;
    image[block * 0x2000 + 0x200] ^= 0xff;
    image[block * 0x2000 + 0x981] ^= 0xff;
    cards.insert(0, image);
    play(c.m, 1, 40);
    expect(storeRecords(cards, c.m)).toBe('damaged');
    expect(cards.image(0)).toEqual(image);
  });
});

describe("Puzzle Mode's save screen in the browser (Shared.browserSaving)", () => {
  it('shows the password and EXIT only; Up and Down do nothing; Cross leaves without the card', () => {
    const movie = loadMovie(join(ROOT, 're/movies/egypt1-idle.tpm'));
    const trace = loadTrace(join(ROOT, 're/traces/egypt1-idle.jsonl.gz'));
    const g = gameForTrace(trace);
    (g as { browserSaving: boolean }).browserSaving = true;
    const image = (n: number) => g.m.s32(A.obj(n) + A.O_IMAGE);
    // The movie reaches the save screen at tick 17077; from 17300 on, only these presses.
    const presses: Record<number, number> = { 17300: 0x1000, 17320: 0x4000, 17340: 0x4000, 17400: 0x40 };
    let t = 1;
    for (; t < 17300; t++) g.step(movie.inputs.get(t) ?? 0);
    expect(g.m.s32(A.SCREEN)).toBe(13);
    expect(image(0xd2)).toBe(0); // "SAVE DATA?"
    expect(image(0xd3)).toBe(g.m.s32(0x800e27b4 + 0x20) + 0x10000); // EXIT, highlighted
    expect(image(0xd4)).toBe(0);
    expect(image(0xd5)).toBe(0);
    const waits = g.cards.vblanks;
    for (; t < 17400; t++) g.step(presses[t] ?? 0);
    expect(g.m.s32(A.SCREEN)).toBe(13);
    expect(image(0xd3)).toBe(g.m.s32(0x800e27b4 + 0x20) + 0x10000);
    g.step(presses[t]);
    g.step(0);
    expect(g.m.s32(A.SCREEN)).toBe(8);
    expect(g.cards.vblanks).toBe(waits);
  });
});
