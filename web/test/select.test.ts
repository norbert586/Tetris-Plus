// SELECT.EXE (docs/re/select.md): the mode select and Option mode, replayed on the port from
// SELECT's first tick in each movie (re/movies/power/select-*.tpm), must equal the original's
// trace on every tick (its fields, rand() calls, image uploads, sound calls, the ordering table
// and the frame); the CD commands the program issues, the memory card it leaves and the program
// it names next must be the original's. Each movie runs from power-on (every program before
// SELECT is ported) and from SELECT's first tick, with the state block the original's SELECT
// found (test/fixtures/select-starts.ts). Also the port's one deviation: Classic, VS and Edit
// cannot be started.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import * as A from '../src/core/addr';
import { decodeBase64 } from '../src/core/mem';
import { Console } from '../src/flow/console';
import { CARD_SIZE, formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import { PROGRAM_NAMES } from '../src/flow/program';
import { FACTORIES } from '../src/flow/registry';
import { SELECT_MODULE } from '../src/programs/select';
import { Select } from '../src/programs/select/select';
import { loadMovie } from '../tools/movie';
import { loadTrace, sameValue } from '../tools/trace';
import { compareFlow } from './flow';
import { SELECT_STARTS } from './fixtures/select-starts';

const ROOT = join(import.meta.dirname, '..', '..');
const items = readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', SELECT_MODULE.pack))));

/**
 * Each movie's slot-1 card as the run started (slot 2 empty in all), and the SHA-256 of the card
 * the original's run left (the emulator's memcard1.mcd at the end of the run).
 */
const MOVIES: { name: string; card: () => Uint8Array; after: string }[] = [
  { name: 'select-tour', card: formattedCard, after: 'ac0dbcb89e54bcddf7c698fb6fe52cb0ca71977dba2d28e521d6ed556c7a11b5' },
  { name: 'select-card', card: formattedCard, after: '19d46c3c3cca9e836a25d8b339a231a15a12b51ccd11caf3a6bbadef832ad972' },
  { name: 'select-format', card: () => new Uint8Array(CARD_SIZE), after: 'ddd573afaca6c0310f1e7ea11810c49358723f5492834686d42fdd80f80e9dd8' },
];

function startRam(name: string): Uint8Array {
  const ram = new Uint8Array(0x200000);
  for (const r of SELECT_STARTS[name]) ram.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
  return ram;
}

/**
 * The movie's cards, as SW_ON left them: its card check (libcard's _card_info and _card_clear on
 * slot 1) has already taken the new-card event of a card that was in the slot at power-on.
 */
function cardsFor(card: () => Uint8Array): MemoryCards {
  const cards = new MemoryCards(new MemoryBackend([card(), null]));
  cards.clear(0);
  return cards;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('SELECT.EXE', () => {
  for (const { name, card, after } of MOVIES) {
    const movie = loadMovie(join(ROOT, 're/movies/power', `${name}.tpm`));
    const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
    const first = trace.rows.findIndex((r) => r.prog === 'SELECT');
    let end = first;
    while (end < trace.rows.length && trace.rows[end].prog === 'SELECT') end++;
    const rows = trace.rows.slice(first, end);
    const next = trace.rows[end];

    it(`${name} (ticks ${rows[0].t}-${rows[rows.length - 1].t})`, () => {
      const cards = cardsFor(card);
      const result = compareFlow(movie, { ...trace, rows }, {
        factories: { SELECT: SELECT_MODULE.create },
        renderers: { SELECT: () => SELECT_MODULE.renderer(items) },
        start: { prog: 'SELECT', ram: startRam(name) },
        onlyFirst: true,
        cards,
      });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(rows.length);
      // The card the run leaves. In select-format SELECT starts again after the soft reset to
      // the title, and its card set-up rewrites the card's frame 63 (MemoryCards.init). The
      // soft reset is beyond compareFlow, so the test runs that set-up itself.
      if (trace.rows.slice(end).some((r) => r.prog === 'SELECT')) cards.init();
      expect(sha256(cards.image(0)!)).toBe(after);
    }, 60_000);

    it(`${name} from power-on (ticks 1-${rows[rows.length - 1].t})`, () => {
      // Every program before SELECT is ported: the whole run, with the cards as at power-on.
      const all = trace.rows.slice(0, end);
      const result = compareFlow(movie, { ...trace, rows: all }, {
        factories: FACTORIES,
        renderers: { SELECT: () => SELECT_MODULE.renderer(items) },
        cards: new MemoryCards(new MemoryBackend([card(), null])),
      });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(all.length);
    }, 60_000);

    it(`${name}: CD commands and the next program`, () => {
      // The trace's cd field also has the commands of the CD callback (the music's loop, run
      // between ticks; the audio layer's), so the program's own must open each tick's list.
      const c = new Console({ SELECT: SELECT_MODULE.create }, {
        first: 'SELECT', seed: rows[0].mainseed as number, ram: startRam(name), cards: cardsFor(card),
      });
      for (const r of rows) {
        c.step(movie.inputs.get(r.t as number) ?? 0);
        const mine = (c.program as Select).cd;
        const theirs = (r.cd as number[][] | undefined) ?? [];
        if (!sameValue(theirs.slice(0, mine.length), mine)) {
          throw new Error(`tick ${r.t}: CD commands ${JSON.stringify(mine)}, the original's ${JSON.stringify(theirs)}`);
        }
      }
      if (!next) return;
      // The program's last tick named the next program (or, for the soft reset, the tail of the
      // next loop iteration, which runs with the next tick's pad).
      if (!c.program.exited) c.step(movie.inputs.get(next.t as number) ?? 0);
      expect(c.program.exited).toBe(true);
      expect(PROGRAM_NAMES[c.program.m.s32(A.NEXT_PROGRAM)]).toBe(next.prog);
    }, 60_000);
  }
});

describe('SELECT.EXE deviation: only Puzzle Mode starts', () => {
  const CROSS = 0x40, CIRCLE = 0x20, RIGHT = 0x2000;
  const M_STEP = 0x800b9094, M_SEL = 0x800b90a0;

  /** The mode select from SELECT's first tick, with the cursor on `sel` and its tile open. */
  function open(sel: number) {
    const c = new Console({ SELECT: SELECT_MODULE.create }, { first: 'SELECT', seed: 0, ram: startRam('select-tour'), cards: cardsFor(formattedCard) });
    const s = () => c.program as Select;
    const press = (pad: number, wait = 4) => {
      c.step(pad);
      for (let i = 0; i < wait; i++) c.step(0);
    };
    for (let i = 0; i < 80; i++) c.step(0);
    expect(s().m.s32(M_STEP)).toBe(4);
    for (let i = 0; i < sel; i++) press(RIGHT);
    expect(s().m.s32(M_SEL)).toBe(sel);
    press(CROSS, 30);
    expect(s().m.s32(M_STEP)).toBe(6);
    return { c, s, press };
  }

  for (const [sel, mode] of [[0, 'Classic'], [2, 'VS'], [3, 'Edit']] as const) {
    it(`Cross on ${mode} does nothing; Circle still goes back`, () => {
      const { s, press } = open(sel);
      press(CROSS, 120);
      expect(s().exited).toBe(false);
      expect(s().m.s32(M_STEP)).toBe(6);
      press(CIRCLE, 30);
      expect(s().m.s32(M_STEP)).toBe(4);
    });
  }

  it('Cross on Puzzle starts Puzzle Mode', () => {
    const { c, s } = open(1);
    c.step(CROSS);
    for (let i = 0; i < 90 && !s().exited; i++) c.step(0);
    expect(s().exited).toBe(true);
    expect(c.next).toBe('PAZLE');
  });

  it('state+0x4C = 2 (start the mode directly: Classic, as the cursor is cleared) shows the mode select', () => {
    const ram = startRam('select-tour');
    new DataView(ram.buffer).setUint32(A.NEXT_PARAM & 0x1fffff, 2, true);
    const c = new Console({ SELECT: SELECT_MODULE.create }, { first: 'SELECT', seed: 0, ram, cards: cardsFor(formattedCard) });
    c.step(0);
    c.step(0);
    const s = c.program as Select;
    expect(s.exited).toBe(false);
    expect(s.m.s32(A.NEXT_PARAM)).toBe(0);
    for (let i = 0; i < 80; i++) c.step(0);
    expect(s.m.s32(M_STEP)).toBe(4);
  });
});
