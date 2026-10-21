// Reads input movies (.tpm version 1, docs/re/oracle-harness.md §2): the PadRead word for each
// logic tick, pad 1 in the low half and pad 2 in the high half.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CardSlots, MemoryCard } from '../src/core/card';
import { BUTTONS } from '../src/core/pad';

/**
 * One program's run in a movie: `program NAME` starts a segment (the lines before the first one
 * belong to the boot route's program, PAZLE). Ticks count from that program's start.
 */
export interface Segment {
  program: string;
  /** The last tick to run, or -1: until the program exits. */
  last: number;
  /** inputs[t] = the pad word the logic sees on tick t (0 when absent). */
  inputs: Map<number, number>;
  /** pokes[t] = memory writes made right after tick t is recorded (scenario set-up). */
  pokes: Map<number, Poke[]>;
}

export interface Movie {
  name: string;
  boot: string;
  /** The first segment's fields, for movies of one program. */
  last: number;
  inputs: Map<number, number>;
  pokes: Map<number, Poke[]>;
  segments: Segment[];
  /** The memory card in each port at power-on: 'blank' (the default), 'none' or a .mcd(.gz) path from the repo root. */
  cards: [string, string];
}

export interface Poke {
  address: number;
  value: number;
  size: 1 | 2 | 4;
}

export function parseMovie(text: string, name = 'movie'): Movie {
  let seg: Segment = { program: 'PAZLE', last: -1, inputs: new Map(), pokes: new Map() };
  const movie: Movie = {
    name, boot: 'puzzle', last: -1, inputs: seg.inputs, pokes: seg.pokes, segments: [seg], cards: ['blank', 'blank'],
  };
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
      seg.last = Number(words[1]);
    } else if (words[0] === 'program') {
      if (!words[1]) throw new Error(`${where}: expected program NAME`);
      if (movie.segments.length === 1 && seg.inputs.size === 0 && seg.pokes.size === 0 && seg.last < 0) {
        seg.program = words[1];
      } else {
        seg = { program: words[1], last: -1, inputs: new Map(), pokes: new Map() };
        movie.segments.push(seg);
      }
      last = 0;
    } else if (words[0] === 'mark') {
      // annotation only
    } else if (words[0] === 'card') {
      const port = Number(words[1]);
      if ((port !== 1 && port !== 2) || !words[2]) throw new Error(`${where}: expected card 1|2 blank|none|PATH`);
      movie.cards[port - 1] = words[2];
    } else if (words[0] === 'poke') {
      const [t, address, value] = [Number(words[1]), Number(words[2]), Number(words[3])];
      const size = Number(words[4] ?? '4');
      if (!Number.isInteger(t) || !Number.isInteger(address) || !Number.isInteger(value) || ![1, 2, 4].includes(size)) {
        throw new Error(`${where}: expected poke TICK ADDRESS VALUE [1|2|4]`);
      }
      const list = seg.pokes.get(t) ?? [];
      list.push({ address, value, size: size as 1 | 2 | 4 });
      seg.pokes.set(t, list);
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
      for (let k = t; k < t + hold; k++) seg.inputs.set(k, ((seg.inputs.get(k) ?? 0) | mask) >>> 0);
      last = t;
    }
  });
  if (version !== 1) throw new Error(`${name}: missing "tpm 1"`);
  movie.last = movie.segments[0].last;
  if (movie.segments.length === 1 && movie.last < 0) throw new Error(`${name}: missing "end TICK"`);
  return movie;
}

export function loadMovie(path: string): Movie {
  return parseMovie(readFileSync(path, 'utf8'), basename(path));
}

/** The movie's memory cards for the core (paths are relative to the repository root). */
export function movieCards(movie: Movie, repo: string): CardSlots {
  return new CardSlots(
    movie.cards.map((spec) => {
      if (spec === 'none') return null;
      if (spec === 'blank') return new MemoryCard();
      const raw = readFileSync(join(repo, spec));
      return new MemoryCard(new Uint8Array(spec.endsWith('.gz') ? gunzipSync(raw) : raw));
    }),
  );
}
