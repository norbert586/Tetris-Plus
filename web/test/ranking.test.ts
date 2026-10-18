// RANKING.EXE (docs/re/ranking.md): every run of it in the ranking movies, replayed on the port
// from the run's first tick, must equal the original's trace on every tick (its fields, rand()
// calls, the ordering table and the frame), and the program it names next must be the one the
// original starts. Until every program before it is ported, a run starts from the state block
// the original's RANKING found (test/fixtures/ranking-starts.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import * as A from '../src/core/addr';
import { decodeBase64 } from '../src/core/mem';
import { Console } from '../src/flow/console';
import { PROGRAM_NAMES, type Program, type ProgramName } from '../src/flow/program';
import { FACTORIES } from '../src/flow/registry';
import { RANKING_MODULE } from '../src/programs/ranking';
import { Ranking } from '../src/programs/ranking/ranking';
import { loadMovie } from '../tools/movie';
import { loadTrace, sameValue, type Row, type Trace } from '../tools/trace';
import { compareFlow } from './flow';
import { RANKING_STARTS } from './fixtures/ranking-starts';

const ROOT = join(import.meta.dirname, '..', '..');
const MOVIES = ['attract-cycle', 'ranking-records'].filter((n) => existsSync(join(ROOT, 're/traces', `${n}.jsonl.gz`)));
const items = readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', RANKING_MODULE.pack))));

/** The rows of each run of RANKING in a trace: a run starts where `prog` changes to it. */
function runs(trace: Trace): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  trace.rows.forEach((r, i) => {
    if (r.prog !== 'RANKING') return;
    if (i > 0 && trace.rows[i - 1].prog === 'RANKING') out[out.length - 1].end = i + 1;
    else out.push({ start: i, end: i + 1 });
  });
  return out;
}

function startRam(name: string): Uint8Array {
  const ranges = RANKING_STARTS[name];
  if (!ranges) throw new Error(`no start state for ${name}`);
  const ram = new Uint8Array(0x200000);
  for (const r of ranges) ram.set(decodeBase64(r.base64), (A.S + r.offset) & 0x1fffff);
  return ram;
}

describe('RANKING.EXE', () => {
  for (const name of MOVIES) {
    const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
    const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
    runs(trace).forEach((run, k) => {
      it(`${name}, run ${k + 1} (ticks ${trace.rows[run.start].t}-${trace.rows[run.end - 1].t})`, () => {
        const rows = trace.rows.slice(run.start, run.end);
        // The first row's rand() count also has the boot program's calls before main, which the
        // port skips (it starts from the trace's mainseed): the seed shows main made none itself.
        expect(rows[0].seed).toBe(rows[0].mainseed);
        rows[0] = { ...rows[0], rand: 0 };
        const after = trace.rows[run.end] as Row | undefined;
        const last = rows[rows.length - 1];
        const reset = after !== undefined && after.prog === 'TITLE' && last.exit === 0;
        // From power-on once every program the movie runs before this one is ported (and traced
        // without gaps); until then from the state block the original's RANKING found.
        const before = trace.rows.slice(0, run.start);
        const fromPowerOn = before.length > 0 && before[0].t === 1 && before.every((r, i) => FACTORIES[r.prog as ProgramName] && (i === 0 || r.t === (before[i - 1].t as number) + 1));
        const result = fromPowerOn
          ? compareFlow(movie, { ...trace, rows: [...before, ...rows] }, {
              factories: FACTORIES,
              renderers: { RANKING: () => RANKING_MODULE.renderer(items) },
              ignore: ['buffer'],
            })
          : compareFlow(movie, { ...trace, rows }, {
              factories: { RANKING: RANKING_MODULE.create },
              renderers: { RANKING: () => RANKING_MODULE.renderer(items) },
              start: { prog: 'RANKING', ram: startRam(`${name}#${k + 1}`) },
              onlyFirst: true,
              ignore: ['buffer'], // the renderer's buffer number (not traced)
            });
        expect(result.report).toMatch(/^identical/);
        expect(result.ticks).toBe(rows.length + (fromPowerOn ? before.length : 0));
        if (!after) return;
        if (reset) {
          // The soft reset happens in the loop's tail after the last sample, with the pad word of
          // the next tick: replay the run and that tail, then check what it named.
          expect(softResetHandOff(movie.inputs, rows, `${name}#${k + 1}`, after.t as number)).toBe(after.prog);
        } else {
          expect(last.exit).toBe(1);
          expect(PROGRAM_NAMES[last.next as number]).toBe(after.prog);
        }
      }, 60_000);
    });
  }
});

/** Replays a run that ends in the soft reset and returns the program its tail names. */
function softResetHandOff(inputs: Map<number, number>, rows: Row[], start: string, next: number): string {
  const ram = startRam(start);
  const c = new Console({ RANKING: RANKING_MODULE.create }, { first: 'RANKING', seed: rows[0].mainseed as number, ram });
  for (const r of rows) c.step(inputs.get(r.t as number) ?? 0);
  (c.program as Ranking).tail(inputs.get(next) ?? 0);
  const p: Program = c.program;
  if (!p.exited) return 'none';
  const m = p.m;
  expect(sameValue([m.s32(A.PHASE), m.s32(A.NEXT_PARAM)], [9, 0])).toBe(true);
  return PROGRAM_NAMES[m.s32(A.NEXT_PROGRAM)];
}
