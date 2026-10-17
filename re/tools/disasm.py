#!/usr/bin/env python3
"""Disassembles a function (or an address range) of a PS-X EXE with capstone.

  disasm.py EXE ADDRESS [END] [--cg CALLGRAPH.tsv] [--names SEEDS.tsv]

With only ADDRESS, the function's extent comes from ExportCallGraph.java's TSV (--cg). Names
from a seeds file (address<TAB>kind<TAB>name) label jal targets. Ghidra's decompiler sometimes
drops call arguments set up in delay slots or earlier blocks; this shows what the code does.
"""
import argparse
import struct

import capstone


def load_exe(path):
    data = open(path, 'rb').read()
    t_addr, t_size = struct.unpack_from('<II', data, 0x18)
    return t_addr, data[0x800:0x800 + t_size]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('exe')
    p.add_argument('start')
    p.add_argument('end', nargs='?')
    p.add_argument('--cg')
    p.add_argument('--names')
    a = p.parse_args()
    base, code = load_exe(a.exe)
    start = int(a.start, 16)
    names = {}
    if a.names:
        for line in open(a.names):
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 3 and not line.startswith('#'):
                names[int(parts[0], 16)] = parts[2]
    if a.end:
        end = int(a.end, 16)
    else:
        end = None
        for line in open(a.cg):
            parts = line.rstrip('\n').split('\t')
            if parts[0] == 'F' and int(parts[1], 16) == start:
                end = int(parts[4], 16) + 1
        if end is None:
            raise SystemExit('function not found in the call graph')
    md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN)
    for ins in md.disasm(code[start - base:end - base], start):
        note = ''
        if ins.mnemonic in ('jal', 'j') and ins.op_str.startswith('0x'):
            note = names.get(int(ins.op_str, 16), '')
        print(f'{ins.address:08x}  {ins.mnemonic:8} {ins.op_str}{"   ; " + note if note else ""}')


if __name__ == '__main__':
    main()
