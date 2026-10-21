# Tetris Plus (PS1) Puzzle Mode → web

A faithful browser version of Tetris Plus's Puzzle Mode (the professor mode), rebuilt from the
original PS1 game (US, SLUS-00338) and verified against it in an emulator.

- **Plan:** `docs/RESEARCH_AND_PLAN.md` (phases, fidelity rules, verification layers, ground rules).
- **In progress:** `docs/re/shell.md` (Phase 9: the memory card in `web/src/core/card.ts` and
  `screens/cardui.ts`, checked against the original down to the card image; the browser shell in
  `web/src/shell/` and `web/src/view/main.ts`; the survey of the programs around Puzzle Mode).
- **Latest results:** `docs/re/audio.md` (Phase 8: the sound in `web/src/audio/`: libsnd's voice
  manager, the SPU, the CD drive and the program's CD callback; every key-on, register write, CD
  command and report of the corpus matches the original's, checked by `npm test` in `web/`).
  `docs/re/renderer.md` (Phase 7: the renderer in `web/src/render/` and the
  asset pipeline; every frame of the corpus is pixel-identical to the original's, checked by
  `npm test` in `web/`).
  `docs/re/core-port.md` (Phase 6: the TypeScript core in `web/src/core/`,
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

- **The TypeScript core and renderer** (in `web/`; `npm install` first):
  - `npm test`: golden traces (sound included), frames and Unicorn function tests. `npm run trace -- [--render]
    [--audio] [MOVIE...]`: replays movies and prints the first difference with the original's trace
    (`--render` also compares each frame's GPU packets and pixels, `--audio` the sound and CD
    events). `npm run typecheck`.
  - `npm run dev`: the browser preview (keyboard on pad 1; sound starts with the first key).
  - Frames as PNG: `npx tsx tools/frames.ts ../re/movies/<name>.tpm <out> <ticks> [--hide-p2] [--scale N]`.
  - Rebuild the web assets after a disc fetch: `npx tsx tools/extract-assets.ts` (writes
    `public/assets/pazlee.pack`, committed) and `npx tsx tools/extract-audio.ts` (the sound bank,
    `disc.json` and the music as Opus in `public/assets/music/`, committed; needs FFmpeg).
  - A movie's sound as WAV: `npx tsx tools/render-audio.ts ../re/movies/<name>.tpm <out.wav> [--from T] [--to T]`.
    ADPCM decoder vs FFmpeg: `npx tsx tools/check-adpcm.ts`.
  - The core records the program's sound calls (`Game.sound`: key-ons, CD plays, CD volume);
    `src/audio/model.ts` turns them into the original's SPU writes and CD events.
  - The core records presentation events the renderer replays: image uploads (`Game.uploads`,
    trace field `up`; add `itemLoad`/`itemQueue` wherever the original calls `item_load` or
    `FUN_8009747C`) and boxes sorted during the logic (`Game.boxes`).
  - The complete-run movie (power-on to the ending and back to the title, all 100 stages):
    `npx tsx tools/complete-run.ts [OUT.tpm] [--log]` plays it on the port and writes
    `re/movies/complete-run.tpm`.
  - Design a movie on the core before running it on the original:
    `npx tsx tools/simulate.ts ../re/movies/<name>.tpm [--to T] [--fields a,b]`.
  - Movies can poke memory after a tick (`poke TICK ADDRESS VALUE [SIZE]`) to set up a scenario;
    both the emulator and the core apply it.
  - Movies choose the memory cards: `card PORT blank|none|FILE` (FILE a `.mcd` or `.mcd.gz` under
    the repo, e.g. `re/cards/egypt1-saved.mcd.gz`); runs copy the cards out as `card1.mcd`,
    `card2.mcd`. With a save on card 1, use `boot puzzle-saved` (SW_ON's load delays the route).
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
  - `TP_VRAM_AT=<ticks>` dumps VRAM and RAM at the sample point. Decode the frame's GPU packets:
    `python3 re/tools/otdump.py <dir>/ram_<tick>.bin [--raw]`; draw the same frame on the port
    and compare: `npx tsx tools/render-dump.ts <ram> <vram> [out.ppm]` (in `web/`).
    `TP_UPLOAD_LOG=1` logs every image upload with its caller's return address.
    `TP_AUDIO_LOG=1` writes `audio.log`: the CPU cycle of every vblank, sample, key-on, CD command
    and CD report (to time sound events within a tick).
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
