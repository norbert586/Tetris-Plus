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
import { compareMovieAsync } from './replay';

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
      expect(result.ticks).toBe(trace.rows.length);
    }, 300_000);
  }
});
