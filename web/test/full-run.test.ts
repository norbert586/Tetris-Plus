// A complete run (Phase 9's exit criterion, docs/re/flow.md): re/movies/power/full-run.tpm plays
// the whole game on the original from power-on: the attract programs, the title, the mode
// select, Puzzle Mode (the all-zones password, the hidden stage select, a stage, the end of the
// 100-stage run, the credits, name entry), the ranking screen the game then shows and the story
// intro it returns to. The port must equal the original's trace on every tick of every program:
// the fields, rand() calls, image uploads, sound calls, the program running, and every frame.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import type { Game } from '../src/core/game';
import { formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import type { ProgramName } from '../src/flow/program';
import { FACTORIES, PROGRAMS } from '../src/flow/registry';
import { Renderer } from '../src/render/renderer';
import { loadMovie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { compareFlow, type FlowRenderer } from './flow';

const ROOT = join(import.meta.dirname, '..', '..');
const pack = (name: string) => readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', name))));

describe('a complete run', () => {
  it('full-run: power-on to the ending and back to the attract loop, every tick and frame', () => {
    const movie = loadMovie(join(ROOT, 're/movies/power/full-run.tpm'));
    const trace = loadTrace(join(ROOT, 're/traces/full-run.jsonl.gz'));
    const renderers: Partial<Record<ProgramName, (p: never) => FlowRenderer>> = {};
    for (const [name, mod] of Object.entries(PROGRAMS) as [ProgramName, (typeof PROGRAMS)[ProgramName]][]) {
      const items = pack(mod!.pack);
      // Puzzle Mode drawn in full (player 2's side included), as the original draws it.
      renderers[name] = name === 'PAZLE'
        ? () => { const r = new Renderer(items); return { frame: (p: Game) => r.frame(p) }; }
        : () => mod!.renderer(items);
    }
    const result = compareFlow(movie, trace, {
      factories: FACTORIES,
      renderers: renderers as never,
      cards: new MemoryCards(new MemoryBackend([formattedCard(), null])),
    });
    expect(result.report).toMatch(/^identical/);
    expect(result.ticks).toBe(trace.rows.length);
    // Every program of the run took part.
    expect(new Set(trace.rows.map((r) => r.prog))).toEqual(new Set(['SW_ON', 'TIT_DEMO', 'TITLE', 'SELECT', 'PAZLE', 'RANKING']));
  }, 300_000);
});
