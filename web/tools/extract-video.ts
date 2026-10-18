// The Jaleco logo video (J_PS.STR, docs/re/disc-inventory.md §6) for the shell's power-on:
// the file holds the data track's raw Form 2 sectors (2,336 bytes: subheader + data + EDC), so
// each gets a sync pattern and header back to make the 2,352-byte sectors FFmpeg's psxstr
// demuxer reads. 120 MDEC frames at double speed (5 sectors a frame, 150 sectors a second) are
// 30 frames a second, which the demuxer can't know. Written as WebM (VP9 + Opus) and MP4
// (H.264 + AAC, for browsers without WebM).
//
//   npx tsx tools/extract-video.ts [FILES_DIR] [OUT_DIR]   (needs FFmpeg)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const filesDir = args[0] ?? join(import.meta.dirname, '../../../tp-private/files');
const outDir = args[1] ?? join(import.meta.dirname, '../public/assets');
const RAW = 2336;
const SECTOR = 2352;
const SYNC = [0x00, ...Array(10).fill(0xff), 0x00];

const str = readFileSync(join(filesDir, 'J_PS.STR'));
console.log(`J_PS.STR: ${str.length} bytes, sha1 ${createHash('sha1').update(str).digest('hex')}`);
const count = str.length / RAW;
if (!Number.isInteger(count)) throw new Error('J_PS.STR is not whole 2,336-byte sectors');
const out = Buffer.alloc(count * SECTOR);
for (let i = 0; i < count; i++) {
  const at = i * SECTOR;
  out.set(SYNC, at);
  // Header: an MSF address (any) and mode 2.
  const lba = i + 150;
  const bcd = (n: number) => ((Math.floor(n / 10) << 4) | n % 10);
  out[at + 12] = bcd(Math.floor(lba / 4500));
  out[at + 13] = bcd(Math.floor(lba / 75) % 60);
  out[at + 14] = bcd(lba % 75);
  out[at + 15] = 2;
  str.copy(out, at + 16, i * RAW, (i + 1) * RAW);
}
const dir = mkdtempSync(join(tmpdir(), 'jlogo-'));
const input = join(dir, 'j_ps.str');
writeFileSync(input, out);
const encode = (name: string, codecs: string[]) => {
  const path = join(outDir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'psxstr', '-r', '30', '-i', input, ...codecs, path]);
  console.log(`${path}: ${statSync(path).size} bytes`);
};
encode('jlogo.webm', ['-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '96k']);
encode('jlogo.mp4', ['-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-b:a', '128k', '-movflags', '+faststart']);
rmSync(dir, { recursive: true });
