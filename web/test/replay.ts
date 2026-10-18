// Plays a movie on the core and compares it with the original's trace, tick by tick.
import { Game, NotPorted } from '../src/core/game';
import type { Renderer } from '../src/render/renderer';
import type { Movie } from '../tools/movie';
import { sameValue, type Row, type Trace } from '../tools/trace';

export interface CompareOptions {
  ignore?: string[];
  to?: number;
  context?: number;
  /** Also render every tick and compare the GPU packet and frame hashes (ot, fb). */
  renderer?: Renderer;
}

/** Trace fields only the renderer produces. */
export const RENDER_FIELDS = ['ot', 'fb'];

export interface CompareResult {
  ok: boolean;
  ticks: number;
  report: string;
}

/** A game set up as the trace's first tick found it (counter and seed from the trace). */
export function gameForTrace(trace: Trace): Game {
  const first = trace.rows[0];
  return new Game({
    counter: (first.ctr as number) - 1,
    seed: first.seed as number,
    difficulty: first.difficulty as number,
  });
}

export function compareMovie(movie: Movie, trace: Trace, opts: CompareOptions = {}): CompareResult {
  const steps = compareSteps(movie, trace, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** compareMovie, giving the event loop a turn every 1,000 ticks (long runs in a test worker). */
export async function compareMovieAsync(movie: Movie, trace: Trace, opts: CompareOptions = {}): Promise<CompareResult> {
  const steps = compareSteps(movie, trace, opts);
  for (let n = 0; ; n++) {
    const r = steps.next();
    if (r.done) return r.value;
    if (n % 1000 === 999) await new Promise((resolve) => setImmediate(resolve));
  }
}

function* compareSteps(movie: Movie, trace: Trace, opts: CompareOptions): Generator<void, CompareResult> {
  const ignore = new Set([...(opts.ignore ?? []), ...(opts.renderer ? [] : RENDER_FIELDS)]);
  const fields = trace.fields.filter((f) => !ignore.has(f));
  const context = opts.context ?? 5;
  const to = Math.min(opts.to ?? Infinity, movie.last);
  const game = gameForTrace(trace);
  const mine: Row[] = [];
  let ticks = 0;
  for (const want of trace.rows) {
    const t = want.t as number;
    if (t > to) break;
    try {
      game.step(movie.inputs.get(t) ?? 0);
    } catch (e) {
      if (!(e instanceof NotPorted)) throw e;
      return { ok: false, ticks, report: `tick ${t}: not ported: ${e.message} (identical before)` };
    }
    const got = game.traceRow();
    got.t = t;
    if (opts.renderer) {
      const frame = opts.renderer.frame(game);
      got.ot = frame.ot;
      got.fb = frame.fb;
    }
    for (const poke of movie.pokes.get(t) ?? []) {
      if (poke.size === 4) game.m.w32(poke.address, poke.value);
      else if (poke.size === 2) game.m.w16(poke.address, poke.value);
      else game.m.w8(poke.address, poke.value);
    }
    mine.push(got);
    ticks++;
    yield;
    const bad = fields.filter((f) => !sameValue(got[f], want[f]));
    if (bad.length) {
      const lines = [`first difference at tick ${t}: ${bad.join(', ')}`];
      const start = Math.max(0, mine.length - 1 - context);
      for (let i = start; i < mine.length; i++) {
        const w = trace.rows[i];
        for (const f of bad) {
          const mark = sameValue(mine[i][f], w[f]) ? '  ' : '!=';
          lines.push(`  ${String(w.t).padStart(6)} ${f.padEnd(16)} ${JSON.stringify(w[f]).padStart(24)} ${mark} ${JSON.stringify(mine[i][f])}`);
        }
      }
      lines.push('  (left: original, right: port)');
      return { ok: false, ticks, report: lines.join('\n') };
    }
  }
  return { ok: true, ticks, report: `identical over ${ticks} ticks` };
}
