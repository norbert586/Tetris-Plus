#!/usr/bin/env python3
"""Static cross-references for global variables in a decompiled EXE (ExportDecompiled.java output).

For every DAT_xxxxxxxx in the address range, lists the functions that write it and the ones that
only read it. A write is an assignment whose left-hand side names the global: `DAT_x = ...`,
`(&DAT_x)[i] = ...`, `*(T *)(&DAT_x + o) = ...`, compound assignments and ++/--. Accesses through
a pointer copied into a local are not seen (they show up as reads at most), so check anything
important against the emulator's write watchpoints (re/lua/smoke.lua TP_WRITERS).

  global_xrefs.py DECOMPILED.c [--range LO-HI] [--names SEEDS.tsv] [--only ADDR,...]

Output, one line per global: address, writers, readers (function names or addresses).
"""
import argparse
import re

HEADER = re.compile(r'^//==== ([0-9a-f]{8}) (\S+)', re.M)
GLOBAL = re.compile(r'DAT_([0-9a-f]{8})')
# Statement-level assignment: everything before a lone '=' (not ==, <=, >=, !=) or compound op.
ASSIGN = re.compile(r'^(?P<lhs>[^;]*?[^=!<>+\-*/%&|^])\s*(?:[+\-*/%&|^]|<<|>>)?=(?!=)')
INCDEC = re.compile(r'(\+\+|--)')
LEAD = re.compile(r'^(?:else\b|do\b|\s)+')
CONTROL = re.compile(r'^(?:if|while|for|switch|return)\b|\|\||&&|[=!<>]=')


def load_names(path):
    names = {}
    if path:
        for line in open(path):
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 3 and parts[0].startswith('0x'):
                names[int(parts[0], 16)] = parts[2]
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('decompiled')
    ap.add_argument('--range', default='0x800ed800-0x800f3704')
    ap.add_argument('--names')
    ap.add_argument('--only')
    args = ap.parse_args()

    lo, hi = (int(x, 16) for x in args.range.split('-'))
    only = {int(x, 16) for x in args.only.split(',')} if args.only else None
    names = load_names(args.names)
    text = open(args.decompiled).read()

    heads = list(HEADER.finditer(text))
    writers, readers = {}, {}
    for i, h in enumerate(heads):
        func = int(h.group(1), 16)
        body = text[h.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        # Join continuation lines so multi-line statements are seen whole.
        for stmt in re.split(r'[;{}]', re.sub(r'\n\s+', ' ', body)):
            stmt = LEAD.sub('', stmt)
            m = ASSIGN.match(stmt)
            lhs = m.group('lhs') if m else (stmt if INCDEC.search(stmt) else '')
            if CONTROL.search(lhs):
                lhs = ''  # an assignment buried in a condition: count it as a read
            for g in GLOBAL.finditer(stmt):
                addr = int(g.group(1), 16)
                if not lo <= addr < hi or (only and addr not in only):
                    continue
                in_lhs = g.start() < len(lhs) and g.group(0) in lhs
                (writers if in_lhs else readers).setdefault(addr, set()).add(func)

    def label(f):
        return names.get(f, f'{f:08x}')

    for addr in sorted(set(writers) | set(readers)):
        w = sorted(writers.get(addr, ()))
        r = sorted(readers.get(addr, set()) - set(w))
        print(f'0x{addr:08x}\tW {len(w)}: {" ".join(label(f) for f in w)}\tR {len(r)}: '
              f'{" ".join(label(f) for f in r)}')


if __name__ == '__main__':
    main()
