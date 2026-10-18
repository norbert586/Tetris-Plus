#!/usr/bin/env python3
"""Print the GPU packets of a PAZLE.EXE frame from a main-RAM dump.

PAZLE.EXE builds each frame's display list with libgs: two GsOT headers at 0x800ED2F4 (20 bytes
each: length, org, offset, point, tag), one per buffer, and packets in state+0x206E4 + buffer *
13000. GsDrawOt(ot) sends the chain that starts at ot->tag, after GsSortClear has put its clear
packet at the head. A dump taken at the oracle's sample point (re/lua/movie.lua TP_VRAM_AT or
TP_RAM_AT) holds the frame just drawn in the buffer given by 0x800EE484 (GsGetActiveBuff's
result for that tick) and the previous frame in the other.

Each packet is printed as one line: its RAM address, then the GP0 commands it holds, decoded.

Usage:
    otdump.py RAM.bin [--buffer 0|1] [--raw]
        --buffer   which ordering table (default: the one 0x800EE484 names)
        --raw      also print every packet's words in hex
"""

import argparse
import struct

OT_HEADERS = 0x800ED2F4
ACTIVE_BUFF = 0x800EE484


def u32(ram, address):
    return struct.unpack_from("<I", ram, address & 0x1FFFFF)[0]


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def s11(v):
    v &= 0x7FF
    return v - 0x800 if v & 0x400 else v


def xy(word):
    return f"({s11(word)},{s11(word >> 16)})"


def uv(word):
    return f"uv({word & 0xFF},{word >> 8 & 0xFF})"


def clut(word):
    c = word >> 16
    return f"clut({(c & 0x3F) * 16},{c >> 6 & 0x1FF})"


def tpage_text(t):
    return (f"tpage(x{(t & 0xF) * 64},y{(t >> 4 & 1) * 256},abr{t >> 5 & 3},"
            f"{['4bit', '8bit', '15bit', 'res'][t >> 7 & 3]})")


def rgb(word):
    return f"rgb({word & 0xFF},{word >> 8 & 0xFF},{word >> 16 & 0xFF})"


def decode(words):
    """Decode a list of GP0 words into text, one command after another."""
    out, i = [], 0
    while i < len(words):
        w = words[i]
        op = w >> 24
        flags = ("semi " if op & 2 else "") + ("raw " if op & 1 else "")
        if op == 0x02:
            out.append(f"FILL {rgb(w)} at {xy(words[i + 1])} size {xy(words[i + 2])}")
            i += 3
        elif op & 0xE0 == 0x20:  # polygon
            quad, textured, gouraud = op & 8, op & 4, op & 0x10
            n = 4 if quad else 3
            parts, j = [f"POLY{'F' if not gouraud else 'G'}{'T' if textured else ''}{n} {flags}{rgb(w)}"], i + 1
            for k in range(n):
                if gouraud and k > 0:
                    parts.append(rgb(words[j]))
                    j += 1
                parts.append(xy(words[j]))
                j += 1
                if textured:
                    extra = clut(words[j]) if k == 0 else (tpage_text(words[j] >> 16) if k == 1 else "")
                    parts.append(uv(words[j]) + (" " + extra if extra else ""))
                    j += 1
            out.append(" ".join(parts))
            i = j
        elif op & 0xE0 == 0x60:  # rectangle
            size = op >> 3 & 3
            textured = op & 4
            parts, j = [f"RECT{['var', '1', '8', '16'][size]}{'T' if textured else ''} {flags}{rgb(w)} at {xy(words[i + 1])}"], i + 2
            if textured:
                parts.append(uv(words[j]) + " " + clut(words[j]))
                j += 1
            if size == 0:
                parts.append(f"size ({words[j] & 0xFFFF},{words[j] >> 16})")
                j += 1
            out.append(" ".join(parts))
            i = j
        elif op == 0xE1:
            out.append(f"MODE {tpage_text(w & 0x1FF)}{' dither' if w & 0x200 else ''}"
                       f"{' drawdisp' if w & 0x400 else ''}{' xflip' if w & 0x1000 else ''}{' yflip' if w & 0x2000 else ''}")
            i += 1
        elif op == 0xE2:
            out.append(f"TEXWIN {w & 0xFFFFF:#x}")
            i += 1
        elif op == 0xE3:
            out.append(f"AREA_TL ({w & 0x3FF},{w >> 10 & 0x3FF})")
            i += 1
        elif op == 0xE4:
            out.append(f"AREA_BR ({w & 0x3FF},{w >> 10 & 0x3FF})")
            i += 1
        elif op == 0xE5:
            out.append(f"OFFSET ({s11(w)},{s11(w >> 11)})")
            i += 1
        elif op == 0xE6:
            out.append(f"MASK {w & 3}")
            i += 1
        elif op == 0x00:
            i += 1
        else:
            out.append(f"?{w:08x}")
            i += 1
    return out


def walk(ram, tag):
    """Yield (address, words) for each packet of the chain starting at tag."""
    address, seen = tag & 0xFFFFFF, 0
    while address != 0xFFFFFF:
        head = u32(ram, address)
        n = head >> 24
        yield address, [u32(ram, address + 4 * (k + 1)) for k in range(n)]
        address = head & 0xFFFFFF
        seen += 1
        if seen > 100000:
            raise RuntimeError("ordering table loops")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ram")
    ap.add_argument("--buffer", type=int)
    ap.add_argument("--raw", action="store_true")
    a = ap.parse_args()
    ram = open(a.ram, "rb").read()
    buf = a.buffer if a.buffer is not None else u32(ram, ACTIVE_BUFF) & 0xFFFF
    header = OT_HEADERS + 20 * buf
    length, org, offset, point, tag = struct.unpack_from("<5I", ram, header & 0x1FFFFF)
    print(f"# buffer {buf}: GsOT length {length} org {org:#x} offset {offset} point {point} tag {tag:#x}")
    for address, words in walk(ram, tag):
        if not words:
            continue
        for k, text in enumerate(decode(words)):
            print(f"{address:08x} {text}" if k == 0 else f"         {text}")
        if a.raw:
            print("         " + " ".join(f"{w:08x}" for w in words))


if __name__ == "__main__":
    main()
