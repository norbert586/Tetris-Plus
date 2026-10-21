// Plays a movie on the core alone and prints what happens (screens, steps, pieces, the
// professor, sounds), like re/tools/tptrace.py events. Used to design movies before running
// them on the original.
//
//   npx tsx tools/simulate.ts MOVIE.tpm [--to T] [--fields a,b,...]
import { Game, NotPorted } from '../src/core/game';
import { join } from 'node:path';
import { loadMovie, movieCards } from './movie';
import type { Row } from './trace';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !a.includes(','));
if (!path) throw new Error('usage: simulate.ts MOVIE.tpm [--to T] [--fields a,b]');
const to = args.includes('--to') ? Number(args[args.indexOf('--to') + 1]) : Infinity;
const fields = args.includes('--fields') ? args[args.indexOf('--fields') + 1].split(',') : [];
const movie = loadMovie(path);
const game = new Game({ counter: 1001, seed: 0x4327d505, difficulty: 1, cards: movieCards(movie, join(import.meta.dirname, '..', '..')) });
let prev: Row = {};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
for (let t = 1; t <= Math.min(movie.last, to); t++) {
  try {
    game.step(movie.inputs.get(t) ?? 0);
  } catch (e) {
    if (e instanceof NotPorted) {
      console.log(`${t} not ported: ${e.message}`);
      break;
    }
    throw e;
  }
  if (game.exited) {
    console.log(`${t} Puzzle Mode exits`);
    break;
  }
  const row = game.traceRow();
  const out: string[] = [];
  for (const f of ['scr', 'step', 'zone', 'stage', 'zones_cleared', 'score', 'prof_state', 'lose_flags', 'clear_flags', ...fields]) {
    if (!same(row[f], prev[f])) out.push(`${f} ${JSON.stringify(row[f])}`);
  }
  if ((row.se as number[]).length) out.push(`se ${(row.se as number[]).map((x) => x.toString(16)).join(' ')}`);
  if ((row.bgm as number[]).length) out.push(`bgm ${(row.bgm as number[]).map((x) => x.toString(16)).join(' ')}`);
  for (const poke of movie.pokes.get(t) ?? []) {
    if (poke.size === 4) game.m.w32(poke.address, poke.value);
    else if (poke.size === 2) game.m.w16(poke.address, poke.value);
    else game.m.w8(poke.address, poke.value);
    out.push(`poke ${poke.address.toString(16)}=${poke.value}`);
  }
  if (out.length) console.log(`${t} ${out.join('; ')}`);
  prev = row;
}
