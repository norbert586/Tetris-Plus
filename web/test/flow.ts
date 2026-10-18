// Plays a "boot power" movie (trace version 4, docs/re/flow.md) on the whole-game runtime and
// compares it with the original's trace, tick by tick: the fields each program's port reports
// (Program.traceRow), its frames when a renderer is given, and which program runs.
import { Console } from '../src/flow/console';
import type { Program, ProgramFactory, ProgramName } from '../src/flow/program';
import type { Movie } from '../tools/movie';
import { sameValue, type Row, type Trace } from '../tools/trace';

/** Draws a program's frames; made anew for each run of a program (its VRAM starts cleared). */
export interface FlowRenderer {
  frame(p: Program): { ot: number; fb: number };
}

export interface FlowOptions {
  factories: Partial<Record<ProgramName, ProgramFactory>>;
  /** Also compare ot and fb for the programs that have a renderer. */
  renderers?: Partial<Record<ProgramName, (p: Program) => FlowRenderer>>;
  /**
   * Start at the first tick of this program's first run in the trace, from a RAM dump taken at
   * its main (scripts/run-movie.sh with TP_MAIN_RAM=1), instead of from power-on.
   */
  start?: { prog: ProgramName; ram: Uint8Array };
  /** Stop at the end of the first run of `start.prog` (or of the first program). */
  onlyFirst?: boolean;
  ignore?: string[];
  to?: number;
  context?: number;
}

export interface FlowResult {
  ok: boolean;
  ticks: number;
  report: string;
}

/** The fields a port reports for a trace comparison (src/flow/program.ts). */
type Traced = Program & { traceRow?(): Row };

export function compareFlow(movie: Movie, trace: Trace, opts: FlowOptions): FlowResult {
  const ignore = new Set(opts.ignore ?? []);
  let rows = trace.rows;
  if (opts.start) {
    const i = rows.findIndex((r) => r.prog === opts.start!.prog);
    if (i < 0) return { ok: false, ticks: 0, report: `the trace never runs ${opts.start.prog}` };
    rows = rows.slice(i);
  }
  const first = rows[0];
  const c = new Console(opts.factories, {
    first: first.prog as ProgramName,
    seed: first.mainseed as number,
    ram: opts.start?.ram,
  });
  let renderer = opts.renderers?.[c.program.name]?.(c.program);
  const to = Math.min(opts.to ?? Infinity, movie.last);
  const context = opts.context ?? 5;
  const mine: Row[] = [];
  const theirs: Row[] = [];
  let ticks = 0;
  for (const want of rows) {
    const t = want.t as number;
    if (t > to) break;
    if (c.program.exited) {
      if (opts.onlyFirst) break;
      c.startNext(want.mainseed as number);
      renderer = opts.renderers?.[c.program.name]?.(c.program);
    }
    if (c.program.name !== want.prog) {
      return { ok: false, ticks, report: `tick ${t}: the original runs ${want.prog}, the port ${c.program.name}` };
    }
    c.step(movie.inputs.get(t) ?? 0);
    const p = c.program as Traced;
    const got: Row = { t, prog: p.name, ...(p.traceRow?.() ?? {}) };
    if (renderer) Object.assign(got, renderer.frame(p));
    for (const poke of movie.pokes.get(t) ?? []) {
      if (poke.size === 4) c.m.w32(poke.address, poke.value);
      else if (poke.size === 2) c.m.w16(poke.address, poke.value);
      else c.m.w8(poke.address, poke.value);
    }
    mine.push(got);
    theirs.push(want);
    ticks++;
    const bad = Object.keys(got).filter((f) => !ignore.has(f) && !sameValue(got[f], want[f]));
    if (bad.length) {
      const lines = [`first difference at tick ${t} (${p.name}): ${bad.join(', ')}`];
      for (let i = Math.max(0, mine.length - 1 - context); i < mine.length; i++) {
        for (const f of bad) {
          const mark = sameValue(mine[i][f], theirs[i][f]) ? '  ' : '!=';
          lines.push(`  ${String(theirs[i].t).padStart(6)} ${f.padEnd(16)} ${JSON.stringify(theirs[i][f]).padStart(24)} ${mark} ${JSON.stringify(mine[i][f])}`);
        }
      }
      lines.push('  (left: original, right: port)');
      return { ok: false, ticks, report: lines.join('\n') };
    }
  }
  return { ok: true, ticks, report: `identical over ${ticks} ticks` };
}
