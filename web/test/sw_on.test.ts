// SW_ON.EXE from power-on (docs/re/sw_on.md): trace and frame equality with the original on
// movies recorded with the card configurations they name (re/movies/power/sw_on-*.tpm).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import { MemoryBackend, MemoryCards } from '../src/flow/memcard';
import type { Program } from '../src/flow/program';
import { SW_ON } from '../src/programs/sw_on';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { compareFlow } from './flow';
import { SWON_CARDS } from './sw_on-cards';

const ROOT = join(import.meta.dirname, '..', '..');
const items = readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets/sw_one.pack'))));

/** SHA-256 of memcard1.mcd as the original's run left it, where SW_ON writes to the card. */
const CARD_AFTER: Record<string, string> = {
  // formatted by the "initialize?" screen
  'sw_on-unformatted': 'a2bb81e893ea88f0c7c3e932c0c68b22f53cb9cf945c3dcb667136b82ce83eed',
};

describe('SW_ON', () => {
  for (const [name, cards] of Object.entries(SWON_CARDS)) {
    it(name, () => {
      const movie = loadMovie(join(ROOT, 're/movies/power', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      const memcards = new MemoryCards(new MemoryBackend(cards()));
      const result = compareFlow(movie, trace, {
        factories: { SW_ON: SW_ON.create },
        renderers: {
          SW_ON: () => {
            const r = SW_ON.renderer(items);
            return { frame: (p: Program) => { const f = r.frame(p); return { ot: f.ot, fb: f.fb }; } };
          },
        },
        cards: memcards,
        onlyFirst: true,
      });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(trace.rows.filter((r) => r.prog === 'SW_ON').length);
      const image = memcards.image(0);
      if (CARD_AFTER[name]) expect(createHash('sha256').update(image!).digest('hex')).toBe(CARD_AFTER[name]);
    }, 60_000);
  }
});
