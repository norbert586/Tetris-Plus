// cards.ts MOVIE RUNDIR: replays the movie on the port (all segments) and compares the port's cards with the run's card1/2.mcd.
import { readFileSync, existsSync } from 'node:fs';
import * as A from '/home/user/Tetris-Plus/web/src/core/addr';
import { loadMovie } from '/home/user/Tetris-Plus/web/tools/movie';
import { loadTrace } from '/home/user/Tetris-Plus/web/tools/trace';
import { machineForTrace, unwindSeed } from '/home/user/Tetris-Plus/web/test/replay';
const [mp, run] = process.argv.slice(2);
const movie = loadMovie(mp);
const trace = loadTrace(run + '/trace.jsonl');
const machine = machineForTrace(trace, movie);
for (let k = 0; k < trace.segments.length; k++) {
  const seg = trace.segments[k];
  if (k > 0) {
    machine.next();
    const first = seg.rows[0];
    machine.m.w32(A.COUNTER, (first.ctr as number) - 1);
    machine.ctx.rng.seed = unwindSeed(first.seed as number, first.rand as number);
  }
  for (const r of seg.rows) machine.program.step(movie.segments[k].inputs.get(r.t as number) ?? 0);
}
for (const p of [0, 1]) {
  const f = `${run}/card${p + 1}.mcd`;
  const card = machine.ctx.cards.cards[p];
  if (!existsSync(f) || !card) { console.log(p + 1, 'no card', !!card); continue; }
  const want = new Uint8Array(readFileSync(f));
  let diffs = 0, first = -1;
  for (let i = 0; i < want.length; i++) if (want[i] !== card.data[i]) { diffs++; if (first < 0) first = i; }
  console.log(`card ${p + 1}: ${diffs} bytes differ` + (diffs ? ` (first 0x${first.toString(16)})` : ''));
}
