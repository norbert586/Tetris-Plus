// SELECT's trace row: the fields of re/lua/fields/SELECT.lua (and common.lua), read from the
// port's RAM at the same addresses, plus the per-tick events the tracer's hooks record.
import * as A from '../../core/addr';
import type { Row, Value } from '../../../tools/trace';
import type { Select } from './select';

type Type = 's32' | 'u32' | 'u16' | 'u8';
type Field = [name: string, address: number, type: Type, count?: number, stride?: number];

const S = A.S;
const obj = (f: number) => S + 0x5c + f;
const SIZE: Record<Type, number> = { s32: 4, u32: 4, u16: 2, u8: 1 };

/** re/lua/fields/common.lua, then re/lua/fields/SELECT.lua (keep them in step). */
export const FIELDS: Field[] = [
  ['ctr', S + 0x40, 'u32'],
  ['next', S + 0x48, 'u32'],
  ['param', S + 0x4c, 'u32'],
  ['phase', S + 0x50, 'u32'],
  ['subphase', S + 0x54, 'u32'],
  ['exit', S + 0x1fcf4, 'u32'],
  ['scr', S + 0x4b508, 'u32', 2],
  ['step', S + 0x4b510, 'u32', 2],
  ['pad', 0x800be126, 'u16'],
  ['padp', 0x800be128, 'u16'],
  ['pad2', 0x800be12c, 'u16'],
  ['padp2', 0x800be12e, 'u16'],
  ['mstep', 0x800b9094, 's32'],
  ['msel', 0x800b90a0, 's32'],
  ['mwait', 0x800b90a4, 's32'],
  ['orow', 0x800b9a4c, 's32'],
  ['orot', 0x800be114, 's32', 4],
  ['orotv', 0x800be024, 's32', 2],
  ['orotr', 0x800b9ac0, 's32', 2],
  ['ohi', 0x800be048, 's32'],
  ['olevel', 0x800b9a3c, 's32'],
  ['omatch', 0x800b9a2c, 's32'],
  ['otmp', 0x800b9a38, 's32'],
  ['obgm', 0x800b9adc, 's32'],
  ['ose', 0x800b9a34, 's32'],
  ['ovol', 0x800b9bac, 's32'],
  ['odata', 0x800b9c48, 's32'],
  ['orank', 0x800b9c84, 's32'],
  ['oyes', 0x800b9c90, 's32'],
  ['ocard', 0x800b9cec, 's32'],
  ['ofree', 0x800b9ce8, 's32'],
  ['oread', 0x800b9a48, 's32'],
  ['ocardst', 0x800b9050, 's32'],
  ['oslot', 0x800bbd70, 's32'],
  ['otimer', S + 0x1fd0c, 's32'],
  ['settings', S + 0x4b4ec, 'u8', 24],
  ['rankdata', S + 0x4ae60, 'u32', 30],
  ['rows', S + 0x4b538, 's32'],
  ['twop', S + 0x4b53c, 's32'],
  ['bgmcur', 0x800b90c0, 's32', 4],
  ['cdtrack', 0x800b90f4, 's32'],
  ['cdmode', 0x800b90f8, 's32'],
  ['cdend', 0x800b9128, 's32'],
  ['cdstart', 0x800b9124, 's32'],
  ['oimg', obj(0x24), 's32', 128, 0x7c],
  ['ox', obj(0x00), 's32', 128, 0x7c],
  ['oy', obj(0x04), 's32', 128, 0x7c],
  ['osx', obj(0x08), 's32', 128, 0x7c],
  ['osy', obj(0x0c), 's32', 128, 0x7c],
  ['oblend', obj(0x14), 's32', 128, 0x7c],
  ['oflip', obj(0x44), 's32', 128, 0x7c],
  ['opri', obj(0x40), 's32', 128, 0x7c],
  ['oanim', obj(0x2c), 's32', 128, 0x7c],
  ['oatime', obj(0x30), 's32', 128, 0x7c],
  ['oaframe', obj(0x34), 's32', 128, 0x7c],
  ['ox2', obj(0x4c), 's32', 128, 0x7c],
  ['oy2', obj(0x50), 's32', 128, 0x7c],
];

/** Where the packed items live (SELECTE.BIN, loaded at 0x800F4000) and their offsets. */
const ITEMS = 0x800f4000;
const ITEM_OFFSETS = 0x800b23ec;

/** The trace's `up` value for an upload of item n: the address the decompressor is given. */
export function uploadAddress(s: Select, item: number): number {
  return (ITEMS + s.m.u32(ITEM_OFFSETS + 4 * item)) >>> 0;
}

function read(s: Select, type: Type, a: number): number {
  const m = s.m;
  return type === 's32' ? m.s32(a) : type === 'u32' ? m.u32(a) : type === 'u16' ? m.u16(a) : m.u8(a);
}

export function traceRow(s: Select): Row {
  const row: Row = {};
  for (const [name, address, type, count, stride] of FIELDS) {
    if (count === undefined) {
      row[name] = read(s, type, address);
    } else {
      const v: Value[] = [];
      for (let i = 0; i < count; i++) v.push(read(s, type, address + i * (stride ?? SIZE[type])));
      row[name] = v;
    }
  }
  row.seed = s.rng.seed;
  row.rand = s.rng.calls;
  row.se = s.se;
  row.bgm = s.bgm;
  row.up = s.uploads.map((i) => uploadAddress(s, i));
  // CD commands (Select.cd) are not in the row: the trace's `cd` also has the ones the CD
  // report callback sends when a track ends (the audio layer's CD drive, src/audio/), so the
  // tests check the program's own commands against it separately.
  return row;
}
