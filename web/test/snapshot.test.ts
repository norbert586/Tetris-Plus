// Saved games (src/flow/snapshot.ts): a game saved on Puzzle Mode's pause screen and resumed
// must carry on exactly as the game that was never saved, on every later tick: the RAM, the
// program running, its sound calls and image uploads, and every frame's GPU packets and pixels,
// across the programs that follow. The reference runs are corpus movies the port replays
// identically to the original (full-run through the whole game; pause-retire in Puzzle Mode).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPack } from '../src/assets/pack';
import type { Game } from '../src/core/game';
import type { Mem } from '../src/core/mem';
import { Console } from '../src/flow/console';
import { formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import type { Program, ProgramName, ProgramRenderer } from '../src/flow/program';
import { FACTORIES, PROGRAMS } from '../src/flow/registry';
import { canSave, describeSnapshot, isSnapshot, takeSnapshot, type Snapshot } from '../src/flow/snapshot';
import { Renderer } from '../src/render/renderer';
import { loadMovie, type Movie } from '../tools/movie';
import { loadTrace } from '../tools/trace';
import { gameForTrace } from './replay';

const ROOT = join(import.meta.dirname, '..', '..');
const packs = new Map<string, Uint8Array[]>();
function pack(name: string): Uint8Array[] {
  if (!packs.has(name)) packs.set(name, readPack(new Uint8Array(readFileSync(join(ROOT, 'web/public/assets', name)))));
  return packs.get(name)!;
}

/** A renderer for a program, as the shell makes it (Puzzle Mode's with player 2 hidden). */
function rendererFor(p: Program): ProgramRenderer {
  const mod = PROGRAMS[p.name as ProgramName]!;
  return mod.renderer(pack(mod.pack));
}

function poke(m: Mem, movie: Movie, t: number): void {
  for (const p of movie.pokes.get(t) ?? []) {
    if (p.size === 4) m.w32(p.address, p.value);
    else if (p.size === 2) m.w16(p.address, p.value);
    else m.w8(p.address, p.value);
  }
}

/** A Console and its renderer, stepped through a movie as compareFlow does (seeds, pokes). */
class Run {
  renderer: ProgramRenderer;
  rendererFor: Program;
  frame = { buffer: 0, ot: 0, fb: 0 };

  constructor(readonly c: Console, renderer?: ProgramRenderer) {
    this.renderer = renderer ?? rendererFor(c.program);
    this.rendererFor = c.program;
  }

  step(movie: Movie, t: number, seed?: number): void {
    const c = this.c;
    if (c.program.exited) c.startNext(seed);
    c.step(movie.inputs.get(t) ?? 0);
    if (c.program !== this.rendererFor) {
      this.renderer = rendererFor(c.program);
      this.rendererFor = c.program;
    }
    this.frame = this.renderer.frame(c.program);
    poke(c.m, movie, t);
  }
}

/** A Console resumed from a save (what the shell does), with its Puzzle Mode renderer. */
function resume(s: Snapshot, card: Uint8Array | null): Run {
  const c = new Console(FACTORIES, {
    ram: s.ram,
    seed: s.seed,
    resume: { program: s.program, tick: s.tick },
    cards: new MemoryCards(new MemoryBackend([card, null])),
  });
  const r = rendererFor(c.program);
  r.vram!.set(s.vram);
  return new Run(c, r);
}

function sameRam(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

/** What the comparison reads from the run that was never saved, after each tick. */
interface Reference {
  program: Program;
  m: Mem;
  frame: { buffer: number; ot: number; fb: number };
  pixels(): Uint16Array;
}

/** The first difference between the reference and the resumed run after tick t, or null. */
function difference(t: number, a: Reference, b: Run): string | null {
  const pa = a.program;
  const pb = b.c.program;
  if (pa.name !== pb.name) return `tick ${t}: ${pa.name} != ${pb.name}`;
  if (pa.tick !== pb.tick) return `tick ${t}: program tick ${pa.tick} != ${pb.tick}`;
  if (!sameRam(a.m.bytes, b.c.m.bytes)) return `tick ${t}: RAM differs`;
  if (JSON.stringify(pa.sound) !== JSON.stringify(pb.sound)) return `tick ${t}: sound calls differ`;
  if (JSON.stringify(pa.uploads) !== JSON.stringify(pb.uploads)) return `tick ${t}: uploads differ`;
  // fb hashes the whole drawn frame; the pixels themselves are compared at the end.
  if (a.frame.ot !== b.frame.ot || a.frame.fb !== b.frame.fb) return `tick ${t}: frame differs`;
  return null;
}

function samePixels(a: Reference, b: Run): boolean {
  const pixels = b.renderer.pixels(b.frame.buffer);
  return a.pixels().every((v, i) => v === pixels[i]);
}

/** Gives the event loop a turn now and then (long runs in a test worker). */
const breathe = () => new Promise((resolve) => setImmediate(resolve));

describe('saved games', () => {
  it('full-run: saved on the pause screen and resumed, the rest of the run (Puzzle Mode, RANKING, TIT_DEMO) is the same', async () => {
    const movie = loadMovie(join(ROOT, 're/movies/power/full-run.tpm'));
    const trace = loadTrace(join(ROOT, 're/traces/full-run.jsonl.gz'));
    const first = trace.rows[0];
    const original = new Run(new Console(FACTORIES, {
      first: first.prog as ProgramName,
      seed: first.mainseed as number,
      cards: new MemoryCards(new MemoryBackend([formattedCard(), null])),
    }));
    const ticks = trace.rows.map((r) => r.t as number);
    const seeds = new Map(trace.rows.map((r) => [r.t as number, r.mainseed as number | undefined]));
    let i = 0;
    // Up to a few ticks into the pause screen the movie opens with Start.
    for (; i < ticks.length && !(canSave(original.c) && ticks[i - 1] > 3360); i++) {
      original.step(movie, ticks[i], seeds.get(ticks[i]));
      if (i % 1000 === 0) await breathe();
    }
    expect(canSave(original.c)).toBe(true);
    // Stored as IndexedDB stores it.
    const saved = structuredClone(takeSnapshot(original.c, original.renderer.vram!, 0));
    expect(isSnapshot(saved)).toBe(true);
    const resumed = resume(saved, original.c.shared.cards!.image(0));
    expect(canSave(resumed.c)).toBe(true);
    const reference: Reference = {
      get program() { return original.c.program; },
      get m() { return original.c.m; },
      get frame() { return original.frame; },
      pixels: () => original.renderer.pixels(original.frame.buffer),
    };
    for (; i < ticks.length; i++) {
      const t = ticks[i];
      original.step(movie, t, seeds.get(t));
      resumed.step(movie, t, seeds.get(t));
      const d = difference(t, reference, resumed);
      if (d) expect.fail(d);
      if (i % 1000 === 0) await breathe();
    }
    expect(samePixels(reference, resumed)).toBe(true);
    // The run went on through the programs after Puzzle Mode (TIT_DEMO starts itself again).
    expect(resumed.c.started).toEqual(['PAZLE', 'RANKING', 'TIT_DEMO', 'TIT_DEMO']);
  }, 300_000);

  // The movie's two pauses (ticks 3100-3129 and 5200-5229): their first and last ticks.
  for (const at of [3100, 3129, 5200, 5229]) {
    it(`pause-retire: saved on the pause screen at tick ${at}, the rest of Puzzle Mode is the same`, async () => {
      const movie = loadMovie(join(ROOT, 're/movies/pause-retire.tpm'));
      const trace = loadTrace(join(ROOT, 're/traces/pause-retire.jsonl.gz'));
      // The reference: Puzzle Mode on its own, as the golden-trace replay runs it.
      const game = gameForTrace(trace);
      const r = new Renderer(pack('pazlee.pack'));
      r.hidePlayer2 = true;
      let frame = { buffer: 0, ot: 0, fb: 0 };
      const step = (t: number) => {
        game.step(movie.inputs.get(t) ?? 0);
        frame = r.frame(game);
        poke(game.m, movie, t);
      };
      for (let t = 1; t <= at; t++) step(t);
      // Saved from a Console carrying on from the reference's RAM, as the shell holds the game.
      const holder = new Console(FACTORIES, { ram: game.m.bytes, seed: game.rng.seed, resume: { program: 'PAZLE', tick: game.tick } });
      expect(canSave(holder)).toBe(true);
      const resumed = resume(structuredClone(takeSnapshot(holder, r.gpu.vram, 0)), formattedCard());
      const reference: Reference = {
        program: game as Game & Program,
        m: game.m,
        get frame() { return frame; },
        pixels: () => r.pixels(frame.buffer),
      };
      let t = at;
      // To the movie's end or Puzzle Mode's exit (the reference has no programs after it).
      while (t < movie.last && !game.exited) {
        t++;
        step(t);
        resumed.step(movie, t);
        const d = difference(t, reference, resumed);
        if (d) expect.fail(d);
        if (t % 1000 === 0) await breathe();
      }
      expect(samePixels(reference, resumed)).toBe(true);
      expect(t - at).toBeGreaterThan(100);
    }, 120_000);
  }

  it('only on the pause screen; other programs and other screens are refused', () => {
    const c = new Console(FACTORIES, { first: 'SELECT' });
    c.step(0);
    expect(canSave(c)).toBe(false);
    expect(() => takeSnapshot(c, new Uint16Array(1024 * 512))).toThrow();
    // A program that can't resume refuses.
    expect(() => new Console(FACTORIES, { ram: new Uint8Array(0x200000), resume: { program: 'SELECT', tick: 5 } })).toThrow(/can't resume/);
  });

  it('describes where it was saved; refuses other versions and broken data', () => {
    const base = { version: 1, program: 'PAZLE' as const, tick: 10, seed: 1, ram: new Uint8Array(0x200000), vram: new Uint16Array(1024 * 512), savedAt: 0 };
    expect(describeSnapshot({ ...base, zone: 0, stage: 2, hundred: false })).toBe('Egypt, stage 3');
    expect(describeSnapshot({ ...base, zone: 3, stage: 19, hundred: false })).toBe('Knossos, stage 20');
    expect(describeSnapshot({ ...base, zone: 2, stage: 0, hundred: true })).toBe('Stage 41 of 100');
    expect(isSnapshot({ ...base, zone: 0, stage: 0, hundred: false })).toBe(true);
    expect(isSnapshot({ ...base, version: 2, zone: 0, stage: 0, hundred: false })).toBe(false);
    expect(isSnapshot({ ...base, ram: new Uint8Array(10), zone: 0, stage: 0, hundred: false })).toBe(false);
    expect(isSnapshot(undefined)).toBe(false);
  });
});
