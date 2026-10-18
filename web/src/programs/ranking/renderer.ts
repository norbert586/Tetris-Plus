// Draws RANKING.EXE's frames: its objects_draw (FUN_80096564) sorts every live sprite object
// with GsSortSprite into the libgs ordering table, then GsSortClear (docs/re/ranking.md §4).
// The 102 images of RANKINGE.BIN are uploaded once, before the main loop (FUN_80095B44).
import * as A from '../../core/addr';
import { parseTim } from '../../assets/tim';
import { FrameRenderer } from '../../render/frame';
import { OrderingTable, type Sprite } from '../../render/libgs';
import { spriteTemplate, type Frame } from '../../render/renderer';
import type { Program, ProgramRenderer } from '../../flow/program';
import { ACTIVE_BUFF } from './ranking';

const s16 = (v: number) => (v << 16) >> 16;

export class RankingRenderer extends FrameRenderer implements ProgramRenderer {
  /** The GsSPRITE templates FUN_80095D38 builds (the same as Puzzle Mode's sprite_templates_init). */
  readonly templates: Sprite[];

  constructor(items: Uint8Array[]) {
    super();
    const tims = items.map(parseTim);
    this.templates = tims.map(spriteTemplate);
    for (const tim of tims) this.uploadTim(tim);
  }

  frame(p: Program): Frame {
    const m = p.m;
    // The table built this tick is drawn after GsSwapDispBuff, into the other buffer.
    const buffer = 1 - m.s32(ACTIVE_BUFF);
    const ot = new OrderingTable();
    for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
      const o = A.obj(n);
      const image = m.s32(o + A.O_IMAGE);
      if (image <= 0x10000) continue;
      const flip = m.u32(o + A.O_FLIP);
      let attr = (flip & 1) << 23;
      if (flip & 2) attr |= 0x400000;
      const kind = m.u32(o + A.O_KIND);
      if (kind !== 0) attr |= Math.imul((kind & 7) - 1, 0x10000000);
      const t = this.templates[image - 0x10001];
      if (!t) throw new Error(`RANKING object ${n}: image 0x${image.toString(16)} has no template`);
      const s: Sprite = { ...t };
      s.x = s16(m.s16(o + A.O_X + 2) - 0xa4 + t.x + ((t.w & 0xffff) >> 1));
      s.y = s16(m.s16(o + A.O_Y + 2) - 0x74 + t.y + ((t.h & 0xffff) >> 1));
      s.scalex = s16(m.s16(o + A.O_SCALE_X) + 0x1000);
      s.scaley = s16(m.s16(o + A.O_SCALE_Y) + 0x1000);
      s.rotate = m.s32(o + A.O_ROT);
      s.attribute = (attr | t.attribute) >>> 0;
      ot.sortSprite(s, m.u16(o + A.O_PRIORITY));
    }
    ot.sortClear(0, 0, 0, 0, 240 * buffer, 320, 240);
    return this.finish(ot, buffer);
  }
}
