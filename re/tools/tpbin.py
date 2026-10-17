#!/usr/bin/env python3
"""Decode Tetris Plus data files (*.BIN): indexed items, each stored or LZ-compressed.

Item layout, from the boot program's decoder at 0x80023204 (SLUS_003.38):

    u8   method        0 = stored, 1 = LZ
    u16  out_length    little endian, decoded size in bytes
    ...  payload

Stored: out_length raw bytes follow.
LZ: groups of one u16 flag word (little endian) and up to 16 tokens, read from bit 0 upward.
    A flag word of 0 means 16 literal bytes follow. Otherwise a 0 bit is one literal byte and a
    1 bit is a two-byte match b0, b1: distance = ((b1 << 8 | b0) & 0x7ff) + 1 back from the
    output end, length = (b1 >> 3) + 3. Groups repeat until out_length bytes are produced; the
    last group always runs all 16 tokens, as the original does (it may overshoot out_length).

Item boundaries are not recoverable from the data alone: the decoder runs every flag group to
16 tokens, so the end of the last group over-reads into the next item. Each mode program instead
holds a table of u32 item offsets into its data file (PAZLE.EXE: 0x800E1318, 1235 entries), and
the program loads the whole file at a fixed address and decodes items by index. find_table()
locates that table by scanning the EXE for the longest increasing u32 run that starts at 0 and
whose every entry points at a method byte of 0 or 1.

Usage:
    tpbin.py list PROGRAM.EXE DATA.BIN        print one line per item
    tpbin.py extract PROGRAM.EXE DATA.BIN OUT_DIR
                                              write each decoded item as OUT_DIR/NNNN_<kind>.<ext>
"""

import os
import struct
import sys


def decode_item(data, pos):
    """Decode the item at data[pos]. Returns (method, decoded bytes, input bytes read).

    For LZ items the bytes read include the final group's over-read, so they are not the item size.
    """
    method = data[pos]
    (length,) = struct.unpack_from("<H", data, pos + 1)
    src = pos + 3
    if method == 0:
        return method, bytes(data[src:src + length]), 3 + length
    if method != 1:
        raise ValueError(f"unknown method {method} at {pos:#x}")
    out = bytearray()
    while len(out) < length:
        (flags,) = struct.unpack_from("<H", data, src)
        src += 2
        if flags == 0:
            out += data[src:src + 16]
            src += 16
            continue
        for _ in range(16):
            if flags & 1 == 0:
                out.append(data[src])
                src += 1
            else:
                b0, b1 = data[src], data[src + 1]
                src += 2
                start = len(out) - (((b1 << 8 | b0) & 0x7FF) + 1)
                for i in range((b1 >> 3) + 3):  # byte by byte: overlapping copies repeat
                    out.append(out[start + i])
            flags >>= 1
    return method, bytes(out[:length]), src - pos


def classify(blob):
    """(kind, description). Every item on the US disc is a TIM; anything else is reported as data."""
    if len(blob) >= 20 and blob[:4] == b"\x10\x00\x00\x00" and blob[4] & ~0xB == 0 and blob[5:8] == b"\0\0\0":
        bpp = {0: 4, 1: 8, 2: 16, 3: 24}[blob[4] & 3]
        info, pos = f"TIM {bpp}bpp", 8
        if blob[4] & 8:
            clut_len, cx, cy, cw, ch = struct.unpack_from("<I4H", blob, pos)
            info += f" clut {cw}x{ch}@({cx},{cy})"
            pos += clut_len
        _, ix, iy, iw, ih = struct.unpack_from("<I4H", blob, pos)
        width = {4: iw * 4, 8: iw * 2, 16: iw, 24: iw * 2 // 3}[bpp]
        return "tim", f"{info} image {width}x{ih} px at VRAM ({ix},{iy})"
    return "data", "data"


PSX_HEADER_SIZE = 0x800


def find_table(exe, data):
    """Return (address, offsets) of the item offset table for data inside the PS-X EXE."""
    (t_addr,) = struct.unpack_from("<I", exe, 0x18)
    words = struct.unpack_from(f"<{(len(exe) - PSX_HEADER_SIZE) // 4}I", exe, PSX_HEADER_SIZE)
    best = (0, [])
    for start, word in enumerate(words):
        if word != 0:
            continue
        run = [0]
        for value in words[start + 1:]:
            if value <= run[-1] or value >= len(data) or data[value] > 1:
                break
            run.append(value)
        if len(run) > len(best[1]):
            best = (t_addr + start * 4, run)
    return best


def items(data, offsets):
    padded = data + bytes(64)  # the last item's final flag group may read past the end of the file
    for index, pos in enumerate(offsets):
        end = offsets[index + 1] if index + 1 < len(offsets) else len(data)
        method, blob, _ = decode_item(padded, pos)
        yield pos, method, blob, end - pos


EXTENSIONS = {"tim": "tim", "data": "bin"}


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ("list", "extract"):
        sys.exit(__doc__)
    exe, data = open(sys.argv[2], "rb").read(), open(sys.argv[3], "rb").read()
    table_addr, offsets = find_table(exe, data)
    name = os.path.basename(sys.argv[3])
    if sys.argv[1] == "list":
        print(f"{name}: {len(offsets)} items, offset table at {table_addr:#010x} in {os.path.basename(sys.argv[2])}")
        for index, (pos, method, blob, used) in enumerate(items(data, offsets)):
            _, info = classify(blob)
            print(f"#{index:04d} @{pos:#08x} {'LZ ' if method else 'raw'} {used:6d} -> {len(blob):6d}  {info}")
    else:
        os.makedirs(sys.argv[4], exist_ok=True)
        for index, (_pos, _method, blob, _used) in enumerate(items(data, offsets)):
            kind, _ = classify(blob)
            with open(os.path.join(sys.argv[4], f"{index:04d}_{kind}.{EXTENSIONS[kind]}"), "wb") as out:
                out.write(blob)


if __name__ == "__main__":
    main()
