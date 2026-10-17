#!/usr/bin/env python3
"""Read words, halfwords, bytes or strings out of a PS-X EXE by RAM address.

Handy for dumping jump tables and data tables the decompiler leaves as DAT_/PTR_ labels.

Usage:
  exeread.py EXE ADDRESS [COUNT] [--size 4|2|1] [--signed]   dump COUNT values (default 16)
  exeread.py EXE ADDRESS --string                            one NUL-terminated string
"""

import argparse
import struct
import sys

HEADER = 0x800


def load(path):
    data = open(path, "rb").read()
    if data[:8] != b"PS-X EXE":
        sys.exit(f"{path}: not a PS-X EXE")
    t_addr, t_size = struct.unpack_from("<II", data, 0x18)
    return t_addr, data[HEADER:HEADER + t_size]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("exe")
    parser.add_argument("address", type=lambda s: int(s, 16))
    parser.add_argument("count", nargs="?", type=int, default=16)
    parser.add_argument("--size", type=int, choices=(1, 2, 4), default=4)
    parser.add_argument("--signed", action="store_true")
    parser.add_argument("--string", action="store_true")
    args = parser.parse_args()

    base, text = load(args.exe)
    offset = args.address - base
    if not 0 <= offset < len(text):
        sys.exit(f"0x{args.address:08x} is outside 0x{base:08x}-0x{base + len(text):08x}")
    if args.string:
        end = text.index(b"\0", offset)
        print(text[offset:end].decode("latin-1"))
        return
    code = {1: "b", 2: "h", 4: "i"}[args.size]
    code = code if args.signed else code.upper()
    for i in range(args.count):
        at = offset + i * args.size
        if at + args.size > len(text):
            break
        (value,) = struct.unpack_from("<" + code, text, at)
        shown = str(value) if args.signed else f"0x{value:0{args.size * 2}x}"
        print(f"0x{base + at:08x}  {shown}")


if __name__ == "__main__":
    main()
