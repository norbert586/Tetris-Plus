// The asset pipeline: reads the original game's files (unpacked by scripts/fetch-disc.sh),
// checks they are Tetris Plus (USA, SLUS-00338), and writes the web-ready assets the port loads
// (public/assets/). Only Puzzle Mode's images so far.
//
//   npx tsx tools/extract-assets.ts [FILES_DIR] [OUT_DIR]
//     FILES_DIR  the data track's files (default ../../tp-private/files)
//     OUT_DIR    default public/assets
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeArchive } from '../src/assets/archive';
import { PACK_MAGIC } from '../src/assets/pack';
import { parseTim } from '../src/assets/tim';

const SOURCES: Record<string, string> = {
  'PAZLE.EXE': 'b5e48bc80d7115e4d9b806213a724e41d84c34c5',
  'PAZLEE.BIN': '6f744492f0ada6d86452dbba2b2c295f1f4763f2',
};

/** PAZLE.EXE's table of PAZLEE.BIN item offsets (docs/re/disc-inventory.md §3). */
const ITEM_TABLE = 0x800e1318;
const ITEM_COUNT = 1235;
const EXE_LOAD = 0x80094000;
const EXE_HEADER = 0x800;

/** The pack format of src/assets/pack.ts. */
function writePack(items: Uint8Array[]): Uint8Array {
  const seen = new Map<string, number>();
  const blobs: Uint8Array[] = [];
  const index: [number, number][] = [];
  let offset = 8 + 8 * items.length;
  for (const item of items) {
    const key = Buffer.from(item).toString('base64');
    let at = seen.get(key);
    if (at === undefined) {
      at = offset;
      seen.set(key, at);
      blobs.push(item);
      offset += item.length;
    }
    index.push([at, item.length]);
  }
  const out = new Uint8Array(offset);
  const v = new DataView(out.buffer);
  v.setUint32(0, PACK_MAGIC, true);
  v.setUint32(4, items.length, true);
  index.forEach(([at, length], i) => {
    v.setUint32(8 + 8 * i, at, true);
    v.setUint32(12 + 8 * i, length, true);
  });
  let pos = 8 + 8 * items.length;
  for (const b of blobs) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

const filesDir = process.argv[2] ?? '../../tp-private/files';
const outDir = process.argv[3] ?? 'public/assets';

function load(name: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(join(filesDir, name)));
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  if (sha1 !== SOURCES[name]) throw new Error(`${name}: SHA-1 ${sha1}, expected ${SOURCES[name]} (SLUS-00338)`);
  return bytes;
}

const exe = load('PAZLE.EXE');
const bin = load('PAZLEE.BIN');
const ev = new DataView(exe.buffer);
const offsets = Array.from({ length: ITEM_COUNT }, (_, i) =>
  ev.getUint32(EXE_HEADER + ITEM_TABLE - EXE_LOAD + 4 * i, true),
);
const items = decodeArchive(bin, offsets);
items.forEach((item, i) => {
  try {
    parseTim(item);
  } catch (e) {
    throw new Error(`PAZLEE.BIN item ${i}: ${(e as Error).message}`);
  }
});
mkdirSync(outDir, { recursive: true });
const pack = writePack(items);
writeFileSync(join(outDir, 'pazlee.pack'), pack);
console.log(`pazlee.pack: ${items.length} items, ${pack.length} bytes`);
