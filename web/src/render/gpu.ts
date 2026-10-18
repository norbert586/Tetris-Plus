// The PlayStation GPU, for the commands Puzzle Mode sends: VRAM uploads, the fill that clears
// a frame, texture-page settings, textured rectangles (sprites), flat-textured quads (scaled or
// flipped sprites) and flat rectangles (box fills), each optionally semi-transparent.
//
// Pixel rules follow PCSX-Redux's software renderer (src/gpu/soft at the build in
// scripts/setup-toolchain.sh), which draws the reference frames the port is compared with:
// 15-bit colour, texel 0x0000 transparent, semi-transparency only where the texel's bit 15 is
// set, the four blend modes, texture modulation by the command colour (128 = unchanged), no
// dithering for flat primitives, and its edge walker for triangles (docs/re/renderer.md).

export const VRAM_WIDTH = 1024;
export const VRAM_HEIGHT = 512;

const sext11 = (v: number): number => ((v & 0x7ff) ^ 0x400) - 0x400;

export class Gpu {
  readonly vram = new Uint16Array(VRAM_WIDTH * VRAM_HEIGHT);
  private readonly vram8 = new Uint8Array(this.vram.buffer);

  // Drawing area (inclusive) and offset.
  drawX = 0;
  drawY = 0;
  drawW = 0;
  drawH = 0;
  offsetX = 0;
  offsetY = 0;

  // Texture page (GP0 E1).
  private texBaseX = 0;
  private texBaseY = 0;
  private texMode = 0; // 0 4-bit CLUT, 1 8-bit CLUT, 2 15-bit direct
  private abr = 0;

  // Per primitive.
  private semi = false;
  private m1 = 128;
  private m2 = 128;
  private m3 = 128;
  private clutP = 0;

  /** LoadImage: copies a rectangle of 16-bit words into VRAM (wrapping at the edges). */
  loadImage(x: number, y: number, w: number, h: number, data: Uint16Array): void {
    for (let row = 0; row < h; row++) {
      const vy = (y + row) & (VRAM_HEIGHT - 1);
      for (let col = 0; col < w; col++) this.vram[vy * VRAM_WIDTH + ((x + col) & (VRAM_WIDTH - 1))] = data[row * w + col];
    }
  }

  setDrawingArea(x0: number, y0: number, x1: number, y1: number): void {
    this.drawX = x0;
    this.drawY = y0;
    this.drawW = x1;
    this.drawH = y1;
  }

  setDrawingOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /** Runs one packet's GP0 words. */
  command(words: ArrayLike<number>): void {
    let i = 0;
    while (i < words.length) {
      const w = words[i] >>> 0;
      const op = w >>> 24;
      if (op === 0x00) {
        i++;
      } else if (op === 0x02) {
        this.fill(w, words[i + 1], words[i + 2]);
        i += 3;
      } else if (op === 0xe1) {
        this.texturePage(w);
        i++;
      } else if (op >= 0xe2 && op <= 0xe6) {
        if ((w & 0xffffff) !== 0 && op !== 0xe3 && op !== 0xe4 && op !== 0xe5) throw new Error(`GP0 ${w.toString(16)} not supported`);
        if (op === 0xe3) this.setDrawingArea(w & 0x3ff, (w >> 10) & 0x1ff, this.drawW, this.drawH);
        if (op === 0xe4) this.setDrawingArea(this.drawX, this.drawY, w & 0x3ff, (w >> 10) & 0x1ff);
        if (op === 0xe5) this.setDrawingOffset(sext11(w), sext11(w >> 11));
        i++;
      } else if ((op & 0xe0) === 0x60) {
        i = this.rect(words, i);
      } else if ((op & 0xfc) === 0x2c) {
        this.polyFT4(words, i);
        i += 9;
      } else {
        throw new Error(`GP0 command ${w.toString(16)} not supported`);
      }
    }
  }

  private texturePage(w: number): void {
    this.texBaseX = (w & 0xf) << 6;
    this.texBaseY = ((w >> 4) & 1) << 8;
    this.abr = (w >> 5) & 3;
    this.texMode = (w >> 7) & 3;
  }

  /** GP0 02: fill, ignoring the drawing area and offset; width rounded up to 16. */
  private fill(w0: number, xy: number, wh: number): void {
    const x0 = xy & 0x3f0;
    const y0 = (xy >>> 16) & 0x1ff;
    let w = ((wh & 0x3ff) + 15) & ~15;
    let h = (wh >>> 16) & 0x1ff;
    if (h >= 1023) h = 1024;
    if (w >= 1023) w = 1024;
    const col = fromCommandColor(w0);
    const x1 = Math.min(x0 + w, VRAM_WIDTH);
    const y1 = Math.min(y0 + h, VRAM_HEIGHT);
    for (let y = y0; y < y1; y++) this.vram.fill(col, y * VRAM_WIDTH + x0, y * VRAM_WIDTH + x1);
  }

  private modulation(w0: number): void {
    if (w0 & 0x01000000) {
      this.m1 = this.m2 = this.m3 = 128;
    } else {
      this.m1 = w0 & 0xff;
      this.m2 = (w0 >> 8) & 0xff;
      this.m3 = (w0 >> 16) & 0xff;
    }
  }

  private rect(words: ArrayLike<number>, i: number): number {
    const w0 = words[i] >>> 0;
    const op = w0 >>> 24;
    const textured = (op & 4) !== 0;
    const xy = words[i + 1];
    let j = i + 2;
    let uv = 0;
    if (textured) uv = words[j++];
    let w: number;
    let h: number;
    switch ((op >> 3) & 3) {
      case 0: {
        const wh = words[j++];
        w = wh & 0x3ff;
        h = (wh >>> 16) & 0x1ff;
        if (w === 0 || h === 0) return j;
        break;
      }
      case 1:
        w = h = 1;
        break;
      case 2:
        w = h = 8;
        break;
      default:
        w = h = 16;
    }
    this.semi = (op & 2) !== 0;
    this.modulation(w0);
    const x0 = ((sext11(xy) + this.offsetX) << 16) >> 16;
    const y0 = ((sext11(xy >>> 16) + this.offsetY) << 16) >> 16;
    if (textured) {
      this.setClut(uv >>> 16);
      this.drawSprite(x0, y0, w, h, uv & 0xff, (uv >> 8) & 0xff);
    } else {
      this.drawRect(x0, y0, x0 + w, y0 + h, fromCommandColor(w0));
    }
    return j;
  }

  private setClut(c: number): void {
    this.clutP = ((c >> 6) & 0x1ff) * VRAM_WIDTH + (c & 0x3f) * 16;
  }

  private sample(u: number, v: number): number {
    const fx = u & 0xff;
    const fy = v & 0xff;
    if (this.texMode === 0) {
      const raw = this.vram8[((fy + this.texBaseY) << 11) + (this.texBaseX << 1) + (fx >> 1)];
      return this.vram[this.clutP + ((raw >> ((fx & 1) << 2)) & 0xf)];
    }
    if (this.texMode === 1) {
      return this.vram[this.clutP + this.vram8[((fy + this.texBaseY) << 11) + (this.texBaseX << 1) + fx]];
    }
    return this.vram[fx + this.texBaseX + ((fy + this.texBaseY) << 10)];
  }

  /** A textured pixel: transparent if 0, modulated, blended if semi-transparent and bit 15 set. */
  private texel(x: number, y: number, color: number): void {
    if (color === 0) return;
    const at = (y << 10) + x;
    let r = ((color & 0x1f) * this.m1) >> 7;
    let b = ((color & 0x3e0) * this.m2) >> 7;
    let g = ((color & 0x7c00) * this.m3) >> 7;
    if (this.semi && color & 0x8000) {
      const d = this.vram[at];
      switch (this.abr) {
        case 0:
          r = ((d & 0x1f) + r) >> 1;
          b = (((d >> 5) & 0x1f) + (b >> 5)) >> 1 << 5;
          g = (((d >> 10) & 0x1f) + (g >> 10)) >> 1 << 10;
          break;
        case 1:
          r += d & 0x1f;
          b += d & 0x3e0;
          g += d & 0x7c00;
          break;
        case 2:
          r = Math.max(0, (d & 0x1f) - r);
          b = Math.max(0, (d & 0x3e0) - b);
          g = Math.max(0, (d & 0x7c00) - g);
          break;
        default:
          r = (d & 0x1f) + ((((color & 0x1f) >> 2) * this.m1) >> 7);
          b = (d & 0x3e0) + ((((color & 0x3e0) >> 2) * this.m2) >> 7);
          g = (d & 0x7c00) + ((((color & 0x7c00) >> 2) * this.m3) >> 7);
      }
    }
    if (r & ~0x1f) r = 0x1f;
    if (b & ~0x3ff) b = 0x3e0;
    if (g & ~0x7fff) g = 0x7c00;
    this.vram[at] = (g & 0x7c00) | (b & 0x3e0) | (r & 0x1f) | (color & 0x8000);
  }

  /** A flat (untextured) pixel. */
  private flat(x: number, y: number, color: number): void {
    const at = (y << 10) + x;
    if (!this.semi) {
      this.vram[at] = color;
      return;
    }
    const d = this.vram[at];
    let r: number;
    let b: number;
    let g: number;
    switch (this.abr) {
      case 0:
        r = ((d & 0x1f) + (color & 0x1f)) >> 1;
        b = (((d >> 5) & 0x1f) + ((color >> 5) & 0x1f)) >> 1 << 5;
        g = (((d >> 10) & 0x1f) + ((color >> 10) & 0x1f)) >> 1 << 10;
        break;
      case 1:
        r = (d & 0x1f) + (color & 0x1f);
        b = (d & 0x3e0) + (color & 0x3e0);
        g = (d & 0x7c00) + (color & 0x7c00);
        break;
      case 2:
        r = Math.max(0, (d & 0x1f) - (color & 0x1f));
        b = Math.max(0, (d & 0x3e0) - (color & 0x3e0));
        g = Math.max(0, (d & 0x7c00) - (color & 0x7c00));
        break;
      default:
        r = (d & 0x1f) + ((color & 0x1f) >> 2);
        b = (d & 0x3e0) + ((color & 0x3e0) >> 2);
        g = (d & 0x7c00) + ((color & 0x7c00) >> 2);
    }
    if (r & ~0x1f) r = 0x1f;
    if (b & ~0x3ff) b = 0x3e0;
    if (g & ~0x7fff) g = 0x7c00;
    this.vram[at] = (g & 0x7c00) | (b & 0x3e0) | (r & 0x1f);
  }

  /** Flat rectangle, x1/y1 exclusive (SoftRenderer::drawRect). */
  private drawRect(x0: number, y0: number, x1: number, y1: number, color: number): void {
    if (y0 > y1 || x0 > x1) return;
    if (x1 < this.drawX || y1 < this.drawY || x0 > this.drawW || y0 > this.drawH) return;
    x1 = Math.min(x1, this.drawW + 1);
    y1 = Math.min(y1, this.drawH + 1);
    x0 = Math.max(x0, this.drawX);
    y0 = Math.max(y0, this.drawY);
    if (y0 >= VRAM_HEIGHT || x0 >= VRAM_WIDTH) return;
    y1 = Math.min(y1, VRAM_HEIGHT);
    x1 = Math.min(x1, VRAM_WIDTH);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.flat(x, y, color);
  }

  /** Textured rectangle (SoftRenderer::drawSprite). */
  private drawSprite(x: number, y: number, w: number, h: number, u: number, v: number): void {
    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;
    if (x0 < this.drawX) {
      u += this.drawX - x0;
      x0 = this.drawX;
    }
    if (y0 < this.drawY) {
      v += this.drawY - y0;
      y0 = this.drawY;
    }
    x1 = Math.min(x1, this.drawW + 1);
    y1 = Math.min(y1, this.drawH + 1);
    if (x0 >= x1 || y0 >= y1) return;
    for (let row = y0; row < y1; row++) {
      const tv = v + row - y0;
      for (let col = x0; col < x1; col++) this.texel(col, row, this.sample(u + col - x0, tv));
    }
  }

  /** GP0 2C-2F: flat-textured quad, drawn as triangles (1, 3, 2) then (0, 1, 2). */
  private polyFT4(words: ArrayLike<number>, i: number): void {
    const w0 = words[i] >>> 0;
    const xs: number[] = [];
    const ys: number[] = [];
    const us: number[] = [];
    const vs: number[] = [];
    for (let k = 0; k < 4; k++) {
      const xy = words[i + 1 + 2 * k];
      const uv = words[i + 2 + 2 * k];
      xs.push(sext11(xy));
      ys.push(sext11(xy >>> 16));
      us.push(uv & 0xff);
      vs.push((uv >> 8) & 0xff);
    }
    const over = (a: number, b: number) => Math.abs(xs[a] - xs[b]) >= 1024 || Math.abs(ys[a] - ys[b]) >= 512;
    if (over(0, 1) || over(1, 3) || over(3, 2) || over(2, 0) || over(1, 2)) return;
    for (let k = 0; k < 4; k++) {
      xs[k] = sext11(xs[k] + this.offsetX);
      ys[k] = sext11(ys[k] + this.offsetY);
    }
    this.semi = (w0 & 0x02000000) !== 0;
    this.modulation(w0);
    this.setClut(words[i + 2] >>> 16);
    this.texturePage(0xe1000000 | ((words[i + 4] >>> 16) & 0x1ff));
    this.triangle([xs[1], xs[3], xs[2]], [ys[1], ys[3], ys[2]], [us[1], us[3], us[2]], [vs[1], vs[3], vs[2]]);
    this.triangle([xs[0], xs[1], xs[2]], [ys[0], ys[1], ys[2]], [us[0], us[1], us[2]], [vs[0], vs[1], vs[2]]);
  }

  /** A flat-textured triangle: SoftRenderer::drawPoly3Raster<true, Flat>. */
  private triangle(x: number[], y: number[], u: number[], v: number[]): void {
    const { drawX, drawY, drawW, drawH } = this;
    if (drawY >= drawH || drawX >= drawW) return;
    if (x.every((a) => a > drawW) || y.every((a) => a > drawH) || x.every((a) => a < drawX) || y.every((a) => a < drawY)) return;

    type V = { x: number; y: number; u: number; v: number };
    let v1: V = { x: x[0] * 65536, y: y[0], u: u[0] * 65536, v: v[0] * 65536 };
    let v2: V = { x: x[1] * 65536, y: y[1], u: u[1] * 65536, v: v[1] * 65536 };
    let v3: V = { x: x[2] * 65536, y: y[2], u: u[2] * 65536, v: v[2] * 65536 };
    if (v1.y > v2.y) [v1, v2] = [v2, v1];
    if (v1.y > v3.y) [v1, v3] = [v3, v1];
    if (v2.y > v3.y) [v2, v3] = [v3, v2];
    const height = v3.y - v1.y;
    if (height === 0) return;
    const temp = Math.trunc(((v2.y - v1.y) * 65536) / height);
    let longest = temp * ((v3.x - v1.x) >> 16) + (v1.x - v2.x);
    if (longest === 0) return;

    // Edge sections: arrays walked from the top vertex down.
    let left: V[];
    let right: V[];
    let ls: number;
    let rs: number;
    let leftX = 0;
    let leftU = 0;
    let leftV = 0;
    let rightX = 0;
    let lStartX = 0;
    let lDiffX = 0;
    let lStartU = 0;
    let lDiffU = 0;
    let lStartV = 0;
    let lDiffV = 0;
    let lFull = 0;
    let lLeft = 0;
    let rStartX = 0;
    let rDiffX = 0;
    let rFull = 0;
    let rLeft = 0;
    const leftSection = (): number => {
      const a = left[ls];
      const b = left[ls - 1];
      const h = b.y - a.y;
      if (h === 0) return 0;
      lStartX = leftX = a.x;
      lDiffX = b.x - a.x;
      lStartU = leftU = a.u;
      lDiffU = b.u - a.u;
      lStartV = leftV = a.v;
      lDiffV = b.v - a.v;
      lFull = lLeft = h;
      return h;
    };
    const rightSection = (): number => {
      const a = right[rs];
      const b = right[rs - 1];
      const h = b.y - a.y;
      if (h === 0) return 0;
      rStartX = rightX = a.x;
      rDiffX = b.x - a.x;
      rFull = rLeft = h;
      return h;
    };
    /** Advances one row; true at the bottom. */
    const nextRow = (): boolean => {
      if (--lLeft <= 0) {
        if (--ls <= 0) return true;
        if (leftSection() <= 0) return true;
      } else {
        const row = lFull - lLeft;
        leftX = lStartX + Math.trunc((lDiffX * row) / lFull);
        leftU = lStartU + row * Math.trunc(lDiffU / lFull);
        leftV = lStartV + row * Math.trunc(lDiffV / lFull);
      }
      if (--rLeft <= 0) {
        if (--rs <= 0) return true;
        if (rightSection() <= 0) return true;
      } else {
        const row = rFull - rLeft;
        rightX = rStartX + Math.trunc((rDiffX * row) / rFull);
      }
      return false;
    };

    if (longest < 0) {
      right = [v3, v2, v1];
      rs = 2;
      left = [v3, v1];
      ls = 1;
      if (leftSection() <= 0) return;
      if (rightSection() <= 0) {
        rs--;
        if (rightSection() <= 0) return;
      }
      if (longest > -0x1000) longest = -0x1000;
    } else {
      left = [v3, v2, v1];
      ls = 2;
      right = [v3, v1];
      rs = 1;
      if (rightSection() <= 0) return;
      if (leftSection() <= 0) {
        ls--;
        if (leftSection() <= 0) return;
      }
      if (longest < 0x1000) longest = 0x1000;
    }
    const shl10idiv = (a: number, b: number) => Math.trunc((a * 1024) / b);
    const difX = shl10idiv(temp * ((v3.u - v1.u) >> 10) + ((v1.u - v2.u) << 6), longest);
    const difY = shl10idiv(temp * ((v3.v - v1.v) >> 10) + ((v1.v - v2.v) << 6), longest);
    const ymax = Math.min(v3.y - 1, drawH);
    let ymin = v1.y;
    for (; ymin < drawY; ymin++) if (nextRow()) return;

    for (let row = ymin; row <= ymax; row++) {
      let xmin = Math.floor((leftX + 0xffff) / 65536);
      let xmax = Math.floor((rightX - 1) / 65536);
      if (drawW < xmax) xmax = drawW;
      if (xmax >= xmin) {
        const seed = (leftVal: number, dif: number) => leftVal + Math.floor(((xmin * 65536 - leftX) * dif) / 65536) + 0x8000;
        let posX = seed(leftU, difX);
        let posY = seed(leftV, difY);
        if (xmin < drawX) {
          posX += (drawX - xmin) * difX;
          posY += (drawX - xmin) * difY;
          xmin = drawX;
        }
        for (let col = xmin; col <= xmax; col++) {
          this.texel(col, row, this.sample(posX >> 16, posY >> 16));
          posX += difX;
          posY += difY;
        }
      }
      if (nextRow()) return;
    }
  }
}

/** A command colour (r, g, b bytes) as a 15-bit pixel. */
export function fromCommandColor(rgb: number): number {
  return ((rgb & 0xf80000) >> 9) | ((rgb & 0xf800) >> 6) | ((rgb & 0xf8) >> 3);
}
