// The browser's Stats tile on the mode select (docs/re/select.md §7): its "STATS" name and its
// "HIGH SCORES" banner, made from letters SELECTE.BIN already has, so the tile looks like the
// others. The name takes S and A from "CLASSIC MODE" and T from "EDIT MODE"; the banner takes its
// letters from the five mode banners. Both are drawn on a copy of a label or banner whose own
// letters are cleared to its background, and go where images of Classic, which the browser's
// mode select doesn't show, are kept: the VS name's VRAM (and CLUT) and the Classic banner's.
import type { Tim, VramRect } from '../../assets/tim';

/** The two images, as items after SELECTE.BIN's 177 (Select uploads them, the renderer adds them). */
export const STATS_LABEL = 177;
export const STATS_TEXT = 178;

// SELECTE.BIN's items
const VS_LABEL = 21;
const CLASSIC_LABEL = 22;
const EDIT_LABEL = 24;
const CLASSIC_TEXT = 27;
const PUZZLE_TEXT = 28;
const EDIT_TEXT = 29;

/** 4-bit pixels of a TIM, by palette index. */
class Pixels {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  constructor(readonly tim: Tim) {
    if ((tim.flags & 3) !== 0 || !tim.clut) throw new Error('stats: expected a 4-bit TIM');
    this.w = tim.image.w * 4;
    this.h = tim.image.h;
    this.px = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.px[y * this.w + x] = (tim.image.data[y * tim.image.w + (x >> 2)] >> ((x & 3) * 4)) & 15;
  }
  get(x: number, y: number): number {
    return this.px[y * this.w + x];
  }
  set(x: number, y: number, i: number): void {
    this.px[y * this.w + x] = i;
  }
  colour(x: number, y: number): number {
    return this.tim.clut!.data[this.get(x, y)];
  }
  /** The palette index of a colour (the first, as two entries can hold the same colour). */
  index(colour: number): number {
    const i = this.tim.clut!.data.indexOf(colour);
    if (i < 0) throw new Error(`stats: colour ${colour.toString(16)} is not in the palette`);
    return i;
  }
  /** Packs the pixels back into a TIM's words, at `at`'s VRAM position. */
  rect(at: VramRect): VramRect {
    const data = new Uint16Array(this.tim.image.data.length);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) data[y * this.tim.image.w + (x >> 2)] |= this.get(x, y) << ((x & 3) * 4);
    return { x: at.x, y: at.y, w: this.tim.image.w, h: this.tim.image.h, data };
  }
}

/**
 * Copies a letter's pixels, those in `ink`, from `src` (columns x0 to x1, rows y0 to y0 + rows
 * - 1) to `dst` at (dx, dy), in `dst`'s palette.
 */
function paste(src: Pixels, x0: number, x1: number, y0: number, rows: number, ink: (c: number) => boolean, dst: Pixels, dx: number, dy: number): void {
  for (let y = 0; y < rows; y++)
    for (let x = x0; x <= x1; x++) {
      const c = src.colour(x, y0 + y);
      if (ink(c)) dst.set(dx + x - x0, dy + y, dst.index(c));
    }
}

// The mode names: the background is a pattern two pixels wide that changes by row.
const LABEL_BACKGROUND = new Set([0x7fff, 0x7f5a, 0x7df7, 0x7e52, 0x7d29, 0x7800, 0]);
const LABEL_ROWS = [4, 20];
const LABEL_COLUMNS = [4, 75];
/** Columns (first, last) of the letters used, with their shadows. */
const LABEL_S = { item: CLASSIC_LABEL, x0: 25, x1: 30 };
const LABEL_A = { item: CLASSIC_LABEL, x0: 18, x1: 24 };
const LABEL_T = { item: EDIT_LABEL, x0: 32, x1: 41 };

function statsLabel(tims: Tim[]): Tim {
  const base = new Pixels(tims[EDIT_LABEL]);
  const [top, bottom] = LABEL_ROWS;
  const [left, right] = LABEL_COLUMNS;
  // Clear "EDIT MODE": each pixel takes the background of the first two columns, by parity.
  for (let y = top; y <= bottom; y++) {
    for (const x of [left, left + 1]) if (!LABEL_BACKGROUND.has(base.colour(x, y))) throw new Error('stats: the name has no clear column');
    for (let x = left + 2; x <= right; x++) base.set(x, y, base.get(left + ((x - left) & 1), y));
  }
  const letters = [LABEL_S, LABEL_T, LABEL_A, LABEL_T, LABEL_S];
  const width = letters.reduce((n, l) => n + l.x1 - l.x0 + 1, 0);
  let x = left + Math.floor((right - left + 1 - width) / 2);
  for (const l of letters) {
    paste(new Pixels(tims[l.item]), l.x0, l.x1, top, bottom - top + 1, (c) => !LABEL_BACKGROUND.has(c), base, x, top);
    x += l.x1 - l.x0 + 1;
  }
  const vs = tims[VS_LABEL];
  for (let i = 0; i < 16; i++)
    if (vs.clut!.data[i] !== base.tim.clut!.data[i]) throw new Error('stats: the VS name has another palette');
  return { flags: base.tim.flags, clut: vs.clut, image: base.rect(vs.image) };
}

// The banners: one font (11 x 15 cells; I is 7 wide) drawn in three colours.
const TEXT_INK = new Set([0x422, 0x4210, 0x77bd]);
const TEXT_ROWS = 15;
/** The Classic banner's line: its first row, and the columns its letters may cover. */
const TEXT_TOP = 12;
const TEXT_COLUMNS = [10, 214];
/** Where each letter is: item, first column, first row (the last column is 10 on, 6 for I). */
const GLYPHS: Record<string, [number, number, number]> = {
  C: [CLASSIC_TEXT, 17, 12],
  S: [CLASSIC_TEXT, 59, 12],
  I: [CLASSIC_TEXT, 88, 12],
  E: [CLASSIC_TEXT, 142, 12],
  R: [CLASSIC_TEXT, 170, 12],
  H: [PUZZLE_TEXT, 35, 5],
  G: [PUZZLE_TEXT, 113, 5],
  O: [EDIT_TEXT, 25, 5],
};
/** Between letters, and a space, as in "CLASSIC TETRIS"; I has a column more on each side. */
const TEXT_GAP = 3;
const TEXT_SPACE = 15;

function statsText(tims: Tim[], text: string): Tim {
  const base = new Pixels(tims[CLASSIC_TEXT]);
  const [left, right] = TEXT_COLUMNS;
  // Clear "CLASSIC TETRIS": each row's background is one colour there.
  for (let y = TEXT_TOP; y < TEXT_TOP + TEXT_ROWS; y++) {
    const bg = base.get(left, y);
    for (let x = left; x <= right; x++) {
      const c = base.colour(x, y);
      if (!TEXT_INK.has(c) && base.get(x, y) !== bg) throw new Error(`stats: the banner's row ${y} is not one colour`);
      base.set(x, y, bg);
    }
  }
  const advance = (ch: string) => (ch === ' ' ? TEXT_SPACE : ch === 'I' ? 9 : 11) + TEXT_GAP;
  const width = [...text].reduce((n, ch) => n + advance(ch), 0) - TEXT_GAP;
  let x = Math.floor((base.w - width) / 2);
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (ch !== ' ') {
      if (!g) throw new Error(`stats: no letter ${ch}`);
      const [item, gx, gy] = g;
      const w = ch === 'I' ? 7 : 11;
      const src = new Pixels(tims[item]);
      // Everything in the cell is the letter or its row's background.
      for (let y = gy; y < gy + TEXT_ROWS; y++)
        for (let sx = gx; sx < gx + w; sx++)
          if (!TEXT_INK.has(src.colour(sx, y)) && src.get(sx, y) !== src.get(left, y)) throw new Error(`stats: letter ${ch} is not clean`);
      paste(src, gx, gx + w - 1, gy, TEXT_ROWS, (c) => TEXT_INK.has(c), base, ch === 'I' ? x + 1 : x, TEXT_TOP);
    }
    x += advance(ch);
  }
  return { flags: base.tim.flags, clut: base.tim.clut, image: base.rect(base.tim.image) };
}

/** The Stats tile's name and banner (items STATS_LABEL and STATS_TEXT), from SELECTE.BIN's images. */
export function statsImages(tims: Tim[]): Tim[] {
  return [statsLabel(tims), statsText(tims, 'HIGH SCORES')];
}
