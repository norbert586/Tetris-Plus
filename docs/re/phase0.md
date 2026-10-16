# Phase 0 results: toolchain and first contact (2026-10-16)

Every Phase 0 exit criterion is met:

- The disc image is verified.
- The pinned toolchain installs from scratch with `scripts/setup-toolchain.sh`.
- REA analyses Puzzle Mode with the PsyQ library functions named.
- The original game runs headless in PCSX-Redux under Lua control, all the way into Puzzle Mode
  gameplay.

## Toolchain (pinned in `scripts/setup-toolchain.sh`)

| Tool | Version | Notes |
|---|---|---|
| Ghidra | 12.1.4 (`ghidra_12.1.4_PUBLIC_20260921.zip`) | Uses the container's OpenJDK 21 |
| ghidra_psx_ldr | commit `3050da6`, signatures `e9e46e7` | Built with Gradle and installed into `Ghidra/Extensions` |
| REA | `rea-agents` 6.5.0 | CLI at `$TP_REA`; also usable as an MCP server |
| mkpsxiso / dumpsxiso | v2.30 | Built from source without FLAC |
| PCSX-Redux | dev build 435 (`1644434`) | Unpacked AppImage; bundled OpenBIOS, so no Sony BIOS needed |

## Disc and program layout

- **Programs:** `SLUS_003.38` is the boot program, loaded at `0x80022000`–`0x8003E800` and kept
  resident. Every mode program (`*.EXE`) loads into one shared slot at `0x80094000`.
- **Puzzle Mode:** `PAZLE.EXE` occupies `0x80094000`–`0x800ED800`. Its startup code clears its
  variables up to `0x800F3704`, then calls `main` at `0x800963B0`.
- **No small-data area:** `gp0` is 0 in every header, so code doesn't use the global pointer for
  small variables.
- **Boot chain observed in the emulator** (frame numbers from power-on, fast boot):

| Frame | Program loaded | Screen |
|---|---|---|
| 543 | `JLOGO.EXE` | Jaleco logo video |
| 1025 | `SW_ON.EXE` | Startup screens |
| 2051 | `TIT_DEMO.EXE` | Title demo |
| 2504 | `TITLE.EXE` | Title |
| 2994 | `SELECT.EXE` | "Select Mode": Classic, Puzzle, VS, Edit, Option |
| 4160 | `PAZLE.EXE` | Puzzle Mode |

  "Now Loading…" screens sit between programs.
- **Display:** 320×240 at 16 bits per pixel on every screen seen so far; the logo video switches to
  24-bit.

## REA on Puzzle Mode

- **Wrapper:** `re/tools/psxexe2elf.py` maps `SLUS_003.38` and `PAZLE.EXE` at their real addresses
  in one ELF. The rest of main RAM, the scratchpad and the I/O window are mapped as zero-filled
  segments.
- **Language override refused.** REA 6.5.0 rejects `REA_GHIDRA_LANGUAGE_ID=PSX:LE:32:default` for
  MIPS targets: an override must equal its pinned `MIPS:LE:32:default`.
- **Fallback in use:** Ghidra's built-in MIPS32 decoder. Game logic is integer code, so the only
  loss is GTE (3D maths) instruction readability.
- **Result:** 1,254 procedures and 222 strings. Decompilation is readable.
- **Library names:** `re/ghidra/ExportFunctionNames.java` runs after ghidra_psx_ldr's real PSX
  loader and PsyQ signature pass. `re/tools/make_seeds.py` merges the exports into
  `re/symbols/PAZLE.seeds.tsv` for `REA_GHIDRA_SEED_FILE`, with Puzzle Mode's copies keeping the
  plain names.
  - REA applied 1,406 of 1,408 seeds.
  - In `PAZLE.EXE`, 722 functions are PsyQ library code: 385 have specific names and 337 are only
    attributed to a library module.
  - Named functions include `VSync`, `DrawSync`, `GsSortSprite`, `GsSortFastSprite`, `GsDrawOt`,
    `LoadImage`, `PadRead`, `rand`, `SsUtKeyOn`, `SsVabOpenHead`, `CdControl`, `CdRead` and
    `_card_info`.
  - Treat names of very small functions as hints until verified.
- **Libraries:** the strings show PsyQ libgpu `sys.c` 1.120 (1996-05-01) and libcd `bios.c` 1.77
  (1996-05-13). The game draws through libgs, Sony's sprite/ordering-table layer.

`main` (`0x800963B0`) is a per-frame loop until `*(state + 0x1fcf4)` becomes non-zero. `state`
is the pointer passed in from the boot program. Each frame it:

1. Increments a frame counter at `state + 0x40`.
2. Swaps the libgs double buffers (13,000 bytes of packet space per buffer at `state + 0x206e4`).
3. Calls the game update functions.
4. Calls `DrawSync(0)` then `VSync(0)` (storing the result at `state + 0x1fd14`).
5. Draws the ordering table.
6. **Calls `rand()` once every frame.** The RNG advances even when nothing random is needed, so a
   faithful port must do the same.

## Emulator control

`scripts/run-emulator.sh` runs `re/lua/smoke.lua` headless (`-cli -interpreter -fastboot`). The
script:

- taps buttons on a schedule (`TP_TAP`, `TP_INPUTS`);
- logs program changes in the shared slot;
- saves screenshots (convert them with `re/tools/shot2png.py`);
- dumps the 2 MB of main RAM at the end.

What we learned:

- **Speed:** runs are throttled to real time (about 60 frames per second).
- **Input during fades is ignored.** On "Select Mode", RIGHT at frame 3300 had no effect while the
  menu faded in; RIGHT at frame 3400 worked.
- **This input script reaches Egypt stage 1 gameplay by frame ~9600:**
  `TP_TAP=START:300:3000:90`; `RIGHT` at 3400; `CROSS` at 3500 and 3700; then `CROSS` every 120
  frames from 4200.

**Puzzle Mode flow seen so far:**

1. Puzzle Mode menu: New Game, Continue, Password. The right half of the screen is player 2's,
   with "Press Start".
2. World map, with the assistant's dialogue: "Here! Egypt looks like a good choice."
3. Story scene: "The famous pyramid of Egypt!"
4. Stage gameplay. The playfield is on the left half, inside an Egyptian stone frame. Visible
   elements:
   - a spiked ceiling hanging from a chain marked "1"
   - "NEXT" preview, "1P SCORE", "BEST TIME" (999.9) and "TIME" in tenths of a second
   - the "GOAL" marker at the bottom
   - the professor at the bottom left

## Next: Phase 1 (disc inventory)

- Identify the container format of the `*E.BIN` data files (`PAZLEE.BIN` first) from the code that
  loads them.
- Map which of the 51 CD audio tracks each screen plays, including the same-length track pairs.
- List the TIM images and VAB sound banks, and where each is loaded in RAM or VRAM.
- Start the RAM map from the gameplay dump: playfield, piece, queue, professor, ceiling, timers.
