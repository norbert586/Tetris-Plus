// Plays a movie on the core and compares it with the original's trace, tick by tick.
import { Game, NotPorted } from '../src/core/game';
import { powerOnLoad } from '../src/core/card';
import type { AudioModel } from '../src/audio/model';
import type { Renderer } from '../src/render/renderer';
import { movieCards, type Movie } from '../tools/movie';
import { join } from 'node:path';
import { sameValue, type Row, type Trace, type Value } from '../tools/trace';

export interface CompareOptions {
  ignore?: string[];
  to?: number;
  context?: number;
  /** Also render every tick and compare the GPU packet and frame hashes (ot, fb). */
  renderer?: Renderer;
  /** Also run the sound (the trace's vs, kon, koff, spu, rev, cd, cdr; trace version 3). */
  audio?: (game: Game) => AudioModel;
}

/** Trace fields only the renderer produces. */
export const RENDER_FIELDS = ['ot', 'fb'];
/** Trace fields only the audio model produces. */
export const AUDIO_FIELDS = ['vs', 'kon', 'koff', 'spu', 'rev', 'cd', 'cdr'];
/**
 * The CD's events (commands, the callback's reports, the CD volume: spu's 5th and 6th values)
 * are compared as sequences that may each be a tick early or late (docs/re/audio.md §6): where
 * the program's commands fall inside a tick isn't modelled.
 */
const TIMED = ['cd', 'cdr', 'cdvol'];
const SLACK = 1;

/** Matches two event sequences, allowing each event to move by SLACK ticks. */
class TimedEvents {
  private readonly got: [number, string][] = [];
  private readonly want: [number, string][] = [];

  add(t: number, got: Value[], want: Value[]): void {
    for (const g of got) this.got.push([t, JSON.stringify(g)]);
    for (const w of want) this.want.push([t, JSON.stringify(w)]);
  }

  /** The first mismatch that can no longer be resolved at tick `now` (Infinity: at the end). */
  check(field: string, now: number): string | undefined {
    while (this.got.length && this.want.length && this.got[0][1] === this.want[0][1]
      && Math.abs(this.got[0][0] - this.want[0][0]) <= SLACK) {
      this.got.shift();
      this.want.shift();
    }
    const g = this.got[0];
    const w = this.want[0];
    if (g && w && (g[1] !== w[1] || Math.abs(g[0] - w[0]) > SLACK)) {
      return `${field}: original ${w[1]} at tick ${w[0]}, port ${g[1]} at tick ${g[0]}`;
    }
    const lone = g ?? w;
    if (lone && now - lone[0] > SLACK) {
      return `${field}: ${g ? 'port' : 'original'} only: ${lone[1]} at tick ${lone[0]}`;
    }
    return undefined;
  }
}

export interface CompareResult {
  ok: boolean;
  ticks: number;
  report: string;
}

/** A game set up as the trace's first tick found it (counter and seed from the trace, the movie's cards). */
export function gameForTrace(trace: Trace, movie?: Movie): Game {
  const first = trace.rows[0];
  const game = new Game({
    counter: (first.ctr as number) - 1,
    seed: first.seed as number,
    difficulty: first.difficulty as number,
    cards: movie ? movieCards(movie, join(import.meta.dirname, '..', '..')) : undefined,
  });
  if (movie) powerOnLoad(game); // SW_ON's card load at power-on
  return game;
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
  const ignore = new Set([...(opts.ignore ?? []), ...(opts.renderer ? [] : RENDER_FIELDS),
    ...(opts.audio ? [] : AUDIO_FIELDS)]);
  const fields = trace.fields.filter((f) => !ignore.has(f) && !TIMED.includes(f));
  const timed = new Map(TIMED.map((f) => [f, f === 'cdvol' ? 'spu' : f])
    .filter(([, field]) => fields.includes(field) || (trace.fields.includes(field) && !ignore.has(field)))
    .map(([f]) => [f, new TimedEvents()]));
  const context = opts.context ?? 5;
  const to = Math.min(opts.to ?? Infinity, movie.last);
  const game = gameForTrace(trace, movie);
  // Traces before version 3 have no sound fields.
  const audio = trace.fields.includes('kon') ? opts.audio?.(game) : undefined;
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
    if (audio) {
      const vs = (want.vs as number | undefined) ?? 1;
      const s = audio.step(game.sound, vs);
      Object.assign(got, { vs, kon: s.kon, koff: s.koff, spu: audio.globals(), rev: audio.reverb(), cd: s.cd, cdr: s.cdr });
      const cdVolume = (row: Row | undefined) => ((row?.spu as number[] | undefined) ?? []).slice(4, 6);
      const changed = (a: Row, b: Row | undefined) => (b && sameValue(cdVolume(a), cdVolume(b)) ? [] : [cdVolume(a)]);
      timed.get('cd')?.add(t, got.cd as Value[], want.cd as Value[]);
      timed.get('cdr')?.add(t, got.cdr as Value[], want.cdr as Value[]);
      timed.get('cdvol')?.add(t, changed(got, mine[mine.length - 1]), changed(want, trace.rows[mine.length - 1]));
    }
    for (const poke of movie.pokes.get(t) ?? []) {
      if (poke.size === 4) game.m.w32(poke.address, poke.value);
      else if (poke.size === 2) game.m.w16(poke.address, poke.value);
      else game.m.w8(poke.address, poke.value);
    }
    mine.push(got);
    ticks++;
    yield;
    const bad = fields.filter((f) => !sameField(f, got[f], want[f]));
    for (const [f, events] of timed) {
      const problem = events.check(f, t);
      if (problem) return { ok: false, ticks, report: `difference by tick ${t}: ${problem}` };
    }
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
  for (const [f, events] of timed) {
    const problem = events.check(f, Infinity);
    if (problem) return { ok: false, ticks, report: `difference at the end: ${problem}` };
  }
  return { ok: true, ticks, report: `identical over ${ticks} ticks` };
}

/** Field equality; spu's CD volume is left to the timed events. */
function sameField(f: string, a: Value | undefined, b: Value | undefined): boolean {
  if (f === 'spu' && Array.isArray(a) && Array.isArray(b)) {
    return sameValue([...a.slice(0, 4), ...a.slice(6)], [...b.slice(0, 4), ...b.slice(6)]);
  }
  return sameValue(a, b);
}
