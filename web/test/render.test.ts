// Pixel-level equality (docs/RESEARCH_AND_PLAN.md §8, layer 3): every movie of the corpus,
// replayed on the core and drawn by the renderer, must give the original's GPU packets (`ot`)
// and the original's frame (`fb`) on every tick (docs/re/renderer.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import { Renderer } from '../src/render/renderer';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { compareMovieAsync, gameForTrace } from './replay';

const ROOT = join(import.meta.dirname, '..', '..');
const PACK = join(ROOT, 'web/public/assets/pazlee.pack');
const movies = readdirSync(join(ROOT, 're/movies'))
  .filter((f) => f.endsWith('.tpm'))
  .map((f) => f.replace(/\.tpm$/, ''))
  .filter((n) => existsSync(join(ROOT, 're/traces', `${n}.jsonl.gz`)));

describe('frames', () => {
  const items = readPack(new Uint8Array(readFileSync(PACK)));
  for (const name of movies) {
    it(name, async () => {
      const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      expect(trace.fields).toContain('fb');
      const result = await compareMovieAsync(movie, trace, { renderer: new Renderer(items) });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(trace.segments.reduce((n, s) => n + s.rows.length, 0));
    }, 300_000);
  }
});

describe('player 2 hidden (approved deviation)', () => {
  it('changes nothing left of player 2 side, and keeps its brick wall', async () => {
    const items = readPack(new Uint8Array(readFileSync(PACK)));
    const movie = loadMovie(join(ROOT, 're/movies/knossos2-lines.tpm'));
    const trace = loadTrace(join(ROOT, 're/traces/knossos2-lines.jsonl.gz'));
    const full = new Renderer(items);
    const hidden = new Renderer(items);
    hidden.hidePlayer2 = true;
    const game = gameForTrace(trace);
    let differ = 0;
    let leftDiffer = 0;
    for (const row of trace.rows) {
      const t = row.t as number;
      game.step(movie.inputs.get(t) ?? 0);
      const b = full.frame(game).buffer;
      hidden.frame(game);
      const a = full.pixels(b);
      const h = hidden.pixels(b);
      for (let y = 0; y < 240; y++) {
        for (let x = 0; x < 156; x++) if (h[y * 320 + x] !== a[y * 320 + x]) leftDiffer++;
        for (let x = 156; x < 320; x++) if (h[y * 320 + x] !== a[y * 320 + x]) differ++;
      }
      // The brick wall stays: every pixel of player 2's side is drawn.
      if (t === 1500) expect(h.subarray(120 * 320 + 170, 120 * 320 + 310).every((p) => p !== 0)).toBe(true);
      if (t % 500 === 0) await new Promise((r) => setImmediate(r));
    }
    expect(leftDiffer).toBe(0);
    expect(differ).toBeGreaterThan(0);
  }, 300_000);
});
