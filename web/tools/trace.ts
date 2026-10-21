// Reads traces written by re/lua/movie.lua (docs/re/oracle-harness.md §3): a header line, then
// one line per tick with only the fields that changed. Event lists (se, bgm, up, kon, koff, cd, cdr) appear only on
// ticks that have events. The TypeScript twin of re/tools/tptrace.py's reader.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export type Value = number | string | Value[];
export type Row = Record<string, Value>;

export interface Trace {
  movie: string;
  fields: string[];
  rows: Row[];
}

export const EVENT_FIELDS = ['se', 'bgm', 'up', 'kon', 'koff', 'cd', 'cdr'];

export function parseTrace(text: string): Trace {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const header = JSON.parse(lines[0]);
  if (![1, 2, 3, 4].includes(header.tptrace)) throw new Error('not a version 1-4 trace');
  const rows: Row[] = [];
  let current: Row = {};
  for (let i = 1; i < lines.length; i++) {
    const delta = JSON.parse(lines[i]) as Row;
    current = { ...current, ...Object.fromEntries(EVENT_FIELDS.map((f) => [f, []])), ...delta };
    rows.push(current);
  }
  return { movie: header.movie, fields: header.fields, rows };
}

export function loadTrace(path: string): Trace {
  const buf = readFileSync(path);
  return parseTrace((path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'));
}

export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  return a === b;
}
