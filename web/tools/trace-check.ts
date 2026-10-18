// Replays movies on the TypeScript core and compares every tick with the original's trace
// (docs/re/oracle-harness.md §8). Exit status 1 at the first difference.
//
//   npm run trace -- [--render] [--ignore a,b] [--context N] [--to T] [MOVIE ...]
//
// --render also draws every tick and compares the GPU packet and frame hashes (ot, fb); it
// needs public/assets/pazlee.pack (tools/extract-assets.ts).
//
// With no movie names, every movie in re/movies/ that has a trace in re/traces/ is checked.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadMovie } from './movie';
import { loadTrace } from './trace';
import { compareMovie } from '../test/replay';
import { readPack } from '../src/assets/pack';
import { Renderer } from '../src/render/renderer';

const ROOT = join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
let ignore: string[] = [];
let context = 5;
let to = Infinity;
let render = false;
const names: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ignore') ignore = args[++i].split(',');
  else if (args[i] === '--context') context = Number(args[++i]);
  else if (args[i] === '--to') to = Number(args[++i]);
  else if (args[i] === '--render') render = true;
  else names.push(basename(args[i]).replace(/\.tpm$/, ''));
}
const movies = names.length
  ? names
  : readdirSync(join(ROOT, 're/movies'))
      .filter((f) => f.endsWith('.tpm'))
      .map((f) => f.replace(/\.tpm$/, ''))
      .filter((n) => existsSync(join(ROOT, 're/traces', `${n}.jsonl.gz`)));

let failed = 0;
for (const name of movies) {
  const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
  const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
  const renderer = render
    ? new Renderer(readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets/pazlee.pack')))))
    : undefined;
  const result = compareMovie(movie, trace, { ignore, to, context, renderer });
  console.log(`${name}: ${result.report}`);
  if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
