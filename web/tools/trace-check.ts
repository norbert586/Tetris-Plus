// Replays movies on the TypeScript core and compares every tick with the original's trace
// (docs/re/oracle-harness.md §8). Exit status 1 at the first difference.
//
//   npm run trace -- [--render] [--ignore a,b] [--context N] [--to T] [MOVIE ...]
//                    [--from-segment N [--ram DUMP]]
//
// --render also draws every tick and compares the GPU packet and frame hashes (ot, fb); it
// needs public/assets/pazlee.pack (tools/extract-assets.ts). --audio also runs the sound and
// compares vs, kon, koff, spu, rev, cd and cdr (version 3 traces).
//
// --from-segment N starts at the movie's Nth program run, from a TP_RAM_START=1 dump of its start
// (default ../tp-private/runs/<movie>/ram_start_N.bin), so a program can be checked before the
// ones that run before it are ported.
//
// With no movie names, every movie in re/movies/ that has a trace in re/traces/ is checked.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadMovie } from './movie';
import { loadTrace } from './trace';
import { audioModel } from '../test/audio';
import { compareMovie } from '../test/replay';
import { readPack } from '../src/assets/pack';
import { Renderer } from '../src/render/renderer';
import { PROGRAM_ART } from '../src/render/programs';

const ROOT = join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
let ignore: string[] = [];
let context = 5;
let to = Infinity;
let render = false;
let audio = false;
let fromSegment = 1;
let ramPath: string | undefined;
const names: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ignore') ignore = args[++i].split(',');
  else if (args[i] === '--context') context = Number(args[++i]);
  else if (args[i] === '--to') to = Number(args[++i]);
  else if (args[i] === '--render') render = true;
  else if (args[i] === '--audio') audio = true;
  else if (args[i] === '--from-segment') fromSegment = Number(args[++i]);
  else if (args[i] === '--ram') ramPath = args[++i];
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
  const pack = (file: string) => readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', file))));
  const renderers = render
    ? Object.fromEntries(Object.entries(PROGRAM_ART).map(([n, a]) => [n, new Renderer(pack(a.pack), a.style)]))
    : undefined;
  const ram = fromSegment > 1
    ? new Uint8Array(readFileSync(ramPath ?? join(ROOT, '..', 'tp-private', 'runs', name, `ram_start_${fromSegment}.bin`)))
    : undefined;
  const result = compareMovie(movie, trace, {
    fromSegment, ram, ignore, to, context, renderer: renderers?.PAZLE, renderers, audio: audio ? audioModel : undefined,
  });
  console.log(`${name}: ${result.report}`);
  if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
