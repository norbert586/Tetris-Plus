# Puzzle Mode specification (Phase 4)

This folder is the specification the TypeScript port (Phase 6) is written against. Each page
covers one subsystem: what the original does, in the order it does it, with the integer
arithmetic it uses. Quirks are part of the spec and are marked **Quirk**.

| Page | Covers |
|---|---|
| [frame.md](frame.md) | One frame of play: update order, the play step machine, timings, `rand()` order |
| [piece.md](piece.md) | Shapes, spawn, input and auto-repeat, rotation, gravity, lock, collision |
| [lines.md](lines.md) | Full-row detection, the clear animation, row removal, score |
| [ceiling.md](ceiling.md) | Ceiling timer and drops, shake, pushback, crushing |
| [professor.md](professor.md) | The professor: states, animation-script machine, sensors, decision rules, win and loss |
| [stages.md](stages.md) | Stage data, stage start, stage clock and best times, stage clear and advance |
| [password.md](password.md) | Password codec |
| [ledger.md](ledger.md) | Every mechanic with its evidence, owner module and verifier |

## Extracted data

`docs/spec/data/` holds every gameplay table, read straight out of `PAZLE.EXE` by
`re/tools/extract_spec.py`. Nothing in them is typed by hand.

| File | Contents |
|---|---|
| `pieces.json` | The 7 shapes × 4 rotations (5×5 grids), block image per board value |
| `rules.json` | Level table (31 entries), preview table, preview positions, ceiling intervals (4 × 50), shake, pushback, debris directions, default settings |
| `stages.json` | All 100 stages: professor start cell and facing, the 15 × 10 layout, art items |
| `professor.json` | Sensor offsets and all 39 animation scripts, decoded |
| `passwords.json` | Every password the game accepts (1,601) and what it loads |

To regenerate (after `scripts/fetch-disc.sh`):

```
python3 re/tools/extract_spec.py ../tp-private/files/PAZLE.EXE docs/spec/data
python3 re/tools/tp_password.py selftest
```

## Conventions

- **Per player.** Gameplay state is per player; addresses are player 1's (player 2's is 4 bytes
  later unless a stride is given). In one-player play only player 1's state matters, but player
  2's idle screen still runs and still calls `rand()` ([frame.md](frame.md)).
- **Positions** are 16.16 fixed point in pixels from the playfield's top-left. A cell is 10 px.
  A cell index is `(value >> 16) / 10` with C division (truncates toward zero). All piece and
  professor positions are whole multiples of 10 px, so truncation never matters in practice.
- **Board** `int[21][10]`, index `row * 10 + col`. Rows 0–15 are used.
- **Evidence.** S = read in the decompiled code (function names from `re/symbols/PAZLE.game.tsv`),
  E = measured in the emulator (Phase 3 runs unless stated), D = table read from the EXE.
- Names in `code font` are functions or variables from `re/symbols/`. Addresses are RAM
  addresses in `PAZLE.EXE`.

## Phase 3 questions answered here

1. `prof_think`'s full decision table and every action's script: [professor.md](professor.md).
2. Stage records' remaining fields and the zone → record table: [stages.md](stages.md) §1. The
   index table is the identity (stage n uses record n); the unknown fields are two art items.
3. `lines_remove`'s second pass: [lines.md](lines.md) §4.
4. `0x800B58E8`: draws the stage's best time on the HUD. No gameplay effect.
5. Option settings: [piece.md](piece.md) §4 and [ceiling.md](ceiling.md) §1. Puzzle Mode only
   reads them; their defaults are in `rules.json`. The screen that changes them is outside
   `PAZLE.EXE` (open question in [ledger.md](ledger.md)).
