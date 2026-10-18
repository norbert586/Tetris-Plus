// Turning the 15-bit frame into displayable colour, and a minimal PNG writer for tools.
//
// Each 5-bit channel becomes 8 bits as (c << 3) | (c >> 2), the usual expansion; the mask bit
// is ignored. Scaling, aspect and filters belong to the presenter in the shell (Phase 9).

/** 320x240 15-bit pixels to RGBA bytes. */
export function toRgba(pixels: Uint16Array): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    const r = c & 31;
    const g = (c >> 5) & 31;
    const b = (c >> 10) & 31;
    out[4 * i] = (r << 3) | (r >> 2);
    out[4 * i + 1] = (g << 3) | (g >> 2);
    out[4 * i + 2] = (b << 3) | (b >> 2);
    out[4 * i + 3] = 255;
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** An RGB PNG of RGBA pixels, each pixel `scale` x `scale`; stored (uncompressed) deflate. */
export function encodePng(rgba: Uint8Array, width: number, height: number, scale = 1): Uint8Array {
  const w = width * scale;
  const h = height * scale;
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + 3 * w);
    for (let x = 0; x < w; x++) {
      const src = 4 * (Math.floor(y / scale) * width + Math.floor(x / scale));
      raw.set(rgba.subarray(src, src + 3), row + 1 + 3 * x);
    }
  }
  // zlib stream of stored blocks (at most 65535 bytes each).
  const blocks: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length || i === 0; i += 0xffff) {
    const n = Math.min(0xffff, raw.length - i);
    blocks.push(i + n >= raw.length ? 1 : 0, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff);
    for (let k = 0; k < n; k++) blocks.push(raw[i + k]);
  }
  const ad = adler32(raw);
  blocks.push(ad >>> 24, (ad >> 16) & 0xff, (ad >> 8) & 0xff, ad & 0xff);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(blocks)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
