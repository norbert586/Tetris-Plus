#!/usr/bin/env python3
"""List the files in the disc's data track with their start sector (LBA), size and XA attributes.

Reads the ISO 9660 root directory straight from the MODE2/2352 track image. The LBA is what a
program passes to CdlSetloc (through CdIntToPos) when it reads a file by position, so this
listing lets the inventory match CD reads in code or emulator logs back to files.

Usage: iso_listing.py TRACK01.bin           (prints a Markdown table)
"""

import struct
import sys

SECTOR = 2352
USER_OFFSET = 24  # sync (12) + header (4) + XA subheader (8)


def read_sector(image, lba):
    image.seek(lba * SECTOR + USER_OFFSET)
    return image.read(2048)


def main():
    with open(sys.argv[1], "rb") as image:
        pvd = read_sector(image, 16)
        assert pvd[1:6] == b"CD001", "no primary volume descriptor"
        root_lba, root_size = struct.unpack_from("<I", pvd, 156 + 2)[0], struct.unpack_from("<I", pvd, 156 + 10)[0]
        volume_sectors = struct.unpack_from("<I", pvd, 80)[0]
        print(f"Volume space: {volume_sectors} sectors\n")
        print("| File | LBA | Sectors | Bytes | XA attributes | Kind |")
        print("|---|---|---|---|---|---|")
        entries = []
        for i in range((root_size + 2047) // 2048):
            block = read_sector(image, root_lba + i)
            pos = 0
            while pos < 2048 and block[pos]:
                length = block[pos]
                lba, size = struct.unpack_from("<I", block, pos + 2)[0], struct.unpack_from("<I", block, pos + 10)[0]
                name_len = block[pos + 32]
                name = block[pos + 33:pos + 33 + name_len].decode("ascii", "replace")
                system_use = block[pos + 33 + name_len + (name_len + 1) % 2:pos + length]
                attrs = struct.unpack_from(">H", system_use, 4)[0] if system_use[6:8] == b"XA" else 0
                if name not in ("\x00", "\x01"):
                    entries.append((lba, name.split(";")[0], size, attrs))
                pos += length
        for lba, name, size, attrs in sorted(entries):
            kind = "CD-DA" if attrs & 0x4000 else "Mode 2 Form 2 / interleaved" if attrs & 0x3000 else "Mode 2 Form 1"
            sectors = size // SECTOR if attrs & 0x4000 else (size + 2047) // 2048
            print(f"| `{name}` | {lba} | {sectors} | {size} | `{attrs:#06x}` | {kind} |")


if __name__ == "__main__":
    main()
