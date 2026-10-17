#!/usr/bin/env python3
"""Puzzle Mode password codec, transcribed from PAZLE.EXE (docs/spec/password.md).

  encode: FUN_800b401c (value) + FUN_800b3f28 (symbols)
  decode: FUN_800b3ad8, after the entry screen FUN_800b37c4 collects six symbols 0..7

A password is six symbols, each 0..7, shown left to right. Symbol 7 is drawn as a blank.

Usage:
  tp_password.py encode ZONES_CLEARED ZONE STAGE   (stage 0..19)
  tp_password.py decode S0 S1 S2 S3 S4 S5
  tp_password.py selftest
"""

import sys

XOR = 0x2AAA


def _popcount14(value):
    return bin(value & 0x3FFF).count("1")


def encode_value(zones_cleared, zone, stage):
    value = zones_cleared
    if zones_cleared != 0x1F:
        value |= zone << 5
        value |= (stage % 20) << 8
    value |= _popcount14(value) << 14
    return value ^ XOR


def to_symbols(value):
    return [(value >> (3 * (5 - k))) & 7 for k in range(6)]


def encode(zones_cleared, zone, stage):
    return to_symbols(encode_value(zones_cleared, zone, stage))


def decode(symbols):
    """Returns (zones_cleared, zone, stage) or None when the game rejects the password."""
    value = 0
    for s in symbols:
        value = (value << 3) | (s & 7)
    value ^= XOR
    zones_cleared = value & 0x1F
    zone = (value >> 5) & 7
    stage = (value >> 8) & 0x3F
    if (value >> 14) & 0xF != _popcount14(value):
        return None
    if zone >= 5 or stage >= 20:
        return None
    if zones_cleared & 0x10 and zones_cleared != 0x1F:
        return None
    if zones_cleared == 0x1F and (zone or stage):
        return None
    return zones_cleared, zone, stage


def table():
    """Every password the game accepts, with what it loads."""
    rows = []
    for symbols_value in range(1 << 18):
        symbols = to_symbols(symbols_value)
        result = decode(symbols)
        if result:
            rows.append({"symbols": "".join(map(str, symbols)), "zones_cleared": result[0],
                         "zone": result[1], "stage": result[2]})
    return {
        "source": {"decode": "0x800b3ad8", "encode": "0x800b401c", "xor": hex(XOR)},
        "symbols": "six symbols 0..7, left to right; 7 is drawn blank",
        "accepted": rows,
    }


def selftest():
    accepted = table()["accepted"]
    seen = {(r["zones_cleared"], r["zone"], r["stage"]) for r in accepted}
    assert len(seen) == len(accepted), "two passwords load the same state"
    for zc in range(32):
        for zone in range(5):
            for stage in range(20):
                symbols = encode(zc, zone, stage)
                got = decode(symbols)
                if zc == 0x1F:
                    assert got == (0x1F, 0, 0), (zc, zone, stage, got)
                elif zc & 0x10:
                    assert got is None, (zc, zone, stage, got)
                else:
                    assert got == (zc, zone, stage), (zc, zone, stage, got)
    print(f"ok: {len(accepted)} accepted passwords, every encodable state round-trips")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], [int(a, 0) for a in sys.argv[2:]]
    if cmd == "encode":
        print("".join(map(str, encode(*args))))
    elif cmd == "decode":
        print(decode(args))
    elif cmd == "selftest":
        selftest()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
