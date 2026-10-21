// Plays a movie on the core and compares it with the original's trace, tick by tick.
import { Game, NotPorted } from '../src/core/game';
import * as A from '../src/core/addr';
import { Machine, PROGRAM_NAMES, type AnyProgram } from '../src/core/machine';
import { powerOnBlock } from '../src/core/programs/sw_on/power-on-block';
import type { AudioModel } from '../src/audio/model';
import type { Mem } from '../src/core/mem';
import type { Renderer } from '../src/render/renderer';
import { movieCards, type Movie } from '../tools/movie';
import { join } from 'node:path';
import { sameValue, type Row, type Trace, type Value } from '../tools/trace';

export interface CompareOptions {
  ignore?: string[];
  to?: number;
  context?: number;
  /** Also render every tick and compare the GPU packet and frame hashes (ot, fb): PAZLE's renderer. */
  renderer?: Renderer;
  /** The renderer for each other program (by name), if frames are compared for it. */
  renderers?: Record<string, Renderer>;
  /**
   * Also run the sound (the trace's vs, kon, koff, spu, rev, cd, cdr; trace version 3): one model
   * on the machine's memory for the whole movie, as the SPU and the drive outlast each program.
   */
  audio?: (m: Mem) => AudioModel;
  /**
   * Start at this segment (1-based) instead of the first, with the shared state block taken from
   * `ram`, a TP_RAM_START=1 dump of that segment's start (the counter and seed come from the trace).
   */
  fromSegment?: number;
  ram?: Uint8Array;
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

/**
 * For runs that start in Puzzle Mode: the persistent block SW_ON.EXE leaves at power-on for the
 * movie's cards (power-on-block.ts runs it on copies of them).
 */
function powerOnState(game: Game, movie: Movie): void {
  const block = powerOnBlock(movieCards(movie, join(import.meta.dirname, '..', '..')));
  game.m.bytes.set(block, (A.S + 0x4ad84) & 0x1fffff);
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
  if (movie) powerOnState(game, movie);
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

/** The seed `calls` rand() calls before `seed` (the LCG run backwards). */
export function unwindSeed(seed: number, calls: number): number {
  const INVERSE = 0xeeb9eb65; // 1103515245^-1 mod 2^32
  let s = seed >>> 0;
  for (let i = 0; i < calls; i++) s = Math.imul((s - 12345) | 0, INVERSE) >>> 0;
  return s;
}

/** A machine set up as the trace's first tick found it, running the trace's first program. */
export function machineForTrace(trace: Trace, movie: Movie): Machine {
  const first = trace.rows[0];
  const names = PROGRAM_NAMES;
  const machine = new Machine({
    counter: (first.ctr as number) - 1,
    seed: unwindSeed(first.seed as number, first.rand as number),
    difficulty: first.difficulty as number | undefined,
    cards: movieCards(movie, join(import.meta.dirname, '..', '..')),
    first: names.indexOf(trace.segments[0].program),
  });
  if (machine.program instanceof Game) powerOnState(machine.program, movie);
  return machine;
}

function* compareSteps(movie: Movie, trace: Trace, opts: CompareOptions): Generator<void, CompareResult> {
  const machine = machineForTrace(trace, movie);
  // Traces before version 3 have no sound fields.
  const audio = trace.segments[0].fields.includes('kon') ? opts.audio?.(machine.m) : undefined;
  const k0 = (opts.fromSegment ?? 1) - 1;
  if (k0 > 0) {
    // The shared state block as the dump has it (re/tools/extract_state.py's rules: not the GPU
    // and decoder work areas), then the boot program starts the program the block names.
    if (!opts.ram) throw new Error('fromSegment needs a RAM dump');
    const base = A.S & 0x1fffff;
    machine.m.bytes.set(opts.ram.subarray(base, base + 0x206e4), base);
    machine.m.bytes.set(opts.ram.subarray(base + 0x4ad84, base + 0x4b544), base + 0x4ad84);
    machine.next();
    const first = trace.segments[k0].rows[0];
    machine.m.w32(A.COUNTER, (first.ctr as number) - 1);
    machine.ctx.rng.seed = unwindSeed(first.seed as number, first.rand as number);
  }
  let ticks = 0;
  for (let k = k0; k < trace.segments.length; k++) {
    const seg = trace.segments[k];
    const mseg = movie.segments[k] ?? { inputs: new Map(), pokes: new Map(), last: -1 };
    if (k > k0) {
      // The program the original started next: the port's must have exited and named it.
      if (!machine.program.exited) {
        return { ok: false, ticks, report: `${seg.program} started in the original; the port's ${machine.program.name} is still running` };
      }
      try {
        machine.next();
      } catch (e) {
        if (!(e instanceof NotPorted)) throw e;
        return { ok: false, ticks, report: `segment ${k + 1}: not ported: ${e.message} (identical before)` };
      }
      if (machine.program.name !== seg.program) {
        return { ok: false, ticks, report: `segment ${k + 1}: the original started ${seg.program}, the port ${machine.program.name}` };
      }
      // The boot program's loading frames aren't modelled: take the counter and seed it left.
      const first = seg.rows[0];
      machine.m.w32(A.COUNTER, (first.ctr as number) - 1);
      machine.ctx.rng.seed = unwindSeed(first.seed as number, first.rand as number);
    }
    const prefix = trace.segments.length > 1 ? `${seg.program}: ` : '';
    const r = yield* compareSegment(machine.program, seg.fields, seg.rows, mseg, k === 0 ? movie.last : mseg.last, opts, prefix, audio);
    ticks += r.ticks;
    if (!r.ok) return { ...r, ticks };
  }
  return { ok: true, ticks, report: `identical over ${ticks} ticks` };
}

function* compareSegment(
  game: AnyProgram,
  traceFields: string[],
  rows: Row[],
  movie: { inputs: Map<number, number>; pokes: Map<number, { address: number; value: number; size: number }[]> },
  last: number,
  opts: CompareOptions,
  prefix: string,
  model: AudioModel | undefined,
): Generator<void, CompareResult> {
  const renderer = game.name === 'PAZLE' ? opts.renderer : opts.renderers?.[game.name];
  const ignore = new Set([...(opts.ignore ?? []), ...(renderer ? [] : RENDER_FIELDS),
    ...(model ? [] : AUDIO_FIELDS)]);
  const fields = traceFields.filter((f) => !ignore.has(f) && !TIMED.includes(f));
  const timed = new Map(TIMED.map((f) => [f, f === 'cdvol' ? 'spu' : f])
    .filter(([, field]) => fields.includes(field) || (traceFields.includes(field) && !ignore.has(field)))
    .map(([f]) => [f, new TimedEvents()]));
  const context = opts.context ?? 5;
  const to = Math.min(opts.to ?? Infinity, last < 0 ? Infinity : last);
  const audio = traceFields.includes('kon') ? model : undefined;
  const trace = { rows };
  const mine: Row[] = [];
  let ticks = 0;
  for (const want of rows) {
    const t = want.t as number;
    if (t > to) break;
    try {
      game.step(movie.inputs.get(t) ?? 0);
    } catch (e) {
      if (!(e instanceof NotPorted)) throw e;
      return { ok: false, ticks, report: `${prefix}tick ${t}: not ported: ${e.message} (identical before)` };
    }
    const got = game.traceRow() as Row;
    got.t = t;
    if (renderer) {
      const frame = renderer.frame(game);
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
      if (problem) return { ok: false, ticks, report: `${prefix}difference by tick ${t}: ${problem}` };
    }
    if (bad.length) {
      const lines = [`${prefix}first difference at tick ${t}: ${bad.join(', ')}`];
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
    if (problem) return { ok: false, ticks, report: `${prefix}difference at the end: ${problem}` };
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
