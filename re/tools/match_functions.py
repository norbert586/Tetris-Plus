#!/usr/bin/env python3
"""Carries function names from one PS-X EXE to another by matching their code.

The mode programs link the same engine routines (sprite objects, item loading, sound calls) at
different addresses. Two functions match when their instructions are equal after masking what
relocation changes: jump targets, `lui` immediates and the low halves paired with them (addiu,
ori, loads and stores whose base register a `lui` set in the same function). Only matches that
are unique on both sides are kept.

    match_functions.py REF.EXE REF.cg.tsv REF_NAMES.tsv... -- TARGET.EXE TARGET.cg.tsv OUT.tsv

Names files are TSV (address, kind, name[, evidence]); later files win. The output lists every
matched target function as `address<TAB>function<TAB>name<TAB>M: REF_ADDRESS` (M = matched).
Functions whose reference name is a generated `FUN_` name are matched too and named after the
reference address (`ref_800XXXXX`), so a function can be followed between programs.
"""
import struct
import sys
from collections import defaultdict

LOW_HALF_OPS = {0x08, 0x09, 0x0D, 0x20, 0x21, 0x23, 0x24, 0x25, 0x28, 0x29, 0x2B}


def load_exe(path):
    data = open(path, 'rb').read()
    t_addr, t_size = struct.unpack_from('<II', data, 0x18)
    return t_addr, data[0x800:0x800 + t_size]


def load_functions(cg_path):
    funcs = {}
    for line in open(cg_path):
        p = line.rstrip('\n').split('\t')
        if p[0] != 'F':
            continue
        start, end = int(p[3], 16), int(p[4], 16)
        if int(p[1], 16) < 0x80000000:
            continue
        funcs[int(p[1], 16)] = (p[2], start, end)
    return funcs


def load_names(paths):
    names = {}
    for path in paths:
        for line in open(path):
            if line.startswith('#') or not line.strip():
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) >= 3 and p[1] == 'function':
                names[int(p[0], 16)] = p[2]
    return names


def signature(text, base, start, end):
    if start < base or end > base + len(text) or end <= start:
        return None
    words = []
    lui_regs = set()
    for a in range(start, end + 1, 4):
        off = a - base
        if off + 4 > len(text):
            break
        w = struct.unpack_from('<I', text, off)[0]
        op = w >> 26
        rs, rt = (w >> 21) & 31, (w >> 16) & 31
        if op in (2, 3):
            w &= 0xFC000000
        elif op == 0x0F:
            w &= 0xFFFF0000
            lui_regs.add(rt)
        elif op in LOW_HALF_OPS and (rs in lui_regs or rs == 28):
            w &= 0xFFFF0000
        words.append(w)
    if len(words) < 4:
        return None
    return tuple(words)


def main(argv):
    if '--' not in argv:
        sys.exit(__doc__)
    i = argv.index('--')
    ref_exe, ref_cg, *ref_names = argv[:i]
    target_exe, target_cg, out = argv[i + 1:]
    rbase, rtext = load_exe(ref_exe)
    tbase, ttext = load_exe(target_exe)
    names = load_names(ref_names)
    rsigs = defaultdict(list)
    for addr, (name, s, e) in load_functions(ref_cg).items():
        sig = signature(rtext, rbase, s, e)
        if sig:
            rsigs[sig].append(addr)
    tsigs = defaultdict(list)
    for addr, (name, s, e) in load_functions(target_cg).items():
        sig = signature(ttext, tbase, s, e)
        if sig:
            tsigs[sig].append(addr)
    rows = []
    for sig, taddrs in tsigs.items():
        raddrs = rsigs.get(sig, [])
        if len(taddrs) == 1 and len(raddrs) == 1:
            r = raddrs[0]
            name = names.get(r, '')
            if not name or name.startswith('FUN_'):
                name = 'ref_%08x' % r
            rows.append((taddrs[0], name, r))
    rows.sort()
    with open(out, 'w') as f:
        f.write('# Matched against %s (re/tools/match_functions.py). address<TAB>function<TAB>name<TAB>evidence\n'
                % ref_exe.split('/')[-1])
        for t, name, r in rows:
            f.write('0x%08x\tfunction\t%s\tM: 0x%08x\n' % (t, name, r))
    named = sum(1 for _, n, _ in rows if not n.startswith('ref_'))
    print('%s: %d functions matched (%d with names)' % (out, len(rows), named))


if __name__ == '__main__':
    main(sys.argv[1:])
