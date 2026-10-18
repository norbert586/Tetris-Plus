// Checks the renderer against one frame of the original: a RAM and a VRAM dump taken at the
// oracle's sample point (re/lua/movie.lua TP_VRAM_AT). The game state comes from the RAM dump
// and the textures from the VRAM dump, so this tests sorting and drawing on their own, not
// the uploads. Prints the first differing GPU packet and the pixels that differ.
//
//   npx tsx tools/render-dump.ts RAM.bin VRAM.bin [OUT.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { readPack } from '../src/assets/pack';
import { Game } from '../src/core/game';
import { Renderer } from '../src/render/renderer';
import { VRAM_WIDTH } from '../src/render/gpu';

const [ramPath, vramPath, pngPath] = process.argv.slice(2);
const ram = new Uint8Array(readFileSync(ramPath));
const dump = new Uint16Array(new Uint8Array(readFileSync(vramPath)).buffer);
const r = new Renderer(readPack(new Uint8Array(readFileSync(new URL('../public/assets/pazlee.pack', import.meta.url)))));
r.gpu.vram.set(dump.subarray(0, r.gpu.vram.length));
const g = new Game({ counter: 0, seed: 0, ram });
const dv = new DataView(ram.buffer);
const active = dv.getUint32(0xee484, true);
const buffer = 1 - active;

// The original's packets, from the ordering table in RAM (re/tools/otdump.py's walk).
const want: number[][] = [];
let address = dv.getUint32((0x800ed2f4 + 20 * active + 16) & 0x1fffff, true) & 0xffffff;
while (address !== 0xffffff) {
  const head = dv.getUint32(address & 0x1fffff, true);
  const n = head >>> 24;
  if (n) want.push(Array.from({ length: n }, (_, k) => dv.getUint32((address + 4 * (k + 1)) & 0x1fffff, true)));
  address = head & 0xffffff;
}
const frame = r.draw(g, buffer);
const got = r.packets;
const hex = (p: number[]) => p.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join(' ');
let first = -1;
for (let i = 0; i < Math.max(want.length, got.length); i++) {
  if (!want[i] || !got[i] || hex(want[i]) !== hex(got[i])) {
    first = i;
    break;
  }
}
console.log(`packets: original ${want.length}, port ${got.length}; ${first < 0 ? 'identical' : `first difference at #${first}`}`);
if (first >= 0) {
  for (let i = Math.max(0, first - 1); i < Math.min(first + 3, Math.max(want.length, got.length)); i++) {
    console.log(`  #${i} original ${want[i] ? hex(want[i]) : '-'}`);
    console.log(`  #${i} port     ${got[i] ? hex(got[i]) : '-'}`);
  }
}
let bad = 0;
const top = 240 * buffer;
let box = [999, 999, -1, -1];
for (let y = 0; y < 240; y++)
  for (let x = 0; x < 320; x++) {
    const a = dump[(top + y) * VRAM_WIDTH + x];
    const b = r.gpu.vram[(top + y) * VRAM_WIDTH + x];
    if (a !== b) {
      bad++;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
  }
console.log(`pixels: ${bad} differ${bad ? ` within (${box[0]},${box[1]})-(${box[2]},${box[3]})` : ''}; fb ${frame.fb}`);
if (pngPath) {
  // A side-by-side PPM: original, port, difference.
  const out = Buffer.alloc(960 * 240 * 3);
  const put = (x: number, y: number, c: number) => {
    const o = (y * 960 + x) * 3;
    out[o] = (c & 31) << 3;
    out[o + 1] = ((c >> 5) & 31) << 3;
    out[o + 2] = ((c >> 10) & 31) << 3;
  };
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++) {
      const a = dump[(top + y) * VRAM_WIDTH + x];
      const b = r.gpu.vram[(top + y) * VRAM_WIDTH + x];
      put(x, y, a);
      put(320 + x, y, b);
      put(640 + x, y, a === b ? 0 : 0x7fff);
    }
  writeFileSync(pngPath, Buffer.concat([Buffer.from(`P6 960 240 255\n`), out]));
}
