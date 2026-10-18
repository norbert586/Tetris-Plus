// The data-file codec (docs/re/disc-inventory.md §3): each item of a *.BIN file is a method
// byte (0 stored, 1 LZ), a little-endian u16 decoded length, then the payload. Items are found
// through a table of u32 offsets in the program that loads the file (PAZLE.EXE: 0x800E1318).
// The original's decoder is FUN_80097AF4 in PAZLE.EXE (and 0x80023204 in the boot program).

/** Decodes the item at `pos`. */
export function decodeItem(data: Uint8Array, pos: number): Uint8Array {
  const method = data[pos];
  const length = data[pos + 1] | (data[pos + 2] << 8);
  let src = pos + 3;
  if (method === 0) return data.slice(src, src + length);
  if (method !== 1) throw new Error(`unknown item method ${method} at 0x${pos.toString(16)}`);
  // The last flag group always runs all 16 tokens, so the output may overshoot `length`.
  const out = new Uint8Array(length + 34 * 16);
  const byte = (i: number) => (i < data.length ? data[i] : 0); // the last item reads past the end
  let n = 0;
  while (n < length) {
    let flags = byte(src) | (byte(src + 1) << 8);
    src += 2;
    if (flags === 0) {
      for (let i = 0; i < 16; i++) out[n++] = byte(src++);
      continue;
    }
    for (let t = 0; t < 16; t++, flags >>= 1) {
      if ((flags & 1) === 0) {
        out[n++] = byte(src++);
        continue;
      }
      const b0 = byte(src);
      const b1 = byte(src + 1);
      src += 2;
      const start = n - ((((b1 << 8) | b0) & 0x7ff) + 1);
      // Byte by byte: an overlapping match repeats bytes.
      for (let i = 0; i < (b1 >> 3) + 3; i++) out[n++] = out[start + i];
    }
  }
  return out.slice(0, length);
}

/** Decodes every item of a data file, given the program's offset table. */
export function decodeArchive(data: Uint8Array, offsets: ArrayLike<number>): Uint8Array[] {
  return Array.from(offsets, (pos) => decodeItem(data, pos));
}
