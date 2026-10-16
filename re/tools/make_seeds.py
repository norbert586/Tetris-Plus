#!/usr/bin/env python3
"""Merge per-EXE name exports into one REA seed file (REA_GHIDRA_SEED_FILE).

Input files are produced by re/ghidra/ExportFunctionNames.java. Entries outside main
RAM (ghidra_psx_ldr's synthetic GTE-macro segment at 0x2000xxxx) are dropped because
they don't exist in the ELF wrapper. Duplicate names get an address suffix so every
seed stays unique; the last input (the program being studied) keeps the plain names.

Usage: make_seeds.py OUT.tsv EXPORT.tsv [EXPORT.tsv ...]
"""

import sys

RAM_START, RAM_END = 0x80000000, 0x80200000


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out_path, inputs = sys.argv[1], sys.argv[2:]
    used, seeds = set(), {}
    for path in reversed(inputs):
        for line in open(path, encoding="utf-8"):
            if not line.strip() or line.startswith("#"):
                continue
            address_text, kind, name = line.rstrip("\n").split("\t")[:3]
            address = int(address_text, 16)
            if not RAM_START <= address < RAM_END or kind != "function" or address in seeds:
                continue
            if name in used:
                name = f"{name}_{address:08x}"
            used.add(name)
            seeds[address] = name
    lines = [f"0x{address:08x}\tfunction\t{seeds[address]}" for address in sorted(seeds)]
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(f"# REA seeds merged from: {' '.join(inputs)}\n")
        out.write("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} seeds to {out_path}")


if __name__ == "__main__":
    main()
