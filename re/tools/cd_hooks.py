#!/usr/bin/env python3
"""Generate the CD-command hook table that re/lua/smoke.lua uses when TP_CD_HOOKS is set.

Every mode program links its own copy of libcd, so CdControl/CdControlF/CdControlB sit at a
different address in each. Programs are told apart at run time by the first 16 bytes of the
shared program slot (0x80094000), which smoke.lua already fingerprints. One output line per
program: <fingerprint hex> <name> <CdControl> <CdControlF> <CdControlB>. The resident boot
program (SLUS_003.38, which loads every EXE and data file) gets the fingerprint "boot" and is
hooked for the whole run.

Usage: cd_hooks.py FILES_DIR NAMES_DIR > re/lua/cd_hooks.txt
  NAMES_DIR holds <EXE>.tsv exports from re/ghidra/ExportFunctionNames.java.
"""

import os
import sys

PSX_HEADER_SIZE = 0x800
WANTED = ("CdControl", "CdControlF", "CdControlB")


def main():
    files_dir, names_dir = sys.argv[1], sys.argv[2]
    for tsv in sorted(os.listdir(names_dir)):
        if not tsv.endswith(".tsv"):
            continue
        exe = tsv[:-4]
        names = {}
        for line in open(os.path.join(names_dir, tsv)):
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 3 and parts[2] in WANTED:
                names[parts[2]] = parts[0]
        if len(names) != len(WANTED):
            sys.exit(f"{exe}: missing {set(WANTED) - set(names)}")
        with open(os.path.join(files_dir, exe), "rb") as f:
            fingerprint = f.read()[PSX_HEADER_SIZE:PSX_HEADER_SIZE + 16].hex()
        if exe == "SLUS_003.38":
            fingerprint = "boot"
        print(fingerprint, exe, *(names[n] for n in WANTED))


if __name__ == "__main__":
    main()
