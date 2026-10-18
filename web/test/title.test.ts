// TIT_DEMO.EXE and TITLE.EXE (docs/re/title.md): every run of the story intro and the title
// screen that follows it in the title movies, replayed on the port, must equal the original's
// trace on every tick (their fields, rand() calls, se/bgm calls, unpacked items, the ordering
// table and the frame), and TITLE must name the program the original starts next. Until SW_ON
// and RANKING are ported, a run starts at TIT_DEMO's first tick from the state block the
// original's TIT_DEMO found (test/fixtures/title-starts.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import * as A from '../src/core/addr';
import { decodeBase64 } from '../src/core/mem';
import { PROGRAM_NAMES, type Program, type ProgramRenderer } from '../src/flow/program';
import { TIT_DEMO_MODULE } from '../src/programs/tit_demo';
import { TITLE_MODULE } from '../src/programs/title';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { compareFlow } from './flow';
import { TITLE_STARTS } from './fixtures/title-starts';
import { PROGRAMS } from '../src/flow/registry';

const ROOT = join(import.meta.dirname, '..', '..');
const MOVIES = ['attract-cycle', 'title-skip', 'title-anim', 'title-carry'].filter((n) => existsSync(join(ROOT, 're/traces', `${n}.jsonl.gz`)));
const pack = (name: string) => readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', name))));
const tdItems = pack(TIT_DEMO_MODULE.pack);
const tiItems = pack(TITLE_MODULE.pack);

/** The trace's frame hashes only (a ProgramRenderer's frame also names the buffer). */
const hashes = (r: ProgramRenderer) => ({
  frame: (p: Program) => {
    const f = r.frame(p);
    return { ot: f.ot, fb: f.fb };
  },
});

function startRam(key: string): Uint8Array {
  const ranges = TITLE_STARTS[key];
  if (!ranges) throw new Error(`no start state for ${key}`);
  const ram = new Uint8Array(0x200000);
  for (const r of ranges) ram.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
  return ram;
}

describe('TIT_DEMO.EXE and TITLE.EXE', () => {
  for (const name of MOVIES) {
    const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
    const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
    // Each run of TIT_DEMO and the TITLE after it.
    const starts = trace.rows.flatMap((r, i) => (r.prog === 'TIT_DEMO' && trace.rows[i - 1]?.prog !== 'TIT_DEMO' ? [i] : []));
    for (const start of starts) {
      let end = start;
      while (end + 1 < trace.rows.length && ['TIT_DEMO', 'TITLE'].includes(trace.rows[end + 1].prog as string)) end++;
      const first = trace.rows[start].t as number;
      const last = trace.rows[end].t as number;
      it(`${name}, ticks ${first}-${last}`, () => {
        const result = compareFlow(movie, { ...trace, rows: trace.rows.slice(start, end + 1) }, {
          factories: { TIT_DEMO: TIT_DEMO_MODULE.create, TITLE: TITLE_MODULE.create },
          renderers: {
            TIT_DEMO: () => hashes(TIT_DEMO_MODULE.renderer(tdItems)),
            TITLE: () => hashes(TITLE_MODULE.renderer(tiItems)),
          },
          start: { prog: 'TIT_DEMO', ram: startRam(`${name}:${first - 1}`) },
          to: last,
        });
        expect(result.report).toMatch(/^identical/);
        expect(result.ticks).toBe(end - start + 1);
        // The port's last row equals the original's (its exit flag and `next` included), and the
        // program it names is the one the original runs next.
        const after = trace.rows[end + 1];
        if (after) expect(PROGRAM_NAMES[trace.rows[end].next as number]).toBe(after.prog);
      }, 120_000);
    }
  }

  // From power-on, through the SW_ON port when it is there: the SW_ON-TIT_DEMO-TITLE chain of the
  // two short movies.
  const swOn = PROGRAMS.SW_ON;
  for (const name of MOVIES.filter((n) => n === 'title-skip' || n === 'title-carry')) {
    it.skipIf(!swOn)(`${name}, from power-on`, () => {
      const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      let end = 0;
      while (end + 1 < trace.rows.length && ['SW_ON', 'TIT_DEMO', 'TITLE'].includes(trace.rows[end + 1].prog as string)) end++;
      const swItems = pack(swOn!.pack);
      const result = compareFlow(movie, { ...trace, rows: trace.rows.slice(0, end + 1) }, {
        factories: { SW_ON: swOn!.create, TIT_DEMO: TIT_DEMO_MODULE.create, TITLE: TITLE_MODULE.create },
        renderers: {
          SW_ON: () => hashes(swOn!.renderer(swItems)),
          TIT_DEMO: () => hashes(TIT_DEMO_MODULE.renderer(tdItems)),
          TITLE: () => hashes(TITLE_MODULE.renderer(tiItems)),
        },
        to: trace.rows[end].t as number,
      });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(end + 1);
    }, 120_000);
  }
});
