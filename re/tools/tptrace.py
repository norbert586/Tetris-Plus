#!/usr/bin/env python3
"""Reads, compares and summarises traces written by re/lua/movie.lua (docs/re/oracle-harness.md).

A trace is JSON lines: a header, then one line per logic tick holding the tick ("t") and only
the fields that changed since the previous line. Event lists ("se", "bgm", "up", "kon", "koff", "cd", "cdr") are written only on
ticks that have events. Traces may be gzip-compressed (.gz).

  tptrace.py rows TRACE [--fields a,b] [--from T] [--to T] [--changes]
  tptrace.py diff A B [--ignore a,b] [--context N]   exit 1 at the first differing tick
  tptrace.py events TRACE                            screens, pieces, locks, clears, sounds...
  tptrace.py board TRACE TICK                        the board with the piece and professor
"""
import argparse
import gzip
import json
import sys

EVENT_FIELDS = ('se', 'bgm', 'up', 'kon', 'koff', 'cd', 'cdr')
PIECES = '.IOTJLZS'


def open_text(path):
    return gzip.open(path, 'rt') if path.endswith('.gz') else open(path)


def read(path):
    """Returns (header, rows): every row holds every field's value at its tick. Traces of several
    programs (a "seg" line starts each after the first) give every row a "program" field."""
    with open_text(path) as f:
        header = json.loads(f.readline())
        if header.get("tptrace") not in (1, 2, 3, 4):
            raise SystemExit(f'{path}: not a version 1-4 trace')
        rows, current = [], {'program': header.get('program', 'PAZLE')}
        for line in f:
            delta = json.loads(line)
            if 'seg' in delta:
                current = {'program': delta['program']}
                continue
            for name in EVENT_FIELDS:
                current[name] = []
            current.update(delta)
            rows.append(dict(current))
    return header, rows


def fx(value):
    """16.16 fixed point to a short string."""
    whole = value / 65536
    return f'{whole:g}'


def shapes():
    import os
    path = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'spec', 'data', 'pieces.json')
    with open(path) as f:
        return json.load(f)


def cmd_rows(args):
    header, rows = read(args.trace)
    names = args.fields.split(',') if args.fields else header['fields']
    previous = None
    for row in rows:
        if args.start is not None and row['t'] < args.start:
            previous = row
            continue
        if args.end is not None and row['t'] > args.end:
            break
        values = {n: row.get(n) for n in names}
        if args.changes and previous is not None:
            values = {n: v for n, v in values.items() if previous.get(n) != v and (v or n not in EVENT_FIELDS)}
            if not values:
                previous = row
                continue
        print(row['t'], ' '.join(f'{n}={json.dumps(v, separators=(",", ":"))}' for n, v in values.items()))
        previous = row


def cmd_diff(args):
    ha, ra = read(args.a)
    hb, rb = read(args.b)
    ignore = set(args.ignore.split(',')) if args.ignore else set()
    if ha['fields'] != hb['fields']:
        print('traces record different fields')
        return 1
    by_tick = {r['t']: r for r in rb}
    common = [r for r in ra if r['t'] in by_tick]
    if not common:
        print('no ticks in common')
        return 1
    index = {r['t']: i for i, r in enumerate(ra)}
    for row in common:
        other = by_tick[row['t']]
        names = [n for n in ha['fields'] if n not in ignore and row.get(n) != other.get(n)]
        if names:
            t = row['t']
            print(f'first difference at tick {t}: {", ".join(names)}')
            i = index[t]
            for r in ra[max(0, i - args.context):i + 1]:
                o = by_tick.get(r['t'], {})
                for n in names:
                    mark = '  ' if r.get(n) == o.get(n) else '!='
                    print(f'  {r["t"]:6} {n:16} {json.dumps(r.get(n)):>24} {mark} {json.dumps(o.get(n))}')
            return 1
    first, last = common[0]['t'], common[-1]['t']
    only = len(ra) - len(common), len(rb) - len(common)
    print(f'identical over ticks {first}-{last} ({len(common)} ticks; {only[0]} only in A, {only[1]} only in B)')
    return 0


def cmd_events(args):
    _, rows = read(args.trace)
    previous = {}
    for row in rows:
        t = row['t']
        out = []
        if row['scr'] != previous.get('scr'):
            out.append(f'screen {row["scr"]}')
        if row['pieces'] != previous.get('pieces', 0) and row['piece']:
            out.append(f'spawn {PIECES[row["piece"]]} (next {PIECES[row["next1"]]} {PIECES[row["next2"]]})')
        if previous.get('piece') and not row['piece']:
            out.append(f'lock {PIECES[previous["piece"]]} rot {previous["rot"]} at '
                       f'({fx(previous["px"])}, {fx(previous["py"])})')
        if row['lines_cleared'] != previous.get('lines_cleared', 0):
            out.append(f'lines {row["lines_cleared"]} score {row["score"]}')
        if row['ceil_drops'] != previous.get('ceil_drops', 0):
            out.append(f'ceiling drop {row["ceil_drops"]} -> y {fx(row["ceil_y"])}')
        if row['ceil_y'] != previous.get('ceil_y') and row['ceil_drops'] == previous.get('ceil_drops'):
            out.append(f'ceiling y {fx(row["ceil_y"])}')
        if row['prof_action'] != previous.get('prof_action'):
            out.append(f'prof action 0x{row["prof_action"]:02x} at ({row["prof_col"]}, {row["prof_row"]})')
        if row['prof_state'] != previous.get('prof_state'):
            out.append(f'prof state {row["prof_state"]}')
        for flag in ('stage_flags', 'lose_flags', 'clear_flags', 'stage', 'zone'):
            if flag in previous and row[flag] != previous[flag]:
                out.append(f'{flag} {row[flag]}')
        if row['se']:
            out.append('se ' + ' '.join(f'0x{s:02x}' for s in row['se']))
        if row['bgm']:
            out.append('bgm ' + ' '.join(f'0x{s:02x}' for s in row['bgm']))
        if out:
            print(t, '; '.join(out))
        previous = row


def cmd_board(args):
    _, rows = read(args.trace)
    row = next((r for r in rows if r['t'] == args.tick), None)
    if row is None:
        raise SystemExit(f'no tick {args.tick}')
    cells = [list(row['board'][r * 10:r * 10 + 10]) for r in range(16)]
    if row['piece']:
        grid = shapes()['kinds'][row['piece']]['rotations'][row['rot']]
        x0, y0 = int((row['px'] >> 16) / 10), int((row['py'] >> 16) / 10)
        for gy, line in enumerate(grid):
            for gx, v in enumerate(line):
                if v == '#' and 0 <= y0 + gy < 16 and 0 <= x0 + gx < 10:
                    cells[y0 + gy][x0 + gx] = '@'
    if row['prof_state']:
        for dr in (-1, 0):
            for dc in (0, 1):
                r, c = row['prof_row'] + dr, row['prof_col'] + dc
                if 0 <= r < 16 and 0 <= c < 10:
                    cells[r][c] = 'P' if cells[r][c] == '.' else 'p'
    ceiling = (row['ceil_y'] >> 16) // 10
    print(f'tick {row["t"]}: piece {PIECES[row["piece"]]} rot {row["rot"]}, next {PIECES[row["next1"]]} '
          f'{PIECES[row["next2"]]}, ceiling row {ceiling}, professor ({row["prof_col"]}, {row["prof_row"]}) '
          f'action 0x{row["prof_action"]:02x}')
    for r, line in enumerate(cells):
        print(f'{r:2} {"".join(line)}{"  <- ceiling" if r == ceiling else ""}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('rows')
    s.add_argument('trace')
    s.add_argument('--fields')
    s.add_argument('--from', dest='start', type=int)
    s.add_argument('--to', dest='end', type=int)
    s.add_argument('--changes', action='store_true', help='only fields that changed, only ticks with changes')
    s = sub.add_parser('diff')
    s.add_argument('a')
    s.add_argument('b')
    s.add_argument('--ignore')
    s.add_argument('--context', type=int, default=5)
    s = sub.add_parser('events')
    s.add_argument('trace')
    s = sub.add_parser('board')
    s.add_argument('trace')
    s.add_argument('tick', type=int)
    args = p.parse_args()
    return {'rows': cmd_rows, 'diff': cmd_diff, 'events': cmd_events, 'board': cmd_board}[args.cmd](args) or 0


if __name__ == '__main__':
    sys.exit(main())
