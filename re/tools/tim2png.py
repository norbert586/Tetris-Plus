#!/usr/bin/env python3
"""Render the TIM images in a Tetris Plus data file, for inventory and visual identification.

Each TIM is checked for internal consistency (block lengths add up to the decoded size). Pixels
are expanded from 15-bit colour the way the PS1 video DAC does; colour 0x0000 is drawn as
transparent, as the GPU does for textured primitives. TIMs with several CLUT rows are drawn
with row 0. This is a survey tool; the faithful web decoders come in Phase 7.

Usage:
    tim2png.py sheet PROGRAM.EXE DATA.BIN OUT.png [FIRST LAST]
        contact sheet of items FIRST..LAST (default all), labelled with their index
    tim2png.py extract PROGRAM.EXE DATA.BIN OUT_DIR
        one PNG per item (NNNN.png)
"""

import os
import struct
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tpbin import find_table, items  # noqa: E402


def expand(c):
    return (c << 3) | (c >> 2)


def color(value):
    if value == 0:
        return (0, 0, 0, 0)
    return (expand(value & 31), expand(value >> 5 & 31), expand(value >> 10 & 31), 255)


def parse_tim(blob):
    """Return a dict describing the TIM; raises ValueError if its blocks don't add up."""
    magic, flags = struct.unpack_from("<II", blob, 0)
    if magic != 0x10:
        raise ValueError("not a TIM")
    bpp = {0: 4, 1: 8, 2: 16, 3: 24}[flags & 3]
    tim, pos = {"bpp": bpp, "clut": None}, 8
    if flags & 8:
        length, x, y, w, h = struct.unpack_from("<I4H", blob, pos)
        tim["clut"] = {"x": x, "y": y, "w": w, "h": h,
                       "colors": struct.unpack_from(f"<{w * h}H", blob, pos + 12)}
        if length != 12 + w * h * 2:
            raise ValueError(f"CLUT block length {length} != {12 + w * h * 2}")
        pos += length
    length, x, y, w, h = struct.unpack_from("<I4H", blob, pos)
    if length != 12 + w * h * 2:
        raise ValueError(f"image block length {length} != {12 + w * h * 2}")
    if pos + length != len(blob):
        raise ValueError(f"TIM ends at {pos + length}, item is {len(blob)} bytes")
    tim.update({"x": x, "y": y, "hw": w, "h": h, "pixels": blob[pos + 12:pos + length]})
    tim["w"] = {4: w * 4, 8: w * 2, 16: w, 24: w * 2 // 3}[bpp]
    return tim


def to_image(tim):
    img = Image.new("RGBA", (tim["w"], tim["h"]))
    px, raw = img.load(), tim["pixels"]
    palette = tim["clut"]["colors"] if tim["clut"] else None
    for y in range(tim["h"]):
        for x in range(tim["w"]):
            if tim["bpp"] == 4:
                byte = raw[y * tim["hw"] * 2 + x // 2]
                px[x, y] = color(palette[byte >> 4 * (x & 1) & 15])
            elif tim["bpp"] == 8:
                px[x, y] = color(palette[raw[y * tim["hw"] * 2 + x]])
            elif tim["bpp"] == 16:
                px[x, y] = color(struct.unpack_from("<H", raw, (y * tim["hw"] + x) * 2)[0])
            else:
                o = y * tim["hw"] * 2 + x * 3
                px[x, y] = (raw[o], raw[o + 1], raw[o + 2], 255)
    return img


def load(exe_path, bin_path):
    exe, data = open(exe_path, "rb").read(), open(bin_path, "rb").read()
    _, offsets = find_table(exe, data)
    return [parse_tim(blob) for _, _, blob, _ in items(data, offsets)]


def sheet(tims, first, last, out_path, max_width=1600):
    cells = [(i, to_image(tims[i])) for i in range(first, last + 1)]
    x = y = row_h = 0
    placed = []
    for index, img in cells:
        w, h = max(img.width, 40), img.height + 10
        if x + w > max_width:
            x, y, row_h = 0, y + row_h + 4, 0
        placed.append((index, img, x, y))
        x, row_h = x + w + 4, max(row_h, h)
    canvas = Image.new("RGBA", (max_width, y + row_h + 4), (60, 60, 80, 255))
    draw = ImageDraw.Draw(canvas)
    for index, img, x, y in placed:
        draw.text((x, y), str(index), fill=(255, 255, 0, 255))
        canvas.alpha_composite(img, (x, y + 10))
    canvas.save(out_path)


def main():
    if len(sys.argv) < 5 or sys.argv[1] not in ("sheet", "extract"):
        sys.exit(__doc__)
    tims = load(sys.argv[2], sys.argv[3])
    if sys.argv[1] == "sheet":
        first, last = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (0, len(tims) - 1)
        sheet(tims, first, last, sys.argv[4])
    else:
        os.makedirs(sys.argv[4], exist_ok=True)
        for index, tim in enumerate(tims):
            to_image(tim).save(os.path.join(sys.argv[4], f"{index:04d}.png"))


if __name__ == "__main__":
    main()
