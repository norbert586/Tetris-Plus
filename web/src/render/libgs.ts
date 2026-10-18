// The parts of PsyQ's libgs PAZLE.EXE draws with: an ordering table and the GsSortClear,
// GsSortFastSprite, GsSortSprite and GsSortBoxFill packet builders, word for word as the
// originals write them (decompiled from PAZLE.EXE at 0x800C4744, 0x800C4880, 0x800C4C20 and
// 0x800C5284). The packets are what the GPU model executes and what the oracle's `ot` hash
// covers (docs/re/renderer.md).
import { rtps, type GteState } from './gte';

/** GsSPRITE. */
export interface Sprite {
  attribute: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tpage: number;
  u: number;
  v: number;
  cx: number;
  cy: number;
  r: number;
  g: number;
  b: number;
  mx: number;
  my: number;
  scalex: number;
  scaley: number;
  rotate: number;
}

/** GsBOXF. */
export interface Box {
  attribute: number;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  g: number;
  b: number;
}

const s16 = (v: number) => (v << 16) >> 16;
const xyWord = (x: number, y: number) => ((x & 0xffff) | (y << 16)) >>> 0;

/** The draw-mode word libgs puts before a sprite or box: texture page plus mode and blend bits. */
function drawMode(attribute: number, tpage: number): number {
  return (0xe1000200 | (tpage & 0x1f) | ((attribute >>> 17) & 0x180) | ((attribute >>> 23) & 0x60)) >>> 0;
}

/** The colour word of a textured primitive: semi-transparency (attr bit 30), no modulation (bit 6). */
function textured(code: number, attribute: number, s: { r: number; g: number; b: number }): number {
  return (((attribute >>> 5) & 0x2000000) | ((attribute & 0x40) << 18) | code | (s.b << 16) | (s.g << 8) | s.r) >>> 0;
}

const clutWord = (s: Sprite) => ((s.cy << 22) | ((s.cx & 0x3f0) << 12)) >>> 0;

/** The GTE as GsInitGraph and InitGeom leave it: H = 1000, offset 0 (libgs's GPU-offset mode). */
const H = 1000;

export class OrderingTable {
  /** Bucket p holds its packets newest first, as libgs links them. */
  private readonly buckets: number[][][];
  private readonly head: number[][] = [];

  constructor(readonly length = 2048) {
    this.buckets = Array.from({ length }, () => []);
  }

  /** AddPrim on the table's head (GsSortClear's clear packet). */
  addFirst(words: number[]): void {
    this.head.unshift(words);
  }

  /** Links a packet into bucket `pri` (the original links it in front of the bucket's list). */
  add(pri: number, words: number[]): void {
    if (pri < 0 || pri >= this.length) throw new Error(`ordering table priority ${pri} out of range`);
    this.buckets[pri].unshift(words);
  }

  /**
   * Packets in drawing order: the head, the buckets from the highest priority down, then the
   * 4-word dummy packet (all zero, 0x800E73F8) ClearOTagR links the last entry to.
   */
  *packets(): Generator<number[]> {
    yield* this.head;
    for (let p = this.length - 1; p >= 0; p--) yield* this.buckets[p];
    yield [0, 0, 0, 0];
  }

  /** GsSortClear: a fill of the drawing buffer. */
  sortClear(r: number, g: number, b: number, x: number, y: number, w: number, h: number): void {
    this.addFirst([(0x02000000 | (b << 16) | (g << 8) | r) >>> 0, xyWord(x, y), xyWord(w, h)]);
  }

  /** GsSortFastSprite: draw mode and a textured rectangle. */
  sortFastSprite(s: Sprite, pri: number): void {
    if (s.attribute & 0x80000000 || s.w === 0 || s.h === 0) return;
    this.add(pri, [
      drawMode(s.attribute, s.tpage),
      textured(0x64000000, s.attribute, s),
      xyWord(s.x, s.y),
      (s.u | (s.v << 8) | clutWord(s)) >>> 0,
      xyWord(s.w, s.h),
    ]);
  }

  /** GsSortBoxFill: draw mode and a flat rectangle. */
  sortBoxFill(b: Box, pri: number): void {
    if (b.attribute & 0x80000000) return;
    const code = (((b.attribute >>> 29) & 2) | 0x60) << 24;
    this.add(pri, [drawMode(b.attribute, 0), (code | (b.b << 16) | (b.g << 8) | b.r) >>> 0, xyWord(b.x, b.y), xyWord(b.w, b.h)]);
  }

  /**
   * GsSortSprite: a sprite that may be scaled, flipped (attribute bits 23 x, 22 y) or rotated,
   * as a flat-textured quad whose corners the GTE projects. Unscaled, unrotated and unflipped
   * sprites (or attribute bit 27) take GsSortFastSprite's packet, offset by (mx, my).
   */
  sortSprite(s: Sprite, pri: number): void {
    const a = s.attribute;
    if (a & 0x80000000 || s.w === 0 || s.h === 0) return;
    const unit = s.scalex === 0x1000 && s.scaley === 0x1000;
    if (a & 0x8000000 || (unit && s.rotate === 0 && (a & 0xc00000) === 0)) {
      this.add(pri, [
        drawMode(a, s.tpage),
        textured(0x64000000, a, s),
        xyWord(s.x - s.mx, s.y - s.my),
        (s.u | (s.v << 8) | clutWord(s)) >>> 0,
        xyWord(s.w, s.h),
      ]);
      return;
    }
    if (s.rotate !== 0) throw new Error('GsSortSprite: rotation is not ported (Puzzle Mode never rotates)');
    // Identity matrix (0x800EE9EC), scaled by ScaleMatrix(m, (scalex, scaley, 0)).
    const r = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];
    if (!unit) {
      const v = [s16(s.scalex), s16(s.scaley), 0];
      for (let i = 0; i < 9; i++) r[i] = s16((r[i] * v[i % 3]) >> 12);
    }
    const gte: GteState = { r, tr: [s16(s.x), s16(s.y), H], h: H, ofx: 0, ofy: 0 };
    const x0 = -s.mx;
    const y0 = -s.my;
    const sxy0 = rtps(gte, x0, y0, 0);
    const sxy1 = rtps(gte, x0 + s.w, y0, 0);
    const sxy2 = rtps(gte, x0, y0 + s.h, 0);
    const sxy3 = rtps(gte, x0 + s.w, y0 + s.h, 0);
    // The far texel edge uses the low byte of w and h.
    let u0 = s.u;
    let u1 = (s.u + (s.w & 0xff) - 1) & 0xff;
    if (a & 0x800000) [u0, u1] = [u1, u0];
    let v0 = s.v;
    let v1 = (s.v + (s.h & 0xff) - 1) & 0xff;
    if (a & 0x400000) [v0, v1] = [v1, v0];
    const tpage = ((s.tpage & 0x1f) << 16) | ((a >>> 1) & 0x1800000) | ((a >>> 7) & 0x600000);
    this.add(pri, [
      textured(0x2c000000, a, s),
      sxy0,
      (u0 | (v0 << 8) | clutWord(s)) >>> 0,
      sxy1,
      (u1 | (v0 << 8) | tpage) >>> 0,
      sxy2,
      (u0 | (v1 << 8)) >>> 0,
      sxy3,
      (u1 | (v1 << 8)) >>> 0,
    ]);
  }
}
