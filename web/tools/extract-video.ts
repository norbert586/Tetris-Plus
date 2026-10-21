// The Jaleco logo JLOGO.EXE plays at power-on (J_PS.STR: MDEC video and XA audio, 8 s) as an
// MP4 the browser can play (public/assets/jlogo.mp4; docs/re/shell.md §8). Needs FFmpeg.
//
//   npx tsx tools/extract-video.ts [FILES_DIR] [OUT_DIR]
//
// The disc's file holds Mode 2 Form 2 sectors without their sync and header (2,336 bytes each);
// FFmpeg's psxstr demuxer reads raw 2,352-byte sectors, so each gets them back (at the file's
// LBA, 401) before decoding.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHA1 = 'c40114a49aeecca32c9be76266be276343a9829a';
const LBA = 401;

const filesDir = process.argv[2] ?? '../../tp-private/files';
const outDir = process.argv[3] ?? 'public/assets';
const str = new Uint8Array(readFileSync(join(filesDir, 'J_PS.STR')));
const sha1 = createHash('sha1').update(str).digest('hex');
if (sha1 !== SHA1) throw new Error(`J_PS.STR: SHA-1 ${sha1}, expected ${SHA1} (SLUS-00338)`);

const bcd = (x: number) => ((Math.floor(x / 10) << 4) | x % 10) & 0xff;
const sectors = str.length / 2336;
const raw = new Uint8Array(sectors * 2352);
for (let i = 0; i < sectors; i++) {
  const o = i * 2352;
  raw.fill(0xff, o + 1, o + 11); // sync: 00 FF x10 00
  const lba = LBA + 150 + i;
  raw.set([bcd(Math.floor(lba / 4500)), bcd(Math.floor(lba / 75) % 60), bcd(lba % 75), 2], o + 12);
  raw.set(str.subarray(i * 2336, (i + 1) * 2336), o + 16);
}
const dir = mkdtempSync(join(tmpdir(), 'jlogo-'));
const input = join(dir, 'J_PS.raw');
writeFileSync(input, raw);
const out = join(outDir, 'jlogo.mp4');
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'psxstr', '-i', input,
  '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '16', '-pix_fmt', 'yuv420p', '-tune', 'animation',
  '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-movflags', '+faststart', '-y', out,
], { stdio: 'inherit' });
rmSync(dir, { recursive: true });
console.log(`${out}: ${readFileSync(out).length} bytes`);
