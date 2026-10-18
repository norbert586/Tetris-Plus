// Draws SW_ON's frames (docs/re/sw_on.md §4): its objects_draw (0x80096A48) sorts every live
// object, 1049 down to 0, as a GsSortSprite of the template built for its image (FUN_800961E0,
// templates at state+0x3F074), after the fade's box fill sorted during the logic; then the main
// loop's GsSortClear. All 24 images are uploaded when the program starts (FUN_80095EC8); the
// logic's later uploads put the same images at the same places again.
import { parseTim, type Tim } from '../../assets/tim';
import * as A from '../../core/addr';
import type { ProgramRenderer } from '../../flow/program';
import { FrameRenderer } from '../../render/frame';
import { OrderingTable, type Sprite } from '../../render/libgs';
import { spriteTemplate, type Frame } from '../../render/renderer';
import type { SwOn } from './sw_on';

const s16 = (v: number) => (v << 16) >> 16;

export class SwOnRenderer extends FrameRenderer implements ProgramRenderer {
  readonly tims: Tim[];
  /** FUN_800961E0's templates: the same GsSPRITE as Puzzle Mode's (GetTPage with abr 0). */
  readonly templates: Sprite[];

  constructor(items: Uint8Array[]) {
    super();
    this.tims = items.map(parseTim);
    this.templates = this.tims.map(spriteTemplate);
    for (const tim of this.tims) this.uploadTim(tim);
  }

  frame(p: SwOn): Frame {
    for (const item of p.uploads) this.uploadTim(this.tims[item]);
    const ot = new OrderingTable();
    for (const c of p.fades) {
      // FUN_80099934: subtractive full-screen box.
      ot.sortBoxFill({ attribute: 0x60000000, x: -0xa0, y: -0x78, w: 0x140, h: 0xf0, r: c, g: c, b: c }, 0);
    }
    this.objectsDraw(p, ot);
    // GsGetActiveBuff alternates from 0 at tick 1; the table is drawn into the other buffer.
    const buffer = p.tick & 1;
    ot.sortClear(0, 0, 0, 0, 240 * buffer, 320, 240);
    return this.finish(ot, buffer);
  }

  private objectsDraw(p: SwOn, ot: OrderingTable): void {
    const m = p.m;
    for (let n = 0x419; n >= 0; n--) {
      const o = A.S + 0x5c + n * 0x7c;
      const image = m.s32(o + 0x24);
      if (image === 0) continue;
      const t = this.templates[image - 0x10001];
      if (!t) throw new Error(`SW_ON object ${n}: image 0x${image.toString(16)} has no template`);
      const flip = m.u32(o + 0x44);
      let attribute = ((flip & 1) << 23) >>> 0;
      if (flip & 2) attribute = (attribute | 0x400000) >>> 0;
      const kind = m.s32(o + 0x14);
      if (kind !== 0) attribute = (attribute | 0x40000000 | (((kind - 1) & 3) << 28)) >>> 0;
      const s: Sprite = { ...t };
      s.x = s16(m.s16(o + 2) - 0xa4 + t.x + ((t.w & 0xffff) >> 1));
      s.y = s16(m.s16(o + 6) - 0x78 + t.y + ((t.h & 0xffff) >> 1));
      s.attribute = (attribute | t.attribute) >>> 0;
      s.scalex = s16(m.s16(o + 8) + 0x1000);
      s.scaley = s16(m.s16(o + 0xc) + 0x1000);
      s.rotate = m.s32(o + 0x10);
      ot.sortSprite(s, (m.s32(o + 0x40) + 10) & 0xffff);
    }
  }
}
