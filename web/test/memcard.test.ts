// The memory card (docs/re/memcard.md): the cards the port's Puzzle Mode leaves after a movie
// must be byte-identical to the emulator's (PCSX-Redux's .mcd after the original's run).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { movieCards } from './cards';
import { compareMovie } from './replay';

const ROOT = join(import.meta.dirname, '..', '..');

/** SHA-256 of memcard1.mcd as the original's run left it. */
const CARD_AFTER: Record<string, string> = {
  'card-save': '14edf49bd620578cdddc4c253f0adbacd16bf9e3914ea8a57b06cfcac4f8039b',
};

describe('memory card contents', () => {
  for (const [name, sha] of Object.entries(CARD_AFTER)) {
    it(name, () => {
      const movie = loadMovie(join(ROOT, 're/movies', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      const cards = movieCards(movie);
      const result = compareMovie(movie, trace, { cards });
      expect(result.report).toMatch(/^identical/);
      const image = cards.image(0);
      expect(image).not.toBeNull();
      expect(createHash('sha256').update(image!).digest('hex')).toBe(sha);
    }, 120_000);
  }
});
