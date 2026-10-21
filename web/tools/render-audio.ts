// Renders a movie's sound to a WAV file, as the browser player would play it (docs/re/audio.md
// §8): the core replays the movie through every program it runs (docs/re/shell.md §9), the
// audio model times the SPU writes and the CD, the SPU mixes the effects and the CD's audio comes
// straight from the disc image (no encoding), through CdMix and the CD volume.
//
//   npx tsx tools/render-audio.ts ../re/movies/<name>.tpm out.wav [--from T] [--to T] [--disc DIR]
//
// T counts ticks over the whole movie (the programs' ticks one after another).
import { openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CYCLES_PER_VBLANK } from '../src/audio/driver';
import { Spu } from '../src/audio/spu';
import { VAB_SPU_BASE } from '../src/audio/vab';
import { audioModel } from '../test/audio';
import * as A from '../src/core/addr';
import { machineForTrace, unwindSeed } from '../test/replay';
import { loadMovie } from './movie';
import { loadTrace } from './trace';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const from = Number(opt('--from', '1'));
const to = Number(opt('--to', 'Infinity'));
const discDir = opt('--disc', join(import.meta.dirname, '../../../tp-private/disc'));
const [moviePath, out] = args;
const name = moviePath.replace(/.*\//, '').replace(/\.tpm$/, '');
const movie = loadMovie(moviePath);
const trace = loadTrace(join(import.meta.dirname, '../../re/traces', `${name}.jsonl.gz`));
const machine = machineForTrace(trace, movie);
const model = audioModel(machine.m);
const spu = new Spu();
spu.ram.set(model.driver.ram.subarray(VAB_SPU_BASE, VAB_SPU_BASE + 0x80000 - VAB_SPU_BASE), VAB_SPU_BASE);

// The CD: the disc's tracks as files, read a sector at a time.
const disc = JSON.parse(String(readFileSync(join(import.meta.dirname, '../public/assets/disc.json'))));
const files = new Map<number, number>();
function sector(pos: number): Int16Array {
  let n = disc.fileStart.length - 1;
  while (n > 1 && disc.fileStart[n] > pos) n--;
  const buf = Buffer.alloc(2352);
  if (pos - disc.fileStart[n] < disc.sectors[n]) {
    let fd = files.get(n);
    if (fd === undefined) {
      fd = openSync(join(discDir, `Tetris Plus (Track ${String(n).padStart(2, '0')}).bin`), 'r');
      files.set(n, fd);
    }
    readSync(fd, buf, 0, 2352, (pos - disc.fileStart[n]) * 2352);
  }
  return new Int16Array(buf.buffer, buf.byteOffset, 1176);
}

const CD_LEVEL = process.env.TP_NO_CD ? 0 : (31130 / 32768) * (31880 / 32768);
/** CdMix: [L to L, R to L, L to R, R to R], of 0x80. */
let cdMix = [0x7f / 0x80, 0, 0, 0x7f / 0x80];
const SAMPLES_PER_CYCLE = 1 / 768;
const chunks: Int16Array[] = [];
let cdVolL = 0;
let cdVolR = 0;
let cdSector: Int16Array | null = null;
let cdIndex = 0;
let cdStart = Infinity;
let rendered = 0; // samples since the first rendered tick
let base = -1;
const pending: { sample: number; offset: number; value: number }[] = [];
const cdQueue: { sample: number; pos: number }[] = [];

let t = 0;
const rows = trace.segments.flatMap((seg, k) => seg.rows.map((row) => ({ k, row })));
for (const { k, row } of rows) {
  t++;
  if (t > to) break;
  if (k > 0 && row === trace.segments[k].rows[0]) {
    // The next program, with the counter and seed the original's loader left.
    machine.next();
    machine.m.w32(A.COUNTER, (row.ctr as number) - 1);
    machine.ctx.rng.seed = unwindSeed(row.seed as number, row.rand as number);
  }
  const game = machine.program;
  const mseg = movie.segments[k] ?? { inputs: new Map(), pokes: new Map() };
  const tick = row.t as number;
  game.step(mseg.inputs.get(tick) ?? 0);
  const s = model.step(game.sound, (row.vs as number | undefined) ?? 1);
  if (s.mono) cdMix = s.mono.mono ? [0.5, 0.5, 0.5, 0.5] : [0x7f / 0x80, 0, 0, 0x7f / 0x80];
  for (const poke of mseg.pokes.get(tick) ?? []) {
    if (poke.size === 4) game.m.w32(poke.address, poke.value);
    else if (poke.size === 2) game.m.w16(poke.address, poke.value);
    else game.m.w8(poke.address, poke.value);
  }
  if (t < from) {
    for (const w of s.writes) spu.write(w.offset, w.value);
    continue;
  }
  if (base < 0) base = Math.floor(s.cycle * SAMPLES_PER_CYCLE) - 735;
  for (const w of s.writes) pending.push({ sample: Math.floor(w.cycle * SAMPLES_PER_CYCLE) - base, offset: w.offset, value: w.value });
  for (const e of s.cdEvents) if (e.kind === 'sector') cdQueue.push({ sample: Math.floor(e.cycle * SAMPLES_PER_CYCLE) - base, pos: e.data[0] });
  const end = Math.floor(s.cycle * SAMPLES_PER_CYCLE) - base;
  const n = end - rendered;
  if (n <= 0) continue;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pcm = new Int16Array(n * 2);
  let i = 0;
  while (i < n) {
    const now = rendered + i;
    while (pending.length && pending[0].sample <= now) {
      const w = pending.shift()!;
      spu.write(w.offset, w.value);
      if (w.offset === 0x1b0) cdVolL = (w.value & 0x7fff) / 0x8000;
      if (w.offset === 0x1b2) cdVolR = (w.value & 0x7fff) / 0x8000;
    }
    const next = pending.length ? Math.min(n, pending[0].sample - rendered) : n;
    const run = Math.max(1, next - i);
    spu.render(left, right, i, run);
    i += run;
  }
  for (let k = 0; k < n; k++) {
    const now = rendered + k;
    while (cdQueue.length && cdQueue[0].sample <= now) {
      cdSector = sector(cdQueue.shift()!.pos);
      cdIndex = 0;
      cdStart = now;
    }
    let l = left[k] * 32768;
    let r = right[k] * 32768;
    if (cdSector && cdIndex < 588 && now >= cdStart) {
      const cl = cdSector[cdIndex * 2];
      const cr = cdSector[cdIndex * 2 + 1];
      l += (cl * cdMix[0] + cr * cdMix[1]) * CD_LEVEL * cdVolL;
      r += (cl * cdMix[2] + cr * cdMix[3]) * CD_LEVEL * cdVolR;
      cdIndex++;
    }
    pcm[k * 2] = Math.max(-32768, Math.min(32767, Math.round(l)));
    pcm[k * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r)));
  }
  chunks.push(pcm);
  rendered = end;
}

const samples = chunks.reduce((a, c) => a + c.length, 0);
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(44100, 24);
wav.writeUInt32LE(44100 * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
let o = 44;
for (const c of chunks) {
  Buffer.from(c.buffer, c.byteOffset, c.byteLength).copy(wav, o);
  o += c.byteLength;
}
writeFileSync(out, wav);
console.log(`${out}: ${(samples / 2 / 44100).toFixed(1)} s (${CYCLES_PER_VBLANK} cycles a tick)`);
