// The audio half of the asset pipeline (docs/re/audio.md §7): copies the sound bank (EF.VH,
// EF.VB) and encodes the music tracks (CD-DA tracks 2-51) to Ogg Opus, one file per track from
// its index 00 (the 2 s pregap included, since the program starts a track at its TOC second,
// which can fall in the pregap). Writes disc.json: the disc's layout (each track's index 01, its
// pregap, its file) for the CD model and the player.
//
//   npx tsx tools/extract-audio.ts [DISC_DIR] [FILES_DIR] [OUT_DIR] [--no-music]
//     DISC_DIR   the bin/cue image (default ../../tp-private/disc)
//     FILES_DIR  the data track's files (default ../../tp-private/files)
//     OUT_DIR    default public/assets
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noMusic = process.argv.includes('--no-music');
const discDir = args[0] ?? join(import.meta.dirname, '../../../tp-private/disc');
const filesDir = args[1] ?? join(import.meta.dirname, '../../../tp-private/files');
const outDir = args[2] ?? join(import.meta.dirname, '../public/assets');

const BANK = ['EF.VH', 'EF.VB'];
const SECTOR_BYTES = 2352;
/** Music tracks: 2-51 (52 is the program's "stop" track and never plays in Puzzle Mode). */
const FIRST_MUSIC = 2;
const LAST_MUSIC = 51;
const BITRATE = '96k';

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

for (const name of BANK) {
  const data = readFileSync(join(filesDir, name));
  console.log(`${name}: ${data.length} bytes, sha1 ${sha1(data)}`);
  copyFileSync(join(filesDir, name), join(outDir, name));
}

// The cue sheet: one file per track, audio tracks with INDEX 00 at 0 and INDEX 01 at 2 s.
const cueName = 'Tetris Plus.cue';
const cue = readFileSync(join(discDir, cueName), 'utf8');
interface CueTrack {
  track: number;
  file: string;
  pregap: number;
}
const tracks: CueTrack[] = [];
let file = '';
for (const line of cue.split(/\r?\n/)) {
  const f = line.match(/^FILE "(.*)" BINARY/);
  if (f) file = f[1];
  const t = line.match(/^\s*TRACK (\d+)/);
  if (t) tracks.push({ track: Number(t[1]), file, pregap: 0 });
  const i = line.match(/^\s*INDEX 01 (\d+):(\d+):(\d+)/);
  if (i) tracks[tracks.length - 1].pregap = (Number(i[1]) * 60 + Number(i[2])) * 75 + Number(i[3]);
}

const disc = { start: [0] as number[], pregap: [0] as number[], fileStart: [0] as number[], sectors: [0] as number[], end: 0 };
let lba = 0;
for (const t of tracks) {
  const sectors = statSync(join(discDir, t.file)).size / SECTOR_BYTES;
  if (!Number.isInteger(sectors)) throw new Error(`${t.file}: not whole sectors`);
  // MSF sector counts include the 2 s lead-in (00:02:00 is LBA 0).
  disc.fileStart[t.track] = lba + 150;
  disc.start[t.track] = lba + 150 + t.pregap;
  disc.pregap[t.track] = t.pregap;
  disc.sectors[t.track] = sectors;
  lba += sectors;
}
disc.end = lba + 150;
const audioDir = join(outDir, 'music');
mkdirSync(audioDir, { recursive: true });
writeFileSync(join(outDir, 'disc.json'), `${JSON.stringify(disc)}\n`);
console.log(`disc.json: ${tracks.length} tracks, ${lba} sectors`);

if (!noMusic) {
  for (let n = FIRST_MUSIC; n <= LAST_MUSIC; n++) {
    const out = join(audioDir, `${String(n).padStart(2, '0')}.opus`);
    if (existsSync(out)) continue;
    const t = tracks.find((x) => x.track === n);
    if (!t) throw new Error(`no track ${n}`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', join(discDir, t.file),
      '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-application', 'audio', out]);
    console.log(`${out}: ${statSync(out).size} bytes`);
  }
}
