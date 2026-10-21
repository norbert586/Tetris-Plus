// The core keeps game state where the original keeps it: in a model of the PlayStation's 2 MB
// main RAM, addressed with the original's addresses. That makes the port's code read like the
// original's, makes save states a copy of one buffer, and lets the tracer read the same
// addresses as the emulator's (re/lua/trace_fields.lua).
//
// Only memory the game logic uses is meaningful: PAZLE.EXE's data and BSS, the boot program's
// shared state block and the BIOS rand() seed. Tables are loaded from rom.ts.
import { ROM } from './rom';

export const RAM_SIZE = 0x200000;

export function decodeBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A program's data ranges, as rom.ts files hold them. */
export type Rom = { name: string; address: number; base64: string }[];

const romImages = new Map<Rom, { address: number; bytes: Uint8Array }[]>();
function romRanges(rom: Rom) {
  let image = romImages.get(rom);
  if (!image) {
    image = rom.map((r) => ({ address: r.address, bytes: decodeBase64(r.base64) }));
    romImages.set(rom, image);
  }
  return image;
}

export class Mem {
  readonly bytes: Uint8Array;
  readonly view: DataView;

  constructor(bytes?: Uint8Array) {
    this.bytes = bytes ? bytes.slice() : new Uint8Array(RAM_SIZE);
    this.view = new DataView(this.bytes.buffer);
    if (!bytes) this.loadRom();
  }

  /** Loads a program's data ranges (PAZLE.EXE's by default), as the boot program's loader does before `start`. */
  loadRom(rom: Rom = ROM): void {
    for (const r of romRanges(rom)) this.bytes.set(r.bytes, r.address & (RAM_SIZE - 1));
  }

  clone(): Mem {
    return new Mem(this.bytes);
  }

  s8(a: number): number { return this.view.getInt8(a & 0x1fffff); }
  u8(a: number): number { return this.bytes[a & 0x1fffff]; }
  s16(a: number): number { return this.view.getInt16(a & 0x1fffff, true); }
  u16(a: number): number { return this.view.getUint16(a & 0x1fffff, true); }
  s32(a: number): number { return this.view.getInt32(a & 0x1fffff, true); }
  u32(a: number): number { return this.view.getUint32(a & 0x1fffff, true); }

  w8(a: number, v: number): void { this.bytes[a & 0x1fffff] = v; }
  w16(a: number, v: number): void { this.view.setInt16(a & 0x1fffff, v, true); }
  w32(a: number, v: number): void { this.view.setInt32(a & 0x1fffff, v | 0, true); }

  /** Adds to a 32-bit word and returns the new (signed) value. */
  add32(a: number, d: number): number {
    const v = (this.s32(a) + d) | 0;
    this.w32(a, v);
    return v;
  }

  fill(a: number, n: number, v = 0): void {
    this.bytes.fill(v, a & 0x1fffff, (a & 0x1fffff) + n);
  }
}
