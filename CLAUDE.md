# Tetris Plus (PS1) Puzzle Mode → web

A faithful browser version of Tetris Plus's Puzzle Mode (the professor mode), rebuilt from the
original PS1 game (US, SLUS-00338) and verified against it in an emulator.

- **Plan:** `docs/RESEARCH_AND_PLAN.md` (phases, fidelity rules, verification layers, ground rules).
- **Latest results:** `docs/re/disc-inventory.md` (Phase 1). Earlier: `docs/re/phase0.md`.
- **Repo:** private; extracted web-ready assets may be committed. Never commit the disc image or
  bulky raw dumps.

## Setting up a session for reverse-engineering work

1. Install the pinned tools:
   `bash scripts/setup-toolchain.sh`, then `source /opt/tp-tools/env.sh`.
2. Find the disc archive in the connected Google Drive: search for the title `Tetris Plus.7z`
   and take its file ID.
3. Fetch the disc:
   `bash scripts/fetch-disc.sh <file-id>`.
   - The image lands in `../tp-private/disc` and the data-track files in `../tp-private/files`.
   - Both are outside the repo; keep game data there.

## Common commands

- **Wrap Puzzle Mode for REA:**
  `python3 re/tools/psxexe2elf.py ../tp-private/work/PAZLE.elf ../tp-private/files/SLUS_003.38 ../tp-private/files/PAZLE.EXE`
- **Run REA** (CLI; each call re-imports, about 35 s):
  `REA_GHIDRA_SEED_FILE=$PWD/re/symbols/PAZLE.seeds.tsv $TP_REA decompile <abs path to PAZLE.elf> 0x800963b0 --provider ghidra --json`
  - Leave `REA_GHIDRA_LANGUAGE_ID` unset. REA refuses the PSX language for MIPS targets.
- **Re-export library names** after changing ghidra_psx_ldr:
  `$GHIDRA_INSTALL_DIR/support/analyzeHeadless <dir> <name> -import <exe> -loader PsxLoader -scriptPath re/ghidra -postScript ExportFunctionNames.java re/symbols/<exe>.tsv -deleteProject`
  - Then rebuild the seeds with `re/tools/make_seeds.py`.
- **Run the original game headless:**
  `TP_FRAMES=600 bash scripts/run-emulator.sh re/lua/smoke.lua ../tp-private/runs/<name>`
  - Convert the screenshots with `python3 re/tools/shot2png.py <dir>/*.raw`.
  - To trace CD reads and music, add `TP_CD_HOOKS=$PWD/re/lua/cd_hooks.txt`, then run
    `python3 re/tools/cd_trace.py <dir>/run.log "../tp-private/disc/Tetris Plus.cue" "../tp-private/disc/Tetris Plus (Track 01).bin"`.
- **Decompile a whole EXE to one greppable file** (real PSX loader and PsyQ names; absolute paths):
  `$GHIDRA_INSTALL_DIR/support/analyzeHeadless /home/user/tp-private/work/ghidra p -import /home/user/tp-private/files/PAZLE.EXE -loader PsxLoader -scriptPath re/ghidra -postScript ExportDecompiled.java /home/user/tp-private/work/decomp/PAZLE.EXE.c -deleteProject`
- **Data files (`*.BIN`):** `python3 re/tools/tpbin.py list|extract <PROGRAM.EXE> <DATA.BIN> [out]`.
  Render them with `python3 re/tools/tim2png.py sheet|extract <PROGRAM.EXE> <DATA.BIN> <out>`.
