// Plays a movie on the core and the renderer and writes chosen frames as PNG files.
//
//   npx tsx tools/frames.ts MOVIE.tpm OUT_DIR TICK[,TICK...] [--hide-p2] [--scale N]
//
// The counter and seed come from the movie's trace in re/traces/ (as the golden-trace replay
// does). --hide-p2 leaves out player 2's sprites, as the shell will (docs/RESEARCH_AND_PLAN.md
// §9); --scale enlarges pixels N times. Ranges FIRST-LAST:EVERY work as in the harness.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readPack } from '../src/assets/pack';
import { Renderer } from '../src/render/renderer';
import { encodePng, toRgba } from '../src/render/present';
import { gameForTrace } from '../test/replay';
import { loadMovie } from './movie';
import { loadTrace } from './trace';

const ROOT = join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, d: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : d);
const [moviePath, outDir, tickList] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--scale');
if (!tickList) {
  console.error('usage: frames.ts MOVIE.tpm OUT_DIR TICK[,TICK...] [--hide-p2] [--scale N]');
  process.exit(2);
}
const ticks = new Set<number>();
for (const part of tickList.split(',')) {
  const r = part.match(/^(\d+)-(\d+):(\d+)$/);
  if (r) for (let t = +r[1]; t <= +r[2]; t += +r[3]) ticks.add(t);
  else ticks.add(Number(part));
}
const scale = option('--scale', 1);
const name = basename(moviePath, '.tpm');
const movie = loadMovie(moviePath);
const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
const renderer = new Renderer(readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets/pazlee.pack')))));
renderer.hidePlayer2 = flag('--hide-p2');
const game = gameForTrace(trace);
mkdirSync(outDir, { recursive: true });
const last = Math.max(...ticks);
for (let t = 1; t <= last && !game.exited; t++) {
  game.step(movie.inputs.get(t) ?? 0);
  for (const poke of movie.pokes.get(t) ?? []) {
    if (poke.size === 4) game.m.w32(poke.address, poke.value);
    else if (poke.size === 2) game.m.w16(poke.address, poke.value);
    else game.m.w8(poke.address, poke.value);
  }
  const frame = renderer.frame(game);
  if (ticks.has(t)) {
    const file = join(outDir, `${name}_t${String(t).padStart(5, '0')}.png`);
    writeFileSync(file, encodePng(toRgba(renderer.pixels(frame.buffer)), 320, 240, scale));
    console.log(file);
  }
}
