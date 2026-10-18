// Reads input movies (.tpm version 1, docs/re/oracle-harness.md §2): the PadRead word for each
// logic tick, pad 1 in the low half and pad 2 in the high half.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { BUTTONS } from '../src/core/pad';

export interface Movie {
  name: string;
  boot: string;
  last: number;
  /** inputs[t] = the pad word the logic sees on tick t (0 when absent). */
  inputs: Map<number, number>;
  /** pokes[t] = memory writes made right after tick t is recorded (scenario set-up). */
  pokes: Map<number, Poke[]>;
  /**
   * The memory cards the movie runs with ("card SLOT none|blank|PATH", slot 1 or 2; PATH from
   * the repository root): index 0 slot 1. Absent: the emulator's default (a blank formatted card).
   */
  cards?: (string | undefined)[];
}

export interface Poke {
  address: number;
  value: number;
  size: 1 | 2 | 4;
}

export function parseMovie(text: string, name = 'movie'): Movie {
  const movie: Movie = { name, boot: 'puzzle', last: -1, inputs: new Map(), pokes: new Map() };
  let version = 0;
  let last = 0;
  text.split('\n').forEach((raw, i) => {
    const where = `${name}:${i + 1}`;
    const words = raw.replace(/#.*$/, '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    if (words[0] === 'tpm') {
      if (words[1] !== '1') throw new Error(`${where}: unsupported movie version`);
      version = 1;
    } else if (words[0] === 'boot') {
      movie.boot = words[1];
    } else if (words[0] === 'end') {
      movie.last = Number(words[1]);
    } else if (words[0] === 'mark') {
      // annotation only
    } else if (words[0] === 'card') {
      const slot = Number(words[1]);
      if ((slot !== 1 && slot !== 2) || !words[2]) throw new Error(`${where}: expected card 1|2 none|blank|PATH`);
      movie.cards ??= [];
      movie.cards[slot - 1] = words[2];
    } else if (words[0] === 'poke') {
      const [t, address, value] = [Number(words[1]), Number(words[2]), Number(words[3])];
      const size = Number(words[4] ?? '4');
      if (!Number.isInteger(t) || !Number.isInteger(address) || !Number.isInteger(value) || ![1, 2, 4].includes(size)) {
        throw new Error(`${where}: expected poke TICK ADDRESS VALUE [1|2|4]`);
      }
      const list = movie.pokes.get(t) ?? [];
      list.push({ address, value, size: size as 1 | 2 | 4 });
      movie.pokes.set(t, list);
    } else {
      const at = words[0];
      const t = at.startsWith('+') ? last + Number(at.slice(1)) : Number(at);
      const hold = Number(words[1]);
      if (!Number.isInteger(t) || !Number.isInteger(hold) || !words[2]) {
        throw new Error(`${where}: expected TICK HOLD BUTTONS`);
      }
      if (t < last) throw new Error(`${where}: events must be in tick order`);
      if (t < 2) throw new Error(`${where}: the first tick with input is 2`);
      let names = words[2];
      let player = 0;
      const m = /^(\d):/.exec(names);
      if (m) {
        player = Number(m[1]) - 1;
        names = names.slice(2);
      }
      if (player < 0 || player > 1) throw new Error(`${where}: pad must be 1 or 2`);
      let mask = 0;
      for (const b of names.split('+')) {
        const bit = BUTTONS[b];
        if (bit === undefined) throw new Error(`${where}: unknown button ${b}`);
        mask |= bit;
      }
      mask = (mask << (16 * player)) >>> 0;
      for (let k = t; k < t + hold; k++) movie.inputs.set(k, ((movie.inputs.get(k) ?? 0) | mask) >>> 0);
      last = t;
    }
  });
  if (version !== 1) throw new Error(`${name}: missing "tpm 1"`);
  if (movie.last < 0) throw new Error(`${name}: missing "end TICK"`);
  return movie;
}

export function loadMovie(path: string): Movie {
  return parseMovie(readFileSync(path, 'utf8'), basename(path));
}
