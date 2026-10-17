// Golden-trace equality (docs/RESEARCH_AND_PLAN.md §8, layer 2): every movie of the corpus,
// replayed on the core, must equal the original's trace on every tick and field.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { compareMovie } from './replay';

const ROOT = join(import.meta.dirname, '..', '..');
const movies = readdirSync(join(ROOT, 're/movies'))
  .filter((f) => f.endsWith('.tpm'))
  .map((f) => f.replace(/\.tpm$/, ''))
  .filter((n) => existsSync(join(ROOT, 're/traces', `${n}.jsonl.gz`)));

describe('golden traces', () => {
  it('has a corpus', () => expect(movies.length).toBeGreaterThan(0));
  for (const name of movies) {
    it(name, () => {
      const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      const result = compareMovie(movie, trace);
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(trace.rows.length);
    }, 120_000);
  }
});
