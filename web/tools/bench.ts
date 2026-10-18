// Times the game in Node: the complete-run movie on the Console with each program's renderer,
// as the shell runs it (logic, drawing, the frame's pixels), per tick.
//   npx tsx tools/bench.ts [MOVIE] [--no-pixels]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPack } from '../src/assets/pack';
import { Console } from '../src/flow/console';
import { formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import type { Program, ProgramName, ProgramRenderer } from '../src/flow/program';
import { FACTORIES, PROGRAMS } from '../src/flow/registry';
import { toRgba } from '../src/render/present';
import { hashing } from '../src/render/renderer';
import { loadMovie } from './movie';
import { loadTrace } from './trace';

const ROOT = join(import.meta.dirname, '..', '..');
const name = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 're/movies/power/full-run.tpm');
const pixels = !process.argv.includes('--no-pixels');
// As the shell runs: no frame hashes (--hash to include them).
hashing.frames = process.argv.includes('--hash');
const movie = loadMovie(name);
const trace = loadTrace(join(ROOT, 're/traces', name.split('/').pop()!.replace(/\.tpm$/, '.jsonl.gz')));
const packs = new Map<string, Uint8Array[]>();
for (const mod of Object.values(PROGRAMS)) if (!packs.has(mod!.pack)) packs.set(mod!.pack, readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', mod!.pack)))));
const c = new Console(FACTORIES, { seed: trace.rows[0].mainseed as number, cards: new MemoryCards(new MemoryBackend([formattedCard(), null])) });
let renderer: ProgramRenderer | undefined;
let owner: Program | undefined;
const per: Record<string, { ticks: number; logic: number; draw: number; px: number; worst: number }> = {};
for (const row of trace.rows) {
  const t = row.t as number;
  if (c.program.exited) c.startNext(row.mainseed as number);
  const t0 = performance.now();
  c.step(movie.inputs.get(t) ?? 0);
  const t1 = performance.now();
  const p = c.program;
  if (p !== owner) {
    const mod = PROGRAMS[p.name as ProgramName]!;
    renderer = mod.renderer(packs.get(mod.pack)!);
    owner = p;
  }
  const f = renderer!.frame(p);
  const t2 = performance.now();
  if (pixels) toRgba(renderer!.pixels(f.buffer));
  const t3 = performance.now();
  const s = (per[p.name] ??= { ticks: 0, logic: 0, draw: 0, px: 0, worst: 0 });
  s.ticks++;
  s.logic += t1 - t0;
  s.draw += t2 - t1;
  s.px += t3 - t2;
  s.worst = Math.max(s.worst, t3 - t0);
}
for (const [n, s] of Object.entries(per)) {
  const ms = (v: number) => (v / s.ticks).toFixed(3);
  console.log(`${n.padEnd(9)} ${String(s.ticks).padStart(6)} ticks  logic ${ms(s.logic)} ms  draw ${ms(s.draw)} ms  pixels ${ms(s.px)} ms  worst ${s.worst.toFixed(1)} ms`);
}
