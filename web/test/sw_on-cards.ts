// The cards each SW_ON movie was recorded with (scripts/run-movie.sh TP_MEMCARD1/2), as images
// for src/flow/memcard.ts: null is an empty slot.
import { CARD_SIZE, formattedCard } from '../src/flow/memcard';
import { fullCard } from '../tools/mcd';

export const SWON_CARDS: Record<string, () => (Uint8Array | null)[]> = {
  'sw_on-attract': () => [formattedCard(), null],
  'sw_on-nocard': () => [null, null],
  'sw_on-unformatted': () => [new Uint8Array(CARD_SIZE), null],
  'sw_on-full': () => [fullCard(), null],
};
