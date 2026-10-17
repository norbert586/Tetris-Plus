#!/usr/bin/env python3
"""Summarise a VAB sound bank header (.VH) and check it against its body (.VB).

Layout (PsyQ libsnd): a 32-byte header ("pBAV", version, id, file size, program/tone/VAG
counts, master volume and pan), 128 program records of 16 bytes, 16 tone records of 32 bytes
for each used program, then 256 u16 VAG sizes in units of 8 bytes (entry 0 unused).

Usage: vab_info.py EF.VH EF.VB
"""

import struct
import sys


def main():
    vh, vb = open(sys.argv[1], "rb").read(), open(sys.argv[2], "rb").read()
    magic, version, vab_id, fsize, _, ps, ts, vs, mvol, pan = struct.unpack_from("<4sIIIHHHHBB", vh, 0)
    assert magic == b"pBAV", magic
    print(f"VAB version {version}, id {vab_id}, total size {fsize} (VH {len(vh)} + VB {len(vb)} = {len(vh) + len(vb)})")
    print(f"programs {ps}, tones {ts}, VAG samples {vs}, master volume {mvol}, pan {pan}")
    tones_at = 32 + 128 * 16
    sizes_at = tones_at + ps * 16 * 32
    sizes = [s * 8 for s in struct.unpack_from("<256H", vh, sizes_at)]
    print(f"VAG bytes listed {sum(sizes)} vs VB {len(vb)}; header ends at {sizes_at + 512} of {len(vh)}")
    program_index = 0
    for program in range(128):
        tone_count, pvol, prior, mode, ppan = struct.unpack_from("<BBBBB", vh, 32 + program * 16)
        if tone_count == 0:
            continue
        tones = []
        for t in range(tone_count):
            o = tones_at + (program_index * 16 + t) * 32
            prior_t, mode_t, vol, tpan, center, shift, mn, mx = struct.unpack_from("<8B", vh, o)
            adsr1, adsr2, prog, vag = struct.unpack_from("<HHhh", vh, o + 16)
            tones.append(f"vag{vag}(key {mn}-{mx}, centre {center}+{shift}/128, vol {vol}, pan {tpan}, "
                         f"ADSR {adsr1:04x}/{adsr2:04x}, mode {mode_t})")
        print(f"program {program:3d}: vol {pvol} pan {ppan} prio {prior}; " + "; ".join(tones))
        program_index += 1


if __name__ == "__main__":
    main()
