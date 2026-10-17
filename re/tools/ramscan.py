#!/usr/bin/env python3
"""Memory scanner over main-RAM snapshots (ram_FRAME.bin from re/lua/smoke.lua TP_SNAPS).

Filters every aligned value of the given size across the snapshots, in order, like an emulator's
memory observer, and prints the survivors with their value in each snapshot.

  ramscan.py RULE SNAP... [--size 1|2|4] [--range LO-HI] [--value V] [--signed] [--limit N]

RULE:
  changed   value differs between every pair of consecutive snapshots
  same      value is identical in every snapshot
  inc / dec value strictly increases / decreases from snapshot to snapshot
  eq        value equals --value in every snapshot
  seq       value in snapshot i equals the i-th of --value (comma separated)
  diff      value differs between the first and last snapshot (prints old -> new)

Addresses are printed as KSEG0 (0x80xxxxxx).
"""
import argparse
import sys


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def values(data, size, signed, lo, hi):
    return [int.from_bytes(data[a:a + size], 'little', signed=signed) for a in range(lo, hi, size)]


def parse_addr(text):
    return int(text, 16) & 0x1FFFFF


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('rule', choices=['changed', 'same', 'inc', 'dec', 'eq', 'seq', 'diff'])
    ap.add_argument('snaps', nargs='+')
    ap.add_argument('--size', type=int, default=4, choices=[1, 2, 4])
    ap.add_argument('--range', default='0x80010000-0x80200000')
    ap.add_argument('--value')
    ap.add_argument('--signed', action='store_true')
    ap.add_argument('--limit', type=int, default=200)
    args = ap.parse_args()

    lo, hi = (parse_addr(x) for x in args.range.split('-'))
    lo -= lo % args.size
    columns = [values(read(p), args.size, args.signed, lo, hi) for p in args.snaps]
    wanted = [int(x, 0) for x in args.value.split(',')] if args.value else []
    if args.rule in ('eq', 'seq') and not wanted:
        sys.exit('--value is required for ' + args.rule)
    if args.rule == 'seq' and len(wanted) != len(columns):
        sys.exit('--value needs one entry per snapshot')

    rules = {
        'changed': lambda v: all(a != b for a, b in zip(v, v[1:])),
        'same': lambda v: all(a == v[0] for a in v),
        'inc': lambda v: all(a < b for a, b in zip(v, v[1:])),
        'dec': lambda v: all(a > b for a, b in zip(v, v[1:])),
        'eq': lambda v: all(a == wanted[0] for a in v),
        'seq': lambda v: list(v) == wanted,
        'diff': lambda v: v[0] != v[-1],
    }
    keep = rules[args.rule]
    shown = total = 0
    for i, row in enumerate(zip(*columns)):
        if keep(row):
            total += 1
            if shown < args.limit:
                shown += 1
                cells = f'{row[0]} -> {row[-1]}' if args.rule == 'diff' else ' '.join(str(v) for v in row)
                print(f'0x{0x80000000 + lo + i * args.size:08x}  {cells}')
    print(f'# {total} match(es)', file=sys.stderr)


if __name__ == '__main__':
    main()
