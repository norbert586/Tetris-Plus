// Memory card images (.mcd, 128 KB) for movies and tests (docs/re/memcard.md), made with the
// port's card (src/flow/memcard.ts):
//   npx tsx tools/mcd.ts blank OUT.mcd            a formatted card with no files
//   npx tsx tools/mcd.ts unformatted OUT.mcd      all zero bytes
//   npx tsx tools/mcd.ts full OUT.mcd [N]         N (default 15) one-block files of another game
//   npx tsx tools/mcd.ts ls CARD.mcd              the directory
import { readFileSync, writeFileSync } from 'node:fs';
import { FCREAT, FWRITE, MemoryBackend, MemoryCards, CARD_SIZE, formattedCard } from '../src/flow/memcard';

/** A card with `n` one-block dummy files named BESLES-000NN (8 KB of 0x5A each). */
export function fullCard(n = 15): Uint8Array {
  const cards = new MemoryCards(new MemoryBackend([formattedCard(), null]));
  for (let i = 0; i < n; i++) {
    const name = `bu00:BESLES-000${String(i).padStart(2, '0')}`;
    const fd = cards.open(name, (1 << 16) | FCREAT);
    cards.close(fd);
    const w = cards.open(name, FWRITE);
    cards.write(w, new Uint8Array(0x2000).fill(0x5a));
    cards.close(w);
  }
  return cards.image(0)!;
}

function main(): void {
  const [cmd, path, arg] = process.argv.slice(2);
  if (cmd === 'blank') writeFileSync(path, formattedCard());
  else if (cmd === 'unformatted') writeFileSync(path, new Uint8Array(CARD_SIZE));
  else if (cmd === 'full') writeFileSync(path, fullCard(arg ? Number(arg) : 15));
  else if (cmd === 'ls') {
    const cards = new MemoryCards(new MemoryBackend([new Uint8Array(readFileSync(path)), null]));
    for (let e = cards.firstfile('bu00:*'); e; e = cards.nextfile()) console.log(e.name, e.size);
    console.log('free blocks', cards.freeBlocks(0));
  } else {
    console.error('usage: mcd.ts blank|unformatted|full|ls FILE [N]');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
