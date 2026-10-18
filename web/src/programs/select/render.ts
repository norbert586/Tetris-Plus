// Draws SELECT's frames (docs/re/select.md §4): its objects_draw (0x80096B7C) sorts every live
// sprite object, from 1049 down to 0, with GsSortSprite into a 2048-entry ordering table; then
// the main loop's GsSortClear. Images are SELECTE.BIN's items, all uploaded when the program
// starts and again whenever an animation uploads one (Select.uploads).
import * as A from '../../core/addr';
import { parseTim, type Tim } from '../../assets/tim';
import { FrameRenderer } from '../../render/frame';
import { OrderingTable, type Sprite } from '../../render/libgs';
import { spriteTemplate, type Frame } from '../../render/renderer';
import type { Select } from './select';

const s16 = (v: number) => (v << 16) >> 16;

export class SelectRenderer extends FrameRenderer {
  readonly tims: Tim[];
  /** FUN_80096314: the GsSPRITE template of each item (state+0x3F074, 0x24 bytes each). */
  readonly templates: Sprite[];

  constructor(items: Uint8Array[]) {
    super();
    this.tims = items.map(parseTim);
    this.templates = this.tims.map(spriteTemplate);
  }

  frame(s: Select): Frame {
    for (const item of s.uploads) this.uploadTim(this.tims[item]);
    const ot = new OrderingTable();
    this.objectsDraw(s, ot);
    const buffer = s.tick & 1;
    ot.sortClear(0, 0, 0, 0, 240 * buffer, 320, 240);
    return this.finish(ot, buffer);
  }

  /** FUN_80096B7C */
  private objectsDraw(s: Select, ot: OrderingTable): void {
    const m = s.m;
    for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
      const o = A.obj(n);
      const image = m.s32(o + A.O_IMAGE);
      if (image === 0) continue;
      // Image 0x10000 (a mode without a players note) reads the 36 bytes before the first
      // template, state+0x3F050: part of the state block, zero in every run seen.
      const t = image === 0x10000 ? readSprite(s, A.S + 0x3f050) : this.templates[image - 0x10001];
      if (!t) throw new Error(`SELECT object ${n}: image 0x${image.toString(16)} has no template`);
      const flip = m.u32(o + A.O_FLIP);
      let attr = (flip & 1) << 23;
      if (flip & 2) attr |= 0x400000;
      const kind = m.s32(o + A.O_KIND);
      if (kind !== 0) attr = (attr | 0x40000000 | (((kind - 1) & 3) << 28)) >>> 0;
      const sp: Sprite = { ...t };
      sp.x = s16(m.s16(o + A.O_X + 2) - 0xa4 + t.x + (t.w >> 1));
      sp.y = s16(m.s16(o + A.O_Y + 2) - 0x78 + t.y + (t.h >> 1));
      sp.attribute = (attr | t.attribute) >>> 0;
      sp.scalex = s16(m.s32(o + A.O_SCALE_X) + 0x1000);
      sp.scaley = s16(m.s32(o + A.O_SCALE_Y) + 0x1000);
      sp.rotate = m.s32(o + A.O_ROT);
      ot.sortSprite(sp, (m.s32(o + A.O_PRIORITY) + 10) & 0xffff);
    }
  }
}

/** A GsSPRITE in RAM. */
function readSprite(s: Select, a: number): Sprite {
  const m = s.m;
  return {
    attribute: m.u32(a),
    x: m.s16(a + 4),
    y: m.s16(a + 6),
    w: m.u16(a + 8),
    h: m.u16(a + 10),
    tpage: m.u16(a + 12),
    u: m.u8(a + 14),
    v: m.u8(a + 15),
    cx: m.s16(a + 16),
    cy: m.s16(a + 18),
    r: m.u8(a + 20),
    g: m.u8(a + 21),
    b: m.u8(a + 22),
    mx: m.s16(a + 24),
    my: m.s16(a + 26),
    scalex: m.s16(a + 28),
    scaley: m.s16(a + 30),
    rotate: m.s32(a + 32),
  };
}
