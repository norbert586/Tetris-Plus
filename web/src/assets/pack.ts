// The web asset container: a data file's decoded items in index order, identical items stored
// once. Written by tools/extract-assets.ts, read by the renderer.
//
//   u32 magic 'TPK1', u32 count, count x { u32 offset, u32 length }, then the item bytes.
//   All little endian; offsets are from the start of the file.

export const PACK_MAGIC = 0x314b5054; // 'TPK1'

export function readPack(bytes: Uint8Array): Uint8Array[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== PACK_MAGIC) throw new Error('not a TPK1 pack');
  const count = v.getUint32(4, true);
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const at = v.getUint32(8 + 8 * i, true);
    items.push(bytes.subarray(at, at + v.getUint32(12 + 8 * i, true)));
  }
  return items;
}
