// The asset pipeline: reads the original game's files (unpacked by scripts/fetch-disc.sh),
// checks they are Tetris Plus (USA, SLUS-00338), and writes the web-ready assets the port loads
// (public/assets/): each ported program's images, one pack per data file.
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
  'SW_ON.EXE': 'd23424e5a92904aca60a6fb6c7e9e8d740f6a336',
  'SW_ONE.BIN': '0ff315985bac2b4a5638382a8af365bae9690e9e',
  'TIT_DEMO.EXE': '83fd0f122b0700a83472163d83651a0a8877c38f',
  'TDEMOE.BIN': '178c001244138bb89fa9b74504efa68260435532',
  'TITLE.EXE': '4849d0d84c44c29be40308a48ff22f48d3f7f59d',
  'TITLEE.BIN': '55b126f81a31ce05bf519ddd41e14d6a05547739',
  'SELECT.EXE': 'a459ef6a3712f3b090bb32881569ef99e578982e',
  'SELECTE.BIN': 'b428013b2d18c502cee477478e94b4b86ed638fa',
  'RANKING.EXE': 'dbfc96d02f231308da1b9914720553affdee8ddb',
  'RANKINGE.BIN': '49dbaae98c22bc69c7b0778fdb4c291cce3b2c87',
};

/**
 * Each program's data file and its table of item offsets (docs/re/disc-inventory.md §3):
 * program, data file, table address, item count, pack name.
 */
const PACKS: [string, string, number, number, string][] = [
  ['PAZLE.EXE', 'PAZLEE.BIN', 0x800e1318, 1235, 'pazlee.pack'],
  ['SW_ON.EXE', 'SW_ONE.BIN', 0x800af4e0, 24, 'sw_one.pack'],
  ['TIT_DEMO.EXE', 'TDEMOE.BIN', 0x800af110, 409, 'tdemoe.pack'],
  ['TITLE.EXE', 'TITLEE.BIN', 0x800adc9c, 143, 'titlee.pack'],
  ['SELECT.EXE', 'SELECTE.BIN', 0x800b23ec, 177, 'selecte.pack'],
  ['RANKING.EXE', 'RANKINGE.BIN', 0x800ac0c4, 102, 'rankinge.pack'],
];
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

mkdirSync(outDir, { recursive: true });
for (const [exeName, binName, table, count, packName] of PACKS) {
  const exe = load(exeName);
  const bin = load(binName);
  const ev = new DataView(exe.buffer);
  const offsets = Array.from({ length: count }, (_, i) => ev.getUint32(EXE_HEADER + table - EXE_LOAD + 4 * i, true));
  const items = decodeArchive(bin, offsets);
  // Puzzle Mode's items are all images; other data files also hold other data (kept as is).
  if (exeName === 'PAZLE.EXE') {
    items.forEach((item, i) => {
      try {
        parseTim(item);
      } catch (e) {
        throw new Error(`${binName} item ${i}: ${(e as Error).message}`);
      }
    });
  }
  const pack = writePack(items);
  writeFileSync(join(outDir, packName), pack);
  console.log(`${packName}: ${items.length} items, ${pack.length} bytes`);
}
