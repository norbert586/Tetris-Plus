// The cards each SW_ON movie was recorded with (scripts/run-movie.sh TP_MEMCARD1/2), as images
// for src/flow/memcard.ts: null is an empty slot.
import { CARD_SIZE, formattedCard } from '../src/flow/memcard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fullCard } from '../tools/mcd';

const card = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, '../../re/movies/cards', name)));

export const SWON_CARDS: Record<string, () => (Uint8Array | null)[]> = {
  'sw_on-attract': () => [formattedCard(), null],
  'sw_on-nocard': () => [null, null],
  'sw_on-unformatted': () => [new Uint8Array(CARD_SIZE), null],
  'sw_on-full': () => [fullCard(), null],
  'sw_on-save': () => [card('saved.mcd'), null],
  'sw_on-save-bad-a': () => [card('saved-bad-a.mcd'), null],
};
