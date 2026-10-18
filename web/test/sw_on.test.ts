// SW_ON.EXE from power-on (docs/re/sw_on.md): trace and frame equality with the original on
// movies recorded with the card configurations they name (re/movies/power/sw_on-*.tpm).
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

describe('SW_ON', () => {
  for (const [name, cards] of Object.entries(SWON_CARDS)) {
    it(name, () => {
      const movie = loadMovie(join(ROOT, 're/movies/power', `${name}.tpm`));
      const trace = loadTrace(join(ROOT, 're/traces', `${name}.jsonl.gz`));
      const result = compareFlow(movie, trace, {
        factories: { SW_ON: SW_ON.create },
        renderers: {
          SW_ON: () => {
            const r = SW_ON.renderer(items);
            return { frame: (p: Program) => { const f = r.frame(p); return { ot: f.ot, fb: f.fb }; } };
          },
        },
        cards: new MemoryCards(new MemoryBackend(cards())),
        onlyFirst: true,
      });
      expect(result.report).toMatch(/^identical/);
      expect(result.ticks).toBe(trace.rows.filter((r) => r.prog === 'SW_ON').length);
    }, 60_000);
  }
});
