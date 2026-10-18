// The geometry coprocessor, for what libgs's GsSortSprite asks of it: RTPS/RTPT (rotate,
// translate, perspective-project a vertex) with the matrix, translation, projection distance H
// and screen offset it was given. Fixed-point rules and the division are psx-spx's
// ("Geometry Transformation Engine", "GTE Division Inaccuracy").

/** The unsigned Newton-Raphson reciprocal table the GTE divides with. */
const UNR = Array.from({ length: 0x101 }, (_, i) => Math.max(0, Math.floor((Math.floor(0x40000 / (i + 0x100)) + 1) / 2) - 0x101));

/** H / SZ in 16.16, as the GTE computes it (saturates at 0x1FFFF). */
export function gteDivide(h: number, sz: number): number {
  if (h >= sz * 2) return 0x1ffff;
  const z = Math.clz32(sz) - 16;
  const n = h * 2 ** z;
  let d = sz * 2 ** z;
  const u = UNR[(d - 0x7fc0) >> 7] + 0x101;
  d = Math.floor((0x2000080 - d * u) / 256);
  d = Math.floor((0x80 + d * u) / 256);
  return Math.min(0x1ffff, Math.floor((n * d + 0x8000) / 65536));
}

export interface GteState {
  /** Rotation matrix, row major, signed 16-bit (4096 = 1.0). */
  r: number[];
  /** Translation. */
  tr: [number, number, number];
  /** Projection plane distance. */
  h: number;
  /** Screen offset, 16.16. */
  ofx: number;
  ofy: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** RTPS with sf = 1, lm = 0: the screen position of vertex (vx, vy, vz) as a GP0 xy word. */
export function rtps(s: GteState, vx: number, vy: number, vz: number): number {
  const { r, tr } = s;
  const mac1 = Math.floor((tr[0] * 4096 + r[0] * vx + r[1] * vy + r[2] * vz) / 4096);
  const mac2 = Math.floor((tr[1] * 4096 + r[3] * vx + r[4] * vy + r[5] * vz) / 4096);
  const mac3 = Math.floor((tr[2] * 4096 + r[6] * vx + r[7] * vy + r[8] * vz) / 4096);
  const ir1 = clamp(mac1, -0x8000, 0x7fff);
  const ir2 = clamp(mac2, -0x8000, 0x7fff);
  const sz = clamp(mac3, 0, 0xffff);
  const n = gteDivide(s.h, sz);
  const sx = clamp(Math.floor((n * ir1 + s.ofx) / 65536), -0x400, 0x3ff);
  const sy = clamp(Math.floor((n * ir2 + s.ofy) / 65536), -0x400, 0x3ff);
  return ((sx & 0xffff) | (sy << 16)) >>> 0;
}
