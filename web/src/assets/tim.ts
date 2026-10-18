// TIM images, the PlayStation's texture format. Every item of PAZLEE.BIN is one (4- or 8-bit,
// one CLUT row), and each carries the VRAM position the game uploads it to
// (docs/re/disc-inventory.md §3).

export interface VramRect {
  x: number;
  y: number;
  /** Width in 16-bit VRAM words. */
  w: number;
  h: number;
  /** The rectangle's 16-bit words, row by row. */
  data: Uint16Array;
}

export interface Tim {
  /** Flags word: bits 0-1 colour mode (0 4-bit, 1 8-bit, 2 16-bit, 3 24-bit), bit 3 has CLUT. */
  flags: number;
  clut: VramRect | null;
  image: VramRect;
}

function rect(bytes: Uint8Array, pos: number): { rect: VramRect; end: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(pos, true);
  const x = v.getUint16(pos + 4, true);
  const y = v.getUint16(pos + 6, true);
  const w = v.getUint16(pos + 8, true);
  const h = v.getUint16(pos + 10, true);
  if (length !== 12 + w * h * 2) throw new Error(`TIM block length ${length} != ${12 + w * h * 2}`);
  const data = new Uint16Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = v.getUint16(pos + 12 + 2 * i, true);
  return { rect: { x, y, w, h, data }, end: pos + length };
}

export function parseTim(bytes: Uint8Array): Tim {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0x10) throw new Error('not a TIM');
  const flags = v.getUint32(4, true);
  let pos = 8;
  let clut: VramRect | null = null;
  if (flags & 8) {
    const r = rect(bytes, pos);
    clut = r.rect;
    pos = r.end;
  }
  const { rect: image, end } = rect(bytes, pos);
  if (end !== bytes.length) throw new Error(`TIM ends at ${end}, item is ${bytes.length} bytes`);
  return { flags, clut, image };
}
