#!/usr/bin/env python3
"""Convert PCSX-Redux raw screenshots (from re/lua/*.lua) to PNG.

File names encode the format: shot_<frame>_<width>x<height>_<16|24>.raw. 16-bit shots are
PS1 15-bit pixels (bits 0-4 red, 5-9 green, 10-14 blue); 24-bit shots are RGB triplets.
Colours are expanded the way the PS1 video DAC does: 5-bit c -> (c << 3) | (c >> 2).

Usage: shot2png.py SHOT.raw [SHOT.raw ...]   (writes SHOT.png next to each input)
"""

import re
import struct
import sys
import zlib


def to_rgb_rows(data, width, height, bpp):
    rows = []
    if bpp == 16:
        for y in range(height):
            row = bytearray()
            for (pixel,) in struct.iter_unpack("<H", data[y * width * 2:(y + 1) * width * 2]):
                for shift in (0, 5, 10):
                    c = (pixel >> shift) & 31
                    row.append((c << 3) | (c >> 2))
            rows.append(bytes(row))
    else:
        rows = [data[y * width * 3:(y + 1) * width * 3] for y in range(height)]
    return rows


def write_png(path, rows, width, height):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    raw = b"".join(b"\x00" + row for row in rows)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as out:
        out.write(png)


def main():
    for path in sys.argv[1:]:
        match = re.search(r"_(\d+)x(\d+)_(16|24)\.raw$", path)
        if not match:
            sys.exit(f"{path}: name doesn't encode the format")
        width, height, bpp = int(match[1]), int(match[2]), int(match[3])
        if width == 0 or height == 0:
            continue
        data = open(path, "rb").read()
        write_png(path[:-4] + ".png", to_rgb_rows(data, width, height, bpp), width, height)


if __name__ == "__main__":
    main()
