// The memory cards a movie runs with ("card SLOT none|blank|PATH", tools/movie.ts), for replays
// of Puzzle Mode movies on the core (docs/re/memcard.md §6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../src/core/addr';
import type { Game } from '../src/core/game';
import { FREAD, formattedCard, MemoryBackend, MemoryCards } from '../src/flow/memcard';
import type { Movie } from '../tools/movie';

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * The movie's cards. A slot the movie doesn't name holds what the emulator's would: a blank
 * formatted card (the oracle's runs use Redux's fresh card in both slots unless told otherwise;
 * the port's default leaves slot 2 empty, which Puzzle Mode only notices when told to use it).
 */
export function movieCards(movie: Movie): MemoryCards {
  const image = (spec: string | undefined) => {
    if (spec === undefined) return formattedCard();
    if (spec === 'none') return null;
    if (spec === 'blank') return formattedCard();
    return new Uint8Array(readFileSync(join(ROOT, spec)));
  };
  return new MemoryCards(new MemoryBackend([image(movie.cards?.[0]), image(movie.cards?.[1])]));
}

/**
 * What SW_ON's card check leaves in the shared state's saved block (state+0x4AD84) when the
 * first card it finds holds an intact save: copy A, or copy B if only B is intact. Replays start
 * from the boot state of a run whose card had no save, so a movie with one gets it here.
 */
export function bootSave(game: Game): void {
  const cards = game.cards;
  for (const name of ['bu00:baslus-00338', 'bu10:baslus-00338']) {
    const fd = cards.open(name, (1 << 16) | FREAD);
    if (fd === -1) continue;
    const data = new Uint8Array(0x2000);
    const n = cards.read(fd, data);
    cards.close(fd);
    if (n !== 0x2000) continue;
    const sum = (a: number) => data.subarray(a, a + 0x780).reduce((x, b) => x ^ b, 0);
    const copy = sum(0x201) === data[0x200] ? 0x201 : sum(0x982) === data[0x981] ? 0x982 : -1;
    if (copy < 0) continue;
    game.m.bytes.set(data.subarray(copy, copy + 0x780), (A.S + 0x4ad84) & 0x1fffff);
    cards.vblanks = 0;
    return;
  }
}
