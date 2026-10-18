// What every program's renderer shares: the GPU model and its VRAM, image uploads from the
// program's pack, and the end of a frame (the ordering table's packets run on the GPU, hashed
// the way the oracle hashes them: `ot` over the packet words, `fb` over the drawn buffer).
// Each mode program sorts its own primitives (its objects_draw differs from program to
// program); Puzzle Mode's is src/render/renderer.ts.
import type { Tim } from '../assets/tim';
import { Gpu, VRAM_WIDTH } from './gpu';
import type { OrderingTable } from './libgs';
import { FNV_BASIS, fnv, hashing, type Frame } from './renderer';

export abstract class FrameRenderer {
  readonly gpu = new Gpu();
  /** Packets of the last frame, in drawing order (for debugging). */
  packets: number[][] = [];

  /** LoadImage of a TIM's pixels and CLUT at their own VRAM positions, moved down `dy` rows. */
  uploadTim(tim: Tim, dy = 0, clutDy = dy): void {
    const { image, clut } = tim;
    this.gpu.loadImage(image.x, image.y + dy, image.w, image.h, image.data);
    if (clut) this.gpu.loadImage(clut.x, clut.y + clutDy, clut.w, clut.h, clut.data);
  }

  /**
   * Runs the table into display buffer `buffer` (0: y 0, 1: y 240) with the libgs drawing
   * offset of a 320x240 GsInitGraph screen, and hashes the result.
   */
  finish(ot: OrderingTable, buffer: number, offset = { x: 160, y: 120 }): Frame {
    const top = 240 * buffer;
    const gpu = this.gpu;
    gpu.setDrawingArea(0, top, 319, top + 239);
    gpu.setDrawingOffset(offset.x, top + offset.y);
    let otHash = FNV_BASIS;
    this.packets = [];
    for (const words of ot.packets()) {
      this.packets.push(words);
      if (hashing.frames) for (const w of words) otHash = fnv(otHash, w | 0);
      gpu.command(words);
    }
    let fb = FNV_BASIS;
    if (hashing.frames) for (let y = top; y < top + 240; y++) {
      const row = y * VRAM_WIDTH;
      for (let x = 0; x < 320; x++) fb = fnv(fb, this.gpu.vram[row + x]);
    }
    return { buffer, ot: otHash, fb };
  }

  /** The 320x240 frame in display buffer `buffer`, as 15-bit pixels. */
  pixels(buffer: number): Uint16Array {
    const out = new Uint16Array(320 * 240);
    for (let y = 0; y < 240; y++) {
      const row = (240 * buffer + y) * VRAM_WIDTH;
      out.set(this.gpu.vram.subarray(row, row + 320), y * 320);
    }
    return out;
  }
}
