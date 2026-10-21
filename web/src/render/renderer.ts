// Draws a Puzzle Mode frame the way PAZLE.EXE does (docs/re/renderer.md): the core's sprite
// objects and immediate draws are sorted into a libgs ordering table by a port of objects_draw
// (0x8009882C), and the packets run on a model of the GPU and its VRAM, into which the images
// are uploaded at the same points as the original's.
import * as A from '../core/addr';
import type { Mem } from '../core/mem';
import type { Box } from '../core/objects';

/** What the renderer draws from: a program's memory and the tick's presentation events. */
export interface Drawable {
  m: Mem;
  tick: number;
  uploads: number[];
  boxes: { box: Box; pri: number }[];
  boxColors: number[];
}

/**
 * How a program sorts its sprite objects: PAZLE's objects_draw, or the simpler loop the other
 * programs use (always GsSortSprite at int(x) - 0xA4 and int(y) - yBias, the template centred,
 * bucket priority + bucket; docs/re/shell.md §6).
 */
export interface DrawStyle {
  kind: 'pazle' | 'shell';
  yBias?: number;
  bucket?: number;
  /** Which objects are drawn: image above 0x10000 (RANKING, the default) or any non-zero image (TITLE). */
  live?: 'above' | 'nonzero';
  /** Blend kinds also set the semi-transparency bit (TITLE), or only the rate bits (RANKING). */
  semi?: boolean;
}
import { parseTim, type Tim } from '../assets/tim';
import { Gpu, VRAM_WIDTH } from './gpu';
import { OrderingTable, type Sprite } from './libgs';

/** Per-image position offsets (16.16) for images below 0x10200 (objects_draw). */
const IMAGE_OFFSETS = 0x800d64ac;
/** Per-layer x offset (16.16) of player 2's objects. */
const LAYER_OFFSETS = 0x800d74ac;
/** Pixels per VRAM word and u masks by colour mode (0x800E2664, 0x800E266C). */
const MODE_TEXELS = [4, 2, 1, 1];
const MODE_U_MASK = [0xff, 0x7f, 0x3f, 0x3f];

const s16 = (v: number) => (v << 16) >> 16;

/** An upload event as the core and the oracle log it (`up`): item + 0x10000 * player, + 0x100000 if queued. */
export const UPLOAD_QUEUED = 0x100000;

/** FUN_80097830: the GsSPRITE template sprite_templates_init builds for an image. */
export function spriteTemplate(tim: Tim): Sprite {
  const mode = tim.flags & 3;
  const { image, clut } = tim;
  const w = (image.w * MODE_TEXELS[mode]) & 0xffff;
  const tpage = (mode << 7) | (((image.y & 0xff00) & 0x100) >> 4) | (((image.x & 0xffc0) & 0x3ff) >> 6);
  return {
    attribute: mode << 24,
    x: 0,
    y: 0,
    w,
    h: image.h,
    tpage,
    u: ((image.x * MODE_TEXELS[mode]) & 0xff) & MODE_U_MASK[mode],
    v: image.y & 0xff,
    cx: clut ? clut.x : 0,
    cy: clut ? clut.y : 0,
    r: 0x80,
    g: 0x80,
    b: 0x80,
    mx: w >> 1,
    my: image.h >> 1,
    scalex: 0x1000,
    scaley: 0x1000,
    rotate: 0,
  };
}

/** FNV-1a over 32-bit words, as the oracle's `ot` and `fb` hashes (re/lua/movie.lua). */
export function fnv(h: number, w: number): number {
  return Math.imul(h ^ w, 16777619);
}
export const FNV_BASIS = 0x811c9dc5 | 0;

export interface Frame {
  /** The display buffer drawn this tick, 0 (y 0) or 1 (y 240). */
  buffer: number;
  /** Hash of the GPU packets, comparable with the oracle's `ot`. */
  ot: number;
  /** Hash of the 320x240 frame, comparable with the oracle's `fb`. */
  fb: number;
}

export class Renderer {
  readonly gpu = new Gpu();
  readonly tims: Tim[];
  readonly templates: Sprite[];
  private readonly zeroSprite: Sprite;
  /** Packets of the last frame, in drawing order (for debugging). */
  packets: number[][] = [];
  /**
   * Leave out player 2's sprite objects (from 400 up, player field 1; player 1 also has objects
   * above 400): the "PRESS START" panel and its character,
   * hidden until two-player mode exists (docs/RESEARCH_AND_PLAN.md §9); the brick wall behind
   * them stays. Off for verification.
   */
  hidePlayer2 = false;

  constructor(items: Uint8Array[], readonly style: DrawStyle = { kind: 'pazle' }) {
    this.tims = items.map(parseTim);
    this.templates = this.tims.map(spriteTemplate);
    this.zeroSprite = Object.fromEntries(Object.keys(this.templates[0]).map((k) => [k, 0])) as unknown as Sprite;
    // sprite_templates_init uploads every image once, at its own VRAM position.
    for (const tim of this.tims) this.upload(tim, 0);
  }

  /** tim_upload: the image and its CLUT, 256 rows and 1 row lower for player 2. */
  private upload(tim: Tim, player: number): void {
    const { image, clut } = tim;
    this.gpu.loadImage(image.x, image.y + 256 * player, image.w, image.h, image.data);
    if (clut) this.gpu.loadImage(clut.x, clut.y + player, clut.w, clut.h, clut.data);
  }

  /** Applies a tick's uploads: item_load's at once, then the first 4 queued (upload_queue_flush). */
  applyUploads(events: number[]): void {
    const queued: number[] = [];
    for (const e of events) {
      if (e & UPLOAD_QUEUED) {
        if (queued.length < 4) queued.push(e);
      } else {
        this.upload(this.tims[e & 0xffff], (e >> 16) & 0xf);
      }
    }
    for (const e of queued) this.upload(this.tims[e & 0xffff], (e >> 16) & 0xf);
  }

  /** Renders the frame of the game's last tick. */
  frame(g: Drawable): Frame {
    this.applyUploads(g.uploads);
    // GsGetActiveBuff alternates from 0 at tick 1; the table is drawn into the other buffer.
    return this.draw(g, g.tick & 1);
  }

  /** Sorts and draws the game's objects and boxes into display buffer `buffer`. */
  draw(g: Drawable, buffer: number): Frame {
    const top = 240 * buffer;
    const ot = new OrderingTable();
    for (const b of g.boxes) ot.sortBoxFill(b.box, b.pri);
    if (this.style.kind === 'shell') this.shellObjectsDraw(g, ot);
    else this.objectsDraw(g, ot);
    ot.sortClear(0, 0, 0, 0, top, 320, 240);

    const gpu = this.gpu;
    gpu.setDrawingArea(0, top, 319, top + 239);
    gpu.setDrawingOffset(160, top + 120);
    let otHash = FNV_BASIS;
    this.packets = [];
    for (const words of ot.packets()) {
      this.packets.push(words);
      for (const w of words) otHash = fnv(otHash, w | 0);
      gpu.command(words);
    }
    let fb = FNV_BASIS;
    for (let y = top; y < top + 240; y++) {
      const row = y * VRAM_WIDTH;
      for (let x = 0; x < 320; x++) fb = fnv(fb, gpu.vram[row + x]);
    }
    return { buffer, ot: otHash, fb };
  }

  /** The 320x240 frame of the last tick, as 15-bit pixels. */
  pixels(buffer: number): Uint16Array {
    const out = new Uint16Array(320 * 240);
    for (let y = 0; y < 240; y++) out.set(this.gpu.vram.subarray((240 * buffer + y) * VRAM_WIDTH, (240 * buffer + y) * VRAM_WIDTH + 320), y * 320);
    return out;
  }

  /** objects_draw (0x8009882C), for its drawing: every live object from 1049 down to 0. */
  /**
   * The other programs' objects_draw (RANKING 0x80096564, TITLE, SELECT, SW_ON): objects 1049
   * down to 0 whose image is above 0x10000, each a GsSortSprite of its template, centred.
   */
  private shellObjectsDraw(g: Drawable, ot: OrderingTable): void {
    const m = g.m;
    const yBias = this.style.yBias ?? 0x78;
    const bucket = this.style.bucket ?? 0;
    for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
      const o = A.obj(n);
      const image = m.s32(o + A.O_IMAGE);
      if (this.style.live === 'nonzero' ? image === 0 : image <= 0x10000) continue;
      const t = image === 0x10000 ? this.zeroSprite : this.templates[image - 0x10001];
      if (!t) throw new Error(`object ${n}: image 0x${image.toString(16)} has no template`);
      const flip = m.u32(o + A.O_FLIP);
      let attr = (flip & 1) << 23;
      if (flip & 2) attr |= 0x400000;
      const kind = m.u32(o + A.O_KIND);
      if (kind !== 0) {
        attr = this.style.semi
          ? (attr | 0x40000000 | (((kind - 1) & 3) << 28)) >>> 0
          : (attr | Math.imul((kind & 7) - 1, 0x10000000)) >>> 0;
      }
      const s: Sprite = { ...t };
      s.x = s16(m.s16(o + A.O_X + 2) - 0xa4 + t.x + (t.w >> 1));
      s.y = s16(m.s16(o + A.O_Y + 2) - yBias + t.y + (t.h >> 1));
      s.scalex = s16(m.s32(o + A.O_SCALE_X) + 0x1000);
      s.scaley = s16(m.s32(o + A.O_SCALE_Y) + 0x1000);
      s.rotate = m.s32(o + A.O_ROT);
      s.attribute = (attr | t.attribute) >>> 0;
      ot.sortSprite(s, (m.u16(o + A.O_PRIORITY) + bucket) & 0xffff);
    }
  }

  private objectsDraw(g: Drawable, ot: OrderingTable): void {
    const m = g.m;
    let randomBox = 0;
    for (let n = A.OBJ_COUNT - 1; n >= 0; n--) {
      const o = A.obj(n);
      const image = m.s32(o + A.O_IMAGE);
      if (image <= 0) continue;
      // The brick wall behind player 2's idle screen (object 0x1E, item 299) stays.
      if (this.hidePlayer2 && n >= 400 && m.s32(o + A.O_PLAYER) === 1 && !(n === 400 + 0x1e && m.s32(A.SCREEN + 4) === 8)) {
        // Its box-fill objects still used their rand() colours.
        if (m.s32(o + A.O_KIND) === -1) randomBox++;
        continue;
      }
      const pri = m.s32(o + A.O_PRIORITY) < 1 ? 20 - Math.trunc(n / 50) : m.u16(o + A.O_PRIORITY);
      const kind = m.s32(o + A.O_KIND);
      if (kind === -1) {
        // FUN_800987AC: an opaque box whose colour objects_draw took from rand().
        const [r, gr, b] = g.boxColors.slice(3 * randomBox, 3 * randomBox + 3);
        randomBox++;
        ot.sortBoxFill({ attribute: 0, x: m.s16(o + A.O_X), y: m.s16(o + A.O_Y), w: m.u16(o + A.O_SCALE_X), h: m.u16(o + A.O_SCALE_Y), r, g: gr, b }, 0);
        continue;
      }
      if (kind === -2 || kind === -3) {
        // FUN_80098244 (darken, subtractive) / FUN_80098300 (lighten, additive): level 0-64.
        const c = Math.trunc(((0x40 - m.s32(o + A.O_4C)) * 0xff) / 0x40) & 0xff;
        ot.sortBoxFill(
          {
            attribute: kind === -2 ? 0x60000000 : 0x50000000,
            x: s16(m.s16(o + A.O_X) - 0xa0),
            y: s16(m.s16(o + A.O_Y) - 0x78),
            w: m.u16(o + A.O_VX),
            h: m.u16(o + A.O_VY),
            r: c,
            g: c,
            b: c,
          },
          pri,
        );
        continue;
      }
      const item = image - 0x10001;
      // Image 0x10000 (item -1, the save screen's empty slots) reads the 0x24 zero bytes before
      // the template array: a zero-size sprite, sorted like any other but drawing nothing.
      const t = item === -1 ? this.zeroSprite : this.templates[item];
      if (!t) throw new Error(`object ${n}: image 0x${image.toString(16)} has no template`);
      const s: Sprite = { ...t };
      s.scalex = s16(m.s16(o + A.O_SCALE_X) + 0x1000);
      s.scaley = s16(m.s16(o + A.O_SCALE_Y) + 0x1000);
      let sx: number;
      let sy: number;
      if (image < 0x10200) {
        const k = (image - 0x10000) * 8;
        sx = s16((m.s32(o + A.O_X) + m.s32(IMAGE_OFFSETS + k)) >>> 16);
        sy = s16((m.s32(o + A.O_Y) + m.s32(IMAGE_OFFSETS + k + 4)) >>> 16);
      } else {
        sx = m.s16(o + A.O_X + 2);
        sy = m.s16(o + A.O_Y + 2);
      }
      const player = m.s32(o + A.O_PLAYER);
      sx = s16(sx + 0x10 + s16(Math.imul(m.s32(LAYER_OFFSETS + 4 * m.s32(o + A.O_20)), player) >>> 16));
      const palette = m.s32(o + A.O_PALETTE);
      s.tpage = s16(s.tpage + palette * 0x10);
      s.cy = s16(s.cy + palette);
      if (kind !== 0) s.attribute = ((((kind - 1) & 3) << 28) | s.attribute | 0x40000000) >>> 0;
      const flip = m.u32(o + A.O_FLIP);
      if ((flip & 3) === 0 && m.s32(o + A.O_SCALE_X) === 0 && m.s32(o + A.O_SCALE_Y) === 0 && m.s32(o + A.O_ROT) === 0) {
        s.x = s16(s.x - 0xb4 + sx);
        s.y = s16(s.y - 0x78 + sy + 4);
        ot.sortFastSprite(s, pri);
      } else {
        if (flip & 1) s.attribute = (s.attribute | 0x800000) >>> 0;
        if (flip & 2) s.attribute = (s.attribute | 0x400000) >>> 0;
        s.rotate = m.s32(o + A.O_ROT);
        s.x = s16(s.x + sx + ((s16(s.w) >> 1) - 0xb4));
        s.y = s16(s.y + sy + 4 + ((s16(s.h) >> 1) - 0x78));
        ot.sortSprite(s, pri);
      }
    }
  }
}


