#!/usr/bin/env python3
"""Wrap one or more PS-X EXE files in an ELF32 image that REA's Ghidra lane admits.

REA has no PS-X EXE loader, but it admits ELF32 little-endian MIPS executables whose
header declares EF_MIPS_ARCH_32 with no ABI field and no ABI-flags record (its
"recordless legacy" lane). Combined with REA_GHIDRA_LANGUAGE_ID=PSX:LE:32:default
(from ghidra_psx_ldr), Ghidra then decodes the code as R3000A + GTE.

Each EXE's text is mapped at its header load address. The remaining PS1 main RAM,
the scratchpad and the I/O register window are mapped as uninitialized segments so
references into them resolve to memory instead of dangling. The entry point is the
pc0 of the last EXE given (the program being studied, e.g. PAZLE.EXE loaded on top
of the resident boot program).

Usage: psxexe2elf.py OUT.elf BOOT.EXE [OVERLAY.EXE ...]
"""

import struct
import sys

PSX_HEADER_SIZE = 0x800

RAM_START = 0x80000000
RAM_END = 0x80200000
SCRATCHPAD = (0x1F800000, 0x400)
IO_REGISTERS = (0x1F801000, 0x2000)

PT_LOAD = 1
PF_X, PF_W, PF_R = 1, 2, 4
EM_MIPS = 8
ET_EXEC = 2
EF_MIPS_ARCH_32 = 0x50000000

ELF_HEADER_SIZE = 52
PROGRAM_HEADER_SIZE = 32
FILE_ALIGN = 0x1000


def read_psx_exe(path):
    data = open(path, "rb").read()
    if data[:8] != b"PS-X EXE":
        sys.exit(f"{path}: not a PS-X EXE")
    pc0, _gp0, t_addr, t_size = struct.unpack_from("<4I", data, 0x10)
    text = data[PSX_HEADER_SIZE:PSX_HEADER_SIZE + t_size]
    if len(text) != t_size:
        sys.exit(f"{path}: truncated (header says {t_size:#x} bytes of text)")
    return {"path": path, "pc0": pc0, "addr": t_addr, "text": text}


def ram_gaps(loaded):
    """Uninitialized RAM ranges not covered by any loaded EXE."""
    gaps, cursor = [], RAM_START
    for start, end in sorted((exe["addr"], exe["addr"] + len(exe["text"])) for exe in loaded):
        if start < cursor:
            sys.exit(f"overlapping EXE images at {start:#010x}")
        if start > cursor:
            gaps.append((cursor, start - cursor))
        cursor = end
    if cursor < RAM_END:
        gaps.append((cursor, RAM_END - cursor))
    return gaps


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out_path, exe_paths = sys.argv[1], sys.argv[2:]
    exes = [read_psx_exe(path) for path in exe_paths]

    # (vaddr, filesz, memsz, flags, payload)
    segments = [(exe["addr"], len(exe["text"]), len(exe["text"]), PF_R | PF_W | PF_X, exe["text"])
                for exe in exes]
    segments += [(addr, 0, size, PF_R | PF_W, b"") for addr, size in ram_gaps(exes)]
    segments += [(addr, 0, size, PF_R | PF_W, b"") for addr, size in (SCRATCHPAD, IO_REGISTERS)]
    segments.sort(key=lambda segment: segment[0])

    header_end = ELF_HEADER_SIZE + PROGRAM_HEADER_SIZE * len(segments)
    offset = (header_end + FILE_ALIGN - 1) // FILE_ALIGN * FILE_ALIGN
    program_headers, payload = [], bytearray()
    for vaddr, filesz, memsz, flags, data in segments:
        if filesz:
            assert vaddr % FILE_ALIGN == 0, f"{vaddr:#x} is not page aligned"
            program_headers.append(struct.pack("<8I", PT_LOAD, offset + len(payload), vaddr, vaddr,
                                               filesz, memsz, flags, FILE_ALIGN))
            payload += data
            payload += bytes(-len(payload) % FILE_ALIGN)
        else:
            program_headers.append(struct.pack("<8I", PT_LOAD, 0, vaddr, vaddr, 0, memsz, flags, 0x10))

    ident = b"\x7fELF" + bytes([1, 1, 1, 0]) + bytes(8)  # ELFCLASS32, little endian, version 1
    elf_header = ident + struct.pack("<2H5I6H", ET_EXEC, EM_MIPS, 1, exes[-1]["pc0"], ELF_HEADER_SIZE,
                                     0, EF_MIPS_ARCH_32, ELF_HEADER_SIZE, PROGRAM_HEADER_SIZE,
                                     len(program_headers), 40, 0, 0)
    image = bytearray(elf_header + b"".join(program_headers))
    image += bytes(offset - len(image))
    image += payload
    with open(out_path, "wb") as out:
        out.write(image)
    for vaddr, filesz, memsz, _flags, _data in segments:
        kind = "file" if filesz else "zero"
        print(f"  {vaddr:#010x}-{vaddr + memsz:#010x} {kind}")
    print(f"wrote {out_path}: entry {exes[-1]['pc0']:#010x}, {len(segments)} segments")


if __name__ == "__main__":
    main()
