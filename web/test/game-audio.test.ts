// The sound across the whole game (docs/re/audio.md §11): the power-route traces' sound fields
// (vs, kon, koff, spu, rev, cd, cdr) on the flow ports, per program run from its first tick and
// across the program changes the runs contain, on one audio model as the console has one SPU and
// one CD drive. The program ports' own fields are checked too (test/title.test.ts and
// test/ranking.test.ts also check the frames).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AudioModel } from '../src/audio/model';
import type { ProgramAudio } from '../src/audio/programs';
import { Vab } from '../src/audio/vab';
import * as A from '../src/core/addr';
import { decodeBase64, type Mem } from '../src/core/mem';
import type { ProgramName } from '../src/flow/program';
import { FACTORIES, PROGRAMS } from '../src/flow/registry';
import { loadMovie } from '../tools/movie';
import { loadTrace, type Trace } from '../tools/trace';
import { compareFlow } from './flow';
import { CARD_SIZE, formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import { RANKING_STARTS } from './fixtures/ranking-starts';
import { SELECT_STARTS } from './fixtures/select-starts';
import { SWON_CARDS } from './sw_on-cards';
import { TITLE_STARTS } from './fixtures/title-starts';

const ROOT = join(import.meta.dirname, '..', '..');
const ASSETS = join(ROOT, 'web/public/assets');
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));
const vab = new Vab(read('EF.VH'), read('EF.VB'));
const disc = JSON.parse(readFileSync(join(ASSETS, 'disc.json'), 'utf8'));
const audio = (m: Mem, first: ProgramAudio | undefined) => new AudioModel(vab, m, disc, { program: first });

const has = (name: string) => existsSync(join(ROOT, 're/traces', `${name}.jsonl.gz`));
const movieOf = (name: string) => {
  const path = join(ROOT, 're/movies', `${name}.tpm`);
  return loadMovie(existsSync(path) ? path : join(ROOT, 're/movies/power', `${name}.tpm`));
};
const traces = new Map<string, Trace>();
const trace = (name: string) => {
  if (!traces.has(name)) traces.set(name, loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`)));
  return traces.get(name)!;
};

function ram(ranges: { offset: number; base64: string }[] | undefined): Uint8Array {
  if (!ranges) throw new Error('no start state');
  const out = new Uint8Array(0x200000);
  for (const r of ranges) out.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
  return out;
}

/** The runs of `progs` (consecutive rows) that start with `first`, as row index ranges. */
function runs(t: Trace, first: ProgramName, progs: ProgramName[]): [number, number][] {
  const out: [number, number][] = [];
  t.rows.forEach((r, i) => {
    if (r.prog !== first || t.rows[i - 1]?.prog === first) return;
    let end = i;
    while (end + 1 < t.rows.length && progs.includes(t.rows[end + 1].prog as ProgramName)) end++;
    out.push([i, end]);
  });
  return out;
}

describe('the sound of the whole game', () => {
  // TIT_DEMO and the TITLE after it: TIT_DEMO's music, the change to TITLE (the reports during
  // the load), TITLE's music and effects.
  for (const name of ['attract-cycle', 'title-skip', 'title-anim', 'title-carry'].filter(has)) {
    const t = trace(name);
    for (const [s, e] of runs(t, 'TIT_DEMO', ['TIT_DEMO', 'TITLE'])) {
      const first = t.rows[s].t as number;
      const last = t.rows[e].t as number;
      it(`${name}, TIT_DEMO and TITLE, ticks ${first}-${last}`, () => {
        const r = compareFlow(movieOf(name), { ...t, rows: t.rows.slice(s, e + 1) }, {
          factories: FACTORIES,
          start: { prog: 'TIT_DEMO', ram: ram(TITLE_STARTS[`${name}:${first - 1}`]) },
          audio,
          to: last,
        });
        expect(r.report).toMatch(/^identical/);
        expect(r.ticks).toBe(e - s + 1);
      }, 60_000);
    }
  }

  // RANKING: its sound set-up after a load (from HOW_P, HOW_VS or Puzzle Mode).
  for (const name of ['attract-cycle', 'ranking-records'].filter(has)) {
    const t = trace(name);
    runs(t, 'RANKING', ['RANKING']).forEach(([s, e], k) => {
      it(`${name}, RANKING run ${k + 1}, ticks ${t.rows[s].t}-${t.rows[e].t}`, () => {
        const r = compareFlow(movieOf(name), { ...t, rows: t.rows.slice(s, e + 1) }, {
          factories: FACTORIES,
          start: { prog: 'RANKING', ram: ram(RANKING_STARTS[`${name}#${k + 1}`]) },
          onlyFirst: true,
          audio,
          // The first row's rand() count includes the boot program's calls (test/ranking.test.ts).
          ignore: ['rand'],
        });
        expect(r.report).toMatch(/^identical/);
        expect(r.ticks).toBe(e - s + 1);
      }, 60_000);
    });
  }

  // SELECT from its first tick (the cards as SW_ON left them, test/select.test.ts): the mode
  // select's music (track 27), effects, Option mode's sound test, stereo/mono and volumes, the
  // format's CD reset; then from power-on through it.
  const SELECT_CARDS: Record<string, () => Uint8Array> = {
    'select-tour': formattedCard,
    'select-card': formattedCard,
    'select-format': () => new Uint8Array(CARD_SIZE),
  };
  for (const [name, card] of Object.entries(SELECT_CARDS).filter(([n]) => has(n))) {
    const t = trace(name);
    const s = t.rows.findIndex((r) => r.prog === 'SELECT');
    let e = s;
    while (e + 1 < t.rows.length && t.rows[e + 1].prog === 'SELECT') e++;
    it(`${name}, SELECT, ticks ${t.rows[s].t}-${t.rows[e].t}`, () => {
      const cards = new MemoryCards(new MemoryBackend([card(), null]));
      cards.clear(0);
      const ranges = SELECT_STARTS[name];
      const r = compareFlow(movieOf(name), { ...t, rows: t.rows.slice(s, e + 1) }, {
        factories: FACTORIES,
        start: { prog: 'SELECT', ram: ram(ranges) },
        onlyFirst: true,
        cards,
        audio,
      });
      expect(r.report).toMatch(/^identical/);
      expect(r.ticks).toBe(e - s + 1);
    }, 60_000);
    it(`${name}, from power-on to SELECT's end (ticks 1-${t.rows[e].t})`, () => {
      const r = compareFlow(movieOf(name), { ...t, rows: t.rows.slice(0, e + 1) }, {
        factories: FACTORIES,
        cards: new MemoryCards(new MemoryBackend([card(), null])),
        audio,
      });
      expect(r.report).toMatch(/^identical/);
      expect(r.ticks).toBe(e + 1);
    }, 60_000);
  }

  // SW_ON with each card it can find, from power-on into TIT_DEMO's first ticks (a format's CD
  // reset in sw_on-unformatted).
  for (const [name, cards] of Object.entries(SWON_CARDS).filter(([n]) => has(n))) {
    it(`${name}, from power-on`, () => {
      const t = trace(name);
      const r = compareFlow(movieOf(name), t, {
        factories: FACTORIES,
        cards: new MemoryCards(new MemoryBackend(cards())),
        audio,
      });
      expect(r.report).toMatch(/^identical/);
      expect(r.ticks).toBe(t.rows.length);
    }, 60_000);
  }

  // The whole game from power-on (re/movies/power/full-run.tpm): every program change of a
  // complete run, Puzzle Mode's music and effects, its exit into RANKING and back to TIT_DEMO.
  it.skipIf(!has('full-run'))('full-run, from power-on, every tick', () => {
    const t = trace('full-run');
    const r = compareFlow(movieOf('full-run'), t, {
      factories: FACTORIES,
      cards: new MemoryCards(new MemoryBackend([formattedCard(), null])),
      audio,
    });
    expect(r.report).toMatch(/^identical/);
    expect(r.ticks).toBe(t.rows.length);
  }, 120_000);

  // From power-on through every ported program, as far as the trace runs ported programs.
  const swOn = PROGRAMS.SW_ON;
  for (const name of ['title-skip', 'title-carry'].filter(has)) {
    it.skipIf(!swOn)(`${name}, from power-on`, () => {
      const t = trace(name);
      let end = 0;
      while (end + 1 < t.rows.length && FACTORIES[t.rows[end + 1].prog as ProgramName]) end++;
      const r = compareFlow(movieOf(name), { ...t, rows: t.rows.slice(0, end + 1) }, {
        factories: FACTORIES,
        audio,
        to: t.rows[end].t as number,
      });
      expect(r.report).toMatch(/^identical/);
      expect(r.ticks).toBe(end + 1);
    }, 60_000);
  }
});
