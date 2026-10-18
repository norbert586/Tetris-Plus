// Plays a "boot power" movie (trace version 4, docs/re/flow.md) on the whole-game runtime and
// compares it with the original's trace, tick by tick: the fields each program's port reports
// (Program.traceRow), its frames when a renderer is given, its sound when an audio model is
// given, and which program runs.
import type { AudioModel } from '../src/audio/model';
import { PROGRAM_AUDIO, type ProgramAudio } from '../src/audio/programs';
import type { Mem } from '../src/core/mem';
import { Console } from '../src/flow/console';
import type { MemoryCards } from '../src/flow/memcard';
import type { Program, ProgramFactory, ProgramName } from '../src/flow/program';
import type { Movie } from '../tools/movie';
import { sameValue, type Row, type Trace, type Value } from '../tools/trace';
import { AUDIO_FIELDS, sameField, TIMED, TimedEvents } from './replay';

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
  /** The memory cards the movie was recorded with (default: Console's, src/flow/memcard.ts). */
  cards?: MemoryCards;
  /**
   * Also run the sound (vs, kon, koff, spu, rev, cd, cdr) as test/replay.ts does, on one model
   * across program changes (the SPU and the drive carry over; each program's set-up runs on its
   * first tick). `first`: the first program's addresses. On the first compared row, the
   * reports of a drive started before it (a previous program's music, during the load) are not
   * compared, and from power-on neither are tick 1's key-ons and key-offs (the boot program's
   * SPU initialisation, not modelled).
   */
  audio?: (m: Mem, first: ProgramAudio | undefined) => AudioModel;
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
    cards: opts.cards,
  });
  let renderer = opts.renderers?.[c.program.name]?.(c.program);
  const audio = opts.audio && trace.fields.includes('kon') ? opts.audio(c.m, PROGRAM_AUDIO[c.program.name]) : undefined;
  const timed = new Map(TIMED.map((f) => [f, new TimedEvents()]));
  if (!audio) for (const f of AUDIO_FIELDS) ignore.add(f);
  const to = Math.min(opts.to ?? Infinity, movie.last);
  const context = opts.context ?? 5;
  const mine: Row[] = [];
  const theirs: Row[] = [];
  let ticks = 0;
  for (const want of rows) {
    const t = want.t as number;
    if (t > to) break;
    let started: ProgramAudio | undefined;
    if (c.program.exited) {
      if (opts.onlyFirst) break;
      c.startNext(want.mainseed as number);
      renderer = opts.renderers?.[c.program.name]?.(c.program);
      started = PROGRAM_AUDIO[c.program.name];
    }
    if (c.program.name !== want.prog) {
      return { ok: false, ticks, report: `tick ${t}: the original runs ${want.prog}, the port ${c.program.name}` };
    }
    c.step(movie.inputs.get(t) ?? 0);
    const p = c.program as Traced;
    const got: Row = { t, prog: p.name, ...(p.traceRow?.() ?? {}) };
    if (renderer) {
      const f = renderer.frame(p);
      Object.assign(got, { ot: f.ot, fb: f.fb });
    }
    if (audio) {
      const vs = (want.vs as number | undefined) ?? 1;
      const s = audio.step(p.sound, vs, started);
      Object.assign(got, { vs, kon: s.kon, koff: s.koff, spu: audio.globals(), rev: audio.reverb(), cd: s.cd, cdr: s.cdr });
      if (ticks === 0 && !opts.start) {
        got.kon = want.kon;
        got.koff = want.koff;
      }
      const cdVolume = (row: Row | undefined) => ((row?.spu as number[] | undefined) ?? []).slice(4, 6);
      const changed = (a: Row, b: Row | undefined) => (b && sameValue(cdVolume(a), cdVolume(b)) ? [] : [cdVolume(a)]);
      timed.get('cd')!.add(t, got.cd as Value[], want.cd as Value[]);
      timed.get('cdr')!.add(t, got.cdr as Value[], ticks === 0 ? [] : want.cdr as Value[]);
      timed.get('cdvol')!.add(t, changed(got, mine[mine.length - 1]), changed(want, theirs[theirs.length - 1]));
      got.cd = want.cd;
      got.cdr = want.cdr;
    }
    for (const poke of movie.pokes.get(t) ?? []) {
      if (poke.size === 4) c.m.w32(poke.address, poke.value);
      else if (poke.size === 2) c.m.w16(poke.address, poke.value);
      else c.m.w8(poke.address, poke.value);
    }
    mine.push(got);
    theirs.push(want);
    ticks++;
    const bad = Object.keys(got).filter((f) => !ignore.has(f) && !sameField(f, got[f], want[f]));
    for (const [f, events] of timed) {
      const problem = events.check(f, t);
      if (problem) return { ok: false, ticks, report: `difference by tick ${t} (${p.name}): ${problem}` };
    }
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
  for (const [f, events] of timed) {
    const problem = events.check(f, Infinity);
    if (problem) return { ok: false, ticks, report: `difference at the end: ${problem}` };
  }
  return { ok: true, ticks, report: `identical over ${ticks} ticks` };
}
