# Tetris Plus (PS1) Puzzle Mode → web

A faithful browser version of Tetris Plus's Puzzle Mode (the professor mode), rebuilt from the
original PS1 game (US, SLUS-00338) and verified against it in an emulator.

- **Plan:** `docs/RESEARCH_AND_PLAN.md` (phases, fidelity rules, verification layers, ground rules).
- **Latest results:** `docs/re/core-port.md` (Phase 6: the TypeScript core in `web/src/core/`,
  which keeps game state at the original's addresses; golden-trace equality on every movie and
  Unicorn function tests, both under `npm test` in `web/`).
  `docs/re/oracle-harness.md` (Phase 5: input movies, the per-tick tracer, determinism checks,
  the movie corpus in `re/movies/` and its traces in `re/traces/`).
  `docs/spec/` (Phase 4: the gameplay specification, one page per subsystem, the mechanics ledger
  in `docs/spec/ledger.md`, every table extracted to `docs/spec/data/`).
  Earlier: `docs/re/ram-map.md` (Phase 3: every gameplay variable with its writer;
  machine-readable in `re/symbols/PAZLE.vars.tsv`), `docs/re/static-bootstrap.md`
  (Phase 2: main loop, screens; tree in `docs/re/dispatch-tree.txt`), `docs/re/disc-inventory.md`
  (Phase 1), `docs/re/phase0.md`.
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

- **The TypeScript core** (in `web/`; `npm install` first):
  - `npm test`: golden traces and Unicorn function tests. `npm run trace -- [MOVIE...]`: replays
    movies and prints the first difference with the original's trace. `npm run typecheck`.
  - Design a movie on the core before running it on the original:
    `npx tsx tools/simulate.ts ../re/movies/<name>.tpm [--to T] [--fields a,b]`.
  - Movies can poke memory after a tick (`poke TICK ADDRESS VALUE [SIZE]`) to set up a scenario;
    both the emulator and the core apply it.
  - Regenerate the core's data after a disc fetch:
    `python3 re/tools/extract_core_rom.py ../tp-private/files/PAZLE.EXE web/src/core/rom.ts`;
    boot defaults from a tick-1 RAM dump (`TP_RAM_AT=1`):
    `python3 re/tools/extract_boot_state.py <dir>/ram_00001.bin web/src/core/boot-state.ts`;
    Unicorn fixtures (needs `pip install unicorn capstone`):
    `python3 re/tools/unicorn_fixtures.py ../tp-private/files/PAZLE.EXE web/test/fixtures/unicorn`.

- **Play a movie on the original and trace it** (one row per logic tick; format and fields in
  `docs/re/oracle-harness.md`):
  `bash scripts/run-movie.sh re/movies/egypt1-idle.tpm ../tp-private/runs/<name>`
  - Read the trace: `python3 re/tools/tptrace.py events|rows|board|diff <dir>/trace.jsonl ...`
    (`re/traces/*.jsonl.gz` work too).
  - Start from a save state instead of booting (75 s saved): add `TP_SAVE_AT=<tick>` to one run,
    then `TP_LOAD=<dir>/state_<tick>.sstate` (the trace resumes at tick + 2). `TP_UNTIL='pieces>=5,scr!=5'`
    stops early; `TP_SHOTS=<ticks>` takes screenshots.
  - Determinism check (two runs, traces and RAM compared): `bash scripts/check-determinism.sh <movie> <out>`.
    Re-record every corpus trace: `bash scripts/record-corpus.sh`.
  - Build a movie that places pieces (closed loop with the emulator):
    `python3 re/tools/tpplan.py re/movies/plans/<scenario>.py`.
  - Don't run more than about 3 emulators at once.

- **Wrap Puzzle Mode for REA:**
  `python3 re/tools/psxexe2elf.py ../tp-private/work/PAZLE.elf ../tp-private/files/SLUS_003.38 ../tp-private/files/PAZLE.EXE`
  - The wrapper stores zero bytes for all non-code RAM. Don't go back to zero-filled segments:
    Ghidra maps those read-only and the decompiler folds every global in them to 0.
- **Run REA** (CLI; each call re-imports, about 35 s):
  `REA_GHIDRA_SEED_FILE=$PWD/re/symbols/PAZLE.seeds.tsv $TP_REA decompile <abs path to PAZLE.elf> 0x800963b0 --provider ghidra --json`
  - Leave `REA_GHIDRA_LANGUAGE_ID` unset. REA refuses the PSX language for MIPS targets.
- **Re-export function names** (after changing ghidra_psx_ldr or the pre-pass). Code ranges:
  `PAZLE.EXE` `0x800955d4 0x800d4fb0`, `SLUS_003.38` `0x80022200 0x80039a54`.
  `$GHIDRA_INSTALL_DIR/support/analyzeHeadless <dir> <name> -import <exe> -loader PsxLoader -scriptPath re/ghidra -postScript DefineTableFunctions.java <code start> <code end> <out>.ptr.tsv -postScript ExportFunctionNames.java $PWD/re/symbols/<exe>.tsv all -deleteProject`
  - Then rebuild the seeds; the hand-named `*.game.tsv` files go last so they win:
    `python3 re/tools/make_seeds.py re/symbols/PAZLE.seeds.tsv re/symbols/SLUS_003.38.tsv re/symbols/PAZLE.EXE.tsv re/symbols/SLUS_003.38.game.tsv re/symbols/PAZLE.game.tsv`
  - New names go in `re/symbols/PAZLE.game.tsv` (4th column: evidence).
- **Run the original game headless:**
  `TP_FRAMES=600 bash scripts/run-emulator.sh re/lua/smoke.lua ../tp-private/runs/<name>`
  - Convert the screenshots with `python3 re/tools/shot2png.py <dir>/*.raw`.
  - To log RAM values when they change, add `TP_WATCH='!scr0=0x80089b70:4,step0=0x80089b78:4'`
    (`!` also screenshots). Player screen/step words are `state+0x4b508/0x4b510` + 4×player,
    with `state` = `0x8003e668`.
  - Route into Egypt stage 1: `TP_TAP=START:300:3000:90,CROSS:4200:9000:120 TP_INPUTS=3400:RIGHT:4,3500:CROSS:4,3700:CROSS:4`
    (play starts at frame 7642).
  - To find the code that writes a variable, add `TP_WRITERS='name=0x800ee3b4:4'` (each writing
    PC is logged once). `TP_SNAPS=8000,9000-12000:500` dumps RAM at those frames; scan the dumps
    with `python3 re/tools/ramscan.py changed|same|inc|eq|seq|diff <dir>/ram_*.bin`.
  - Scenario scripts (RAM pokes, extra breakpoints): `TP_EXTRA=$PWD/re/lua/p3_lines.lua` (forced
    line clears and a stage clear) or `re/lua/rand_trace.lua` (every `rand()` call).
  - To trace CD reads and music, add `TP_CD_HOOKS=$PWD/re/lua/cd_hooks.txt`, then run
    `python3 re/tools/cd_trace.py <dir>/run.log "../tp-private/disc/Tetris Plus.cue" "../tp-private/disc/Tetris Plus (Track 01).bin"`.
- **Decompile a whole EXE to one greppable file**, plus its call graph (real PSX loader and PsyQ
  names; absolute paths). Keep the `DefineTableFunctions.java` pass, or ~500 table-dispatched
  functions are missing, and the `EnableParamId.java` pre-script, or calls lose arguments that a
  function passes straight through:
  `$GHIDRA_INSTALL_DIR/support/analyzeHeadless /home/user/tp-private/work/ghidra p -import /home/user/tp-private/files/PAZLE.EXE -loader PsxLoader -scriptPath re/ghidra -preScript EnableParamId.java -postScript DefineTableFunctions.java 0x800955d4 0x800d4fb0 /home/user/tp-private/work/decomp/PAZLE.EXE.ptr.tsv -postScript ExportDecompiled.java /home/user/tp-private/work/decomp/PAZLE.EXE.c -postScript ExportCallGraph.java /home/user/tp-private/work/decomp/PAZLE.EXE.cg.tsv -deleteProject`
  - Disassemble a function where the decompiler looks unsure:
    `python3 re/tools/disasm.py ../tp-private/files/PAZLE.EXE <address> --cg <decomp>/PAZLE.EXE.cg.tsv --names re/symbols/PAZLE.seeds.tsv`.
- **Who writes a global (static):** `python3 re/tools/global_xrefs.py <decompiled.c> --names re/symbols/PAZLE.seeds.tsv`.
  Misses writes through pointers; confirm with `TP_WRITERS`.
- **State-machine tree:** `python3 re/tools/dispatch_tree.py <EXE> <decompiled.c> <root> --names re/symbols/PAZLE.seeds.tsv`
  (Puzzle Mode root `800a16c4`, boot `80022e60`).
- **Read a table out of an EXE:** `python3 re/tools/exeread.py <EXE> <address> [count] [--size 1|2|4] [--string]`.
- **Extract the gameplay tables** (pieces, rules, 100 stages, professor scripts, passwords) to JSON:
  `python3 re/tools/extract_spec.py ../tp-private/files/PAZLE.EXE docs/spec/data`.
  Password codec: `python3 re/tools/tp_password.py selftest|encode|decode`.
- **Play any stage in the emulator:** add `TP_EXTRA=$PWD/re/lua/p4_stage.lua TP_STAGE=<1-100>` to
  the Egypt stage 1 route (it pokes zone and stage during the stage setup screen).
- **Data files (`*.BIN`):** `python3 re/tools/tpbin.py list|extract <PROGRAM.EXE> <DATA.BIN> [out]`.
  Render them with `python3 re/tools/tim2png.py sheet|extract <PROGRAM.EXE> <DATA.BIN> <out>`.
