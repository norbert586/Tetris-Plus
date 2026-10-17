#!/usr/bin/env python3
"""Extract Puzzle Mode's gameplay tables from PAZLE.EXE into JSON (Phase 4).

Every table is read straight out of the EXE at the address the game's code uses; nothing is
typed in by hand. docs/spec/*.md explains what each field means and which function reads it.

Usage:
  extract_spec.py PAZLE.EXE OUTDIR

Writes OUTDIR/{pieces,rules,stages,professor,passwords}.json. The output is deterministic, so
re-running on the same EXE gives byte-identical files.
"""

import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tp_password  # noqa: E402

HEADER = 0x800


class Exe:
    def __init__(self, path):
        data = open(path, "rb").read()
        if data[:8] != b"PS-X EXE":
            sys.exit(f"{path}: not a PS-X EXE")
        self.base, size = struct.unpack_from("<II", data, 0x18)
        self.text = data[HEADER:HEADER + size]

    def s32(self, address, count=None):
        if count is None:
            return struct.unpack_from("<i", self.text, address - self.base)[0]
        return list(struct.unpack_from(f"<{count}i", self.text, address - self.base))

    def u32(self, address):
        return struct.unpack_from("<I", self.text, address - self.base)[0]

    def s16(self, address):
        return struct.unpack_from("<h", self.text, address - self.base)[0]

    def u8(self, address, count):
        offset = address - self.base
        return list(self.text[offset:offset + count])


def fx(value):
    """16.16 fixed point to a number of pixels (all of these tables hold whole pixels)."""
    assert value % 0x10000 == 0, hex(value)
    return value // 0x10000


# ---- pieces --------------------------------------------------------------------------------

SHAPES = 0x800D5544          # int[8 kinds][4 rotations][5][5]
BLOCK_IMAGES = 0x800E2A20    # image id per board value (piece_lock, FUN_800accec)
PIECE_NAMES = ["none", "I", "O", "T", "J", "L", "Z", "S"]


def pieces(exe):
    shapes = []
    for kind in range(8):
        rotations = []
        for rot in range(4):
            cells = exe.s32(SHAPES + kind * 400 + rot * 100, 25)
            rotations.append(["".join("#" if c else "." for c in cells[r * 5:r * 5 + 5]) for r in range(5)])
            assert all(c in (0, 1) for c in cells), (kind, rot, cells)
        shapes.append({"kind": kind, "name": PIECE_NAMES[kind], "rotations": rotations})
    return {
        "source": {"shapes": hex(SHAPES), "block_images": hex(BLOCK_IMAGES)},
        "grid": "5x5; row strings top to bottom, '#' = solid. Index [kind][rot]; rot 0 is the spawn rotation",
        "kinds": shapes,
        "block_image_by_board_value": [exe.s32(BLOCK_IMAGES + 4 * v) for v in range(9)],
    }


# ---- rules: level table, queue, ceiling, line clears, debris ---------------------------------

LEVELS = 0x800D61C4          # {gravity, lock, score 1..4 lines} x 31, stride 0x18
QUEUE_TABLE = 0x80094720     # int[16]
NEXT_POS = 0x80094760        # per player: next1 (x, y), next2 (x, y)
CEIL_INTERVALS = 0x800D74EC  # int[4 difficulties][50]
CEIL_SHAKE = 0x8009478C      # int[2] fx
PUSHBACK = 0x8009438C        # fx for 1..4 lines (index 0 of the stack copy is never read)
DEBRIS_VEL = 0x80094794      # 8 x {vx, vy} fx
DEBRIS_IMG = 0x800947D4      # item per board value 1..8
SETTINGS_DEFAULT = 0x800E361C  # 24 bytes copied to state+0x4B4EC by best_times_reset


def rules(exe):
    levels = []
    for i in range(31):
        g, lock, *score = exe.s32(LEVELS + i * 0x18, 6)
        levels.append({"gravity": g, "lock": lock, "score": score})
    settings = exe.u8(SETTINGS_DEFAULT, 24)
    return {
        "source": {
            "levels": hex(LEVELS), "queue_table": hex(QUEUE_TABLE), "next_positions": hex(NEXT_POS),
            "ceiling_intervals": hex(CEIL_INTERVALS), "ceiling_shake": hex(CEIL_SHAKE),
            "pushback": hex(PUSHBACK), "debris_velocity": hex(DEBRIS_VEL),
            "debris_items": hex(DEBRIS_IMG), "settings_default": hex(SETTINGS_DEFAULT),
        },
        "levels": levels,
        "queue_table": exe.s32(QUEUE_TABLE, 16),
        "next_positions_px": [
            {"next1": [fx(v) for v in exe.s32(NEXT_POS + p * 16, 2)],
             "next2": [fx(v) for v in exe.s32(NEXT_POS + p * 16 + 8, 2)]}
            for p in range(2)
        ],
        "ceiling_intervals": [exe.s32(CEIL_INTERVALS + d * 200, 50) for d in range(4)],
        "ceiling_shake_px": [fx(v) for v in exe.s32(CEIL_SHAKE, 2)],
        "pushback_px_by_lines": {str(n): fx(exe.s32(PUSHBACK + 4 * (n - 1))) for n in range(1, 5)},
        "debris_velocity_px": [[v / 0x10000 for v in exe.s32(DEBRIS_VEL + 8 * i, 2)] for i in range(8)],
        "debris_item_by_board_value": {str(v): exe.s32(DEBRIS_IMG + 4 * (v - 1)) for v in range(1, 9)},
        "settings_default": {
            "bytes": settings,
            "rotate_ccw_mask": [struct.unpack_from("<I", bytes(settings), 0)[0],
                                struct.unpack_from("<I", bytes(settings), 4)[0]],
            "rotate_cw_mask": [struct.unpack_from("<I", bytes(settings), 8)[0],
                               struct.unpack_from("<I", bytes(settings), 12)[0]],
            "difficulty": settings[0x4B4FE - 0x4B4EC],
        },
    }


# ---- stages ---------------------------------------------------------------------------------

STAGE_INDEX = 0x800D780C     # int[zone*20 + stage] -> record
STAGE_RECORDS = 0x800D79EC   # 0x28 bytes each
LAYOUTS = 0x800D898C         # 150 bytes each: rows 1..15 x 10 columns


def stages(exe):
    out = []
    for n in range(100):
        record = exe.s32(STAGE_INDEX + 4 * n)
        a = STAGE_RECORDS + record * 0x28
        words = exe.s32(a, 10)
        assert words[0] == exe.s16(a + 2) << 16 and words[1] == exe.s16(a + 6) << 16, n
        assert words[3] == words[5] == words[6] == words[7] == 0, (n, words)
        layout = exe.u8(LAYOUTS + words[4] * 150, 150)
        out.append({
            "number": n + 1,
            "zone": n // 20,
            "stage": n % 20,
            "record": record,
            "professor": {"col": exe.s16(a + 2), "row": exe.s16(a + 6),
                          "facing": "left" if words[2] else "right"},
            "layout_index": words[4],
            "art": {"panel_item": words[8], "background_item": words[9]},
            "rows": ["".join(".12345678"[c] if c else "." for c in layout[r * 10:r * 10 + 10])
                     for r in range(15)],
        })
        assert all(0 <= c <= 8 for c in layout), n
    return {
        "source": {"index": hex(STAGE_INDEX), "records": hex(STAGE_RECORDS), "layouts": hex(LAYOUTS)},
        "rows": "board rows 1..15, top to bottom; '.' empty, digits = block value (colour). "
                "Row 0 is not stored (stage_load_layout writes from row 1)",
        "stages": out,
    }


# ---- professor ------------------------------------------------------------------------------

SCRIPTS = 0x800E0738         # pointer per action
SCRIPT_COUNT = 39
SENSORS = 0x800E27F0         # [facing][10] {dcol, drow}
OPCODES = {  # opcode: (name, size in bytes, argument names)
    0: ("end", 4, []),
    1: ("image", 24, ["image", "unread_8", "unread_c", "flip", "second_sprite"]),
    2: ("wait", 8, ["frames"]),
    3: ("move_cell", 12, ["dcol", "drow"]),
    4: ("jump", 8, ["words"]),
    5: ("sound", 8, ["se"]),
    6: ("nudge_px", 12, ["dx", "dy"]),
    7: ("hide", 12, ["keep_main", "unused"]),
}


def decode_script(exe, address):
    ops = []
    for _ in range(400):
        op = exe.s32(address)
        name, size, names = OPCODES[op]
        args = exe.s32(address + 4, size // 4 - 1) if size > 4 else []
        entry = {"op": name}
        if op == 1:
            # +0x08 and +0x0C are never read by the interpreter (0x800a0a24)
            entry.update(image=args[0], flip=args[3], second_sprite=args[4])
        else:
            entry.update(dict(zip(names, args)))
            entry.pop("unused", None)
        ops.append(entry)
        if op == 0:
            return ops
        if op == 4:
            entry["target"] = "restart" if args[0] == 0 else len(ops) - 1 + _jump_ops(exe, address, args[0])
            return ops
        address += size
    raise ValueError(f"script at {address:#x} does not end")


def _jump_ops(exe, address, words):
    """Turn a jump of `words` 4-byte words (relative to the jump) into a count of opcodes."""
    target = address + words * 4
    if words > 0:
        raise ValueError("forward jumps are not used")
    count, a = 0, target
    while a < address:
        a += OPCODES[exe.s32(a)][1]
        count += 1
    if a != address:
        # the jump lands inside an opcode's arguments; record the raw address instead
        return None
    return -count


def professor(exe):
    actions = []
    for i in range(SCRIPT_COUNT):
        ptr = exe.u32(SCRIPTS + 4 * i)
        actions.append({"action": i, "address": hex(ptr), "ops": decode_script(exe, ptr)})
    sensors = [[exe.s32(SENSORS + (f * 10 + k) * 8, 2) for k in range(10)] for f in range(2)]
    return {
        "source": {"scripts": hex(SCRIPTS), "sensors": hex(SENSORS), "interpreter": "0x800a07f4"},
        "sensors": {"right": sensors[0], "left": sensors[1],
                    "order": ["foot_below_0", "foot_below_1", "ahead_low", "ahead_high",
                              "self_low_0", "self_low_1", "self_high_0", "self_high_1",
                              "behind_low", "behind_high"]},
        "actions": actions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("exe")
    parser.add_argument("outdir")
    args = parser.parse_args()
    exe = Exe(args.exe)
    os.makedirs(args.outdir, exist_ok=True)
    outputs = {
        "pieces": pieces(exe),
        "rules": rules(exe),
        "stages": stages(exe),
        "professor": professor(exe),
        "passwords": tp_password.table(),
    }
    for name, value in outputs.items():
        path = os.path.join(args.outdir, name + ".json")
        with open(path, "w") as f:
            json.dump(value, f, indent=1)
            f.write("\n")
        print(path)


if __name__ == "__main__":
    main()
