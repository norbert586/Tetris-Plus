// Draws TIT_DEMO.EXE's frames: its objects_draw (FUN_80096854) sorts every live object, from
// 1049 down to 0, at priority 20 - n / 50: box fills (kind -1, colours from rand()), darkening
// or lightening boxes (kinds -2 and -3, by the object's fade level) and sprites (GsSortSprite,
// positioned by the per-image offset table 0x800ADC68). All 409 images of TDEMOE.BIN are
// uploaded once, before the main loop (FUN_80095BF8). docs/re/title.md §2.
import { parseTim } from '../../assets/tim';
import type { Program, ProgramRenderer } from '../../flow/program';
import { FrameRenderer } from '../../render/frame';
import { OrderingTable, type Sprite } from '../../render/libgs';
import { spriteTemplate, type Frame } from '../../render/renderer';
import { obj } from '../title/common';
import type { TitDemo } from './logic';
import { LAYOUT } from './logic';

const IMAGE_OFFSETS = 0x800adc68; // 16.16 x, y per image (indexed by image - 0x10000)
const LAYER_OFFSETS = 0x800aec68; // 16.16 x per layer (+0x20), times the player (+0x1C)

const s16 = (v: number) => (v << 16) >> 16;

export class TitDemoRenderer extends FrameRenderer implements ProgramRenderer {
  readonly templates: Sprite[];

  constructor(items: Uint8Array[]) {
    super();
    const tims = items.map(parseTim);
    this.templates = tims.map(spriteTemplate);
    for (const tim of tims) this.uploadTim(tim);
  }

  frame(p: Program): Frame {
    const g = p as TitDemo;
    const m = g.m;
    const buffer = 1 - m.s32(LAYOUT.activeBuff);
    const ot = new OrderingTable();
    let box = 0;
    for (let n = 0x419; n >= 0; n--) {
      const o = obj(n);
      const image = m.s32(o + 0x24);
      if (image === 0) continue;
      const kind = m.s32(o + 0x14);
      const pri = 0x14 - Math.trunc(n / 0x32);
      if (kind === -1) {
        // FUN_80096AD4
        const [r, gr, b] = g.boxColors.slice(3 * box, 3 * box + 3);
        box++;
        ot.sortBoxFill({ attribute: 0, x: m.s16(o), y: s16(m.s16(o + 4) + 4), w: m.u16(o + 8), h: m.u16(o + 0xc), r, g: gr, b }, pri);
        continue;
      }
      if (kind === -2 || kind === -3) {
        // FUN_80097D08 (darken, subtractive) / FUN_80097DB8 (lighten, additive): level 0-64.
        const c = Math.trunc(((0x40 - m.s32(o + 0x4c)) * 0xff) / 0x40) & 0xff;
        ot.sortBoxFill(
          {
            attribute: kind === -2 ? 0x60000000 : 0x50000000,
            x: s16(m.s16(o) - 0xa0),
            y: s16(m.s16(o + 4) + 4 - 0x78),
            w: m.u16(o + 0x38),
            h: m.u16(o + 0x3c),
            r: c,
            g: c,
            b: c,
          },
          pri,
        );
        continue;
      }
      // FUN_80096080
      const t = this.templates[image - 0x10001];
      if (!t) throw new Error(`TIT_DEMO object ${n}: image 0x${image.toString(16)} has no template`);
      const k = (image - 0x10000) * 8;
      const flip = m.u32(o + 0x44);
      let attr = (flip & 1) << 23;
      if (flip & 2) attr |= 0x400000;
      if (kind !== 0) attr |= 0x40000000 | (((kind - 1) & 3) << 28);
      const layer = s16(Math.imul(m.s32(LAYER_OFFSETS + 4 * m.s32(o + 0x20)), m.s32(o + 0x1c)) >>> 16);
      const x = s16(s16((m.s32(o) + m.s32(IMAGE_OFFSETS + k)) >>> 16) + layer - 0xa4);
      const y = s16(s16((m.s32(o + 4) + m.s32(IMAGE_OFFSETS + k + 4)) >>> 16) - 0x70);
      const palette = m.u8(o + 0x48);
      const s: Sprite = { ...t };
      s.x = s16(x + t.x + ((t.w & 0xffff) >> 1));
      s.y = s16(y + t.y + ((t.h & 0xffff) >> 1));
      s.attribute = (attr | t.attribute) >>> 0;
      s.tpage = s16(t.tpage + palette * 0x10);
      s.cy = s16(t.cy + palette);
      s.scalex = s16(m.s16(o + 8) + 0x1000);
      s.scaley = s16(m.s16(o + 0xc) + 0x1000);
      s.rotate = m.s32(o + 0x10);
      ot.sortSprite(s, pri);
    }
    ot.sortClear(0, 0, 0, 0, 240 * buffer, 320, 240);
    return this.finish(ot, buffer);
  }
}
