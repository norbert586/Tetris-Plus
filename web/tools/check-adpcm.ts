// Checks the SPU's ADPCM decoder (src/audio/spu.ts) against an independent one: FFmpeg's
// adpcm_psx, on every sample of the sound bank (docs/re/audio.md §8). Needs ffmpeg. The two
// round the prediction differently (FFmpeg truncates (a + b) / 64; the hardware adds 32 and
// shifts), so they agree to within a few units, not exactly; the check is that they agree that
// closely on every block that plays (the last block, flags 7, never does).
//
//   npx tsx tools/check-adpcm.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeAdpcmBlock } from '../src/audio/spu';
import { Vab } from '../src/audio/vab';

const assets = join(import.meta.dirname, '../public/assets');
const vab = new Vab(readFileSync(join(assets, 'EF.VH')), readFileSync(join(assets, 'EF.VB')));
/** The largest difference rounding can explain. */
const LIMIT = 128;
const dir = mkdtempSync(join(tmpdir(), 'adpcm-'));
let worst = 0;
let total = 0;
for (let n = 1; n < vab.vagSize.length; n++) {
  const data = vab.sample(n);
  // A VAG file: "VAGp", version, size and rate big-endian, a name; then the blocks.
  const header = Buffer.alloc(48);
  header.write('VAGp', 0);
  header.writeUInt32BE(0x20, 4);
  header.writeUInt32BE(data.length, 12);
  header.writeUInt32BE(44100, 16);
  const file = join(dir, `${n}.vag`);
  writeFileSync(file, Buffer.concat([header, data]));
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-f', 'vag', '-i', file, '-f', 's16le', '-'], { maxBuffer: 1 << 26 });
  const theirs = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const mine = new Int32Array(28);
  const h = { s1: 0, s2: 0 };
  let diff = 0;
  let count = 0;
  for (let b = 0; b * 16 < data.length - 16 && count < theirs.length; b++) {
    decodeAdpcmBlock(data, b * 16, mine, h);
    for (let i = 0; i < 28 && count < theirs.length; i++, count++) {
      const m = Math.max(-32768, Math.min(32767, mine[i]));
      diff = Math.max(diff, Math.abs(m - theirs[count]));
    }
  }
  worst = Math.max(worst, diff);
  total += count;
  if (diff > LIMIT) console.log(`sample ${n}: differs by up to ${diff}`);
}
rmSync(dir, { recursive: true });
console.log(`${vab.vagSize.length - 1} samples, ${total} decoded values: largest difference ${worst}`);
process.exit(worst > LIMIT ? 1 : 0);
