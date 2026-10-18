// Draws TITLE.EXE's frames: the boxes its logic sorts (the white flash, priority 0), then its
// objects_draw (FUN_8009683C): every live object from 1049 down to 0 with GsSortSprite, at
// priority object+0x40 + 10, no per-image offsets. Images: all 143 of TITLEE.BIN once before the
// main loop (FUN_80095D14), then the ones the logic unpacks again (Title.uploads), each at its
// own VRAM position. docs/re/title.md §3.
import { parseTim, type Tim } from '../../assets/tim';
import type { Program, ProgramRenderer } from '../../flow/program';
import { FrameRenderer } from '../../render/frame';
import { OrderingTable, type Sprite } from '../../render/libgs';
import { spriteTemplate, type Frame } from '../../render/renderer';
import { obj } from './common';
import { LAYOUT, type Title } from './logic';

const s16 = (v: number) => (v << 16) >> 16;

/** Image 0x10000 (an animation frame 0) reads the 0x24 bytes before the templates: zero. */
const NO_TEMPLATE: Sprite = {
  attribute: 0, x: 0, y: 0, w: 0, h: 0, tpage: 0, u: 0, v: 0, cx: 0, cy: 0, r: 0, g: 0, b: 0, mx: 0, my: 0, scalex: 0, scaley: 0, rotate: 0,
};

export class TitleRenderer extends FrameRenderer implements ProgramRenderer {
  readonly tims: Tim[];
  readonly templates: Sprite[];

  constructor(items: Uint8Array[]) {
    super();
    this.tims = items.map(parseTim);
    this.templates = this.tims.map(spriteTemplate);
    for (const tim of this.tims) this.uploadTim(tim);
  }

  frame(p: Program): Frame {
    const g = p as Title;
    const m = g.m;
    for (const item of g.uploads) this.uploadTim(this.tims[item]);
    const buffer = 1 - m.s32(LAYOUT.activeBuff);
    const ot = new OrderingTable();
    for (const b of g.boxes) ot.sortBoxFill(b.box, b.pri);
    for (let n = 0x419; n >= 0; n--) {
      const o = obj(n);
      const image = m.s32(o + 0x24);
      if (image === 0) continue;
      const t = image === 0x10000 ? NO_TEMPLATE : this.templates[image - 0x10001];
      if (!t) throw new Error(`TITLE object ${n}: image 0x${image.toString(16)} has no template`);
      const flip = m.u32(o + 0x44);
      let attr = (flip & 1) << 23;
      if (flip & 2) attr |= 0x400000;
      const kind = m.s32(o + 0x14);
      if (kind !== 0) attr |= 0x40000000 | (((kind - 1) & 3) << 28);
      const s: Sprite = { ...t };
      s.x = s16(m.s16(o + 2) - 0xa4 + t.x + ((t.w & 0xffff) >> 1));
      s.y = s16(m.s16(o + 6) - 0x74 + t.y + ((t.h & 0xffff) >> 1));
      s.attribute = (attr | t.attribute) >>> 0;
      s.scalex = s16(m.s16(o + 8) + 0x1000);
      s.scaley = s16(m.s16(o + 0xc) + 0x1000);
      s.rotate = m.s32(o + 0x10);
      ot.sortSprite(s, (m.s32(o + 0x40) + 10) & 0xffff);
    }
    ot.sortClear(0, 0, 0, 0, 240 * buffer, 320, 240);
    return this.finish(ot, buffer);
  }
}
