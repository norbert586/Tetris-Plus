# Phase 2: static bootstrap (2026-10-17)

Puzzle Mode's code is now mapped from the top: the main loop, how it reads the pad, the state
machine that runs every screen, and how the boot program hands control in and out. The exit
criterion is met: the code region is bounded, and every byte of it belongs to a known function.

- **Code region.** Game code is `0x800955D4`–`0x800C0993` (695 functions, 177 KB). PsyQ
  library code follows up to `0x800D4FAB` (762 functions). Before that sits a 5.6 KB block of
  dispatch tables.
- **One logic tick per vblank.** Measured: 8,000 ticks in 8,000 frames, through gameplay and
  pause. The display is 320×240 non-interlaced NTSC.
- **The game is a two-player state machine.** Each player runs one of 14 screens (menu, map,
  story, stage, pause, continue, …). Player 2 just sits on "PRESS START" in one-player play.
- **Random numbers come from the BIOS**, not from the game, and nothing seeds them.
- **REA was silently wrong about global variables.** Fixed in the ELF wrapper (see §7).

Evidence comes from the decompiled code (both programs, with real PSX loader and PsyQ names),
REA on the fixed wrapper, and one traced emulator run (`p2-screens`):

- Phase 0's route into Egypt stage 1.
- Start at frame 10800 to pause, and again at 11100 to resume.
- No other input until frame 21000, so the stack tops out and "CONTINUE?" appears.
- Watched values: both players' screen numbers, player 1's step variables, and the program and
  phase fields.

## 1. Memory map of `PAZLE.EXE`

| Range | Size | Contents |
|---|---|---|
| `0x80094000`–`0x800955D3` | 5.6 KB | Read-only data: 61 dispatch tables, switch tables, small constant tables |
| `0x800955D4`–`0x800C0993` | 177 KB | Game code: 695 functions |
| `0x800C0994`–`0x800C09C7` | | `start` (the EXE entry point): clears BSS, calls `pazle_main` |
| `0x800C09C8`–`0x800D4FAB` | 83 KB | PsyQ libraries: 762 functions, 740 with library names |
| `0x800D4FB0`–`0x800ED7FF` | 100 KB | Initialised data: Phase 1's item table at `0x800E1318`, music tables, and (Phase 4) probably the stage data |
| `0x800ED800`–`0x800F3703` | 24 KB | BSS: game variables, cleared by `start` |
| `0x800F4000`– | | The data file (`PAZLEE.BIN`), loaded there by the boot program |

**Shared state.** Most of the game's bigger state lives in the boot program's shared block
(`state` = `0x8003E668`, pointer at `0x800ED328`), not in `PAZLE.EXE`'s BSS. Offsets added in
this phase:

| Offset | Size | Contents |
|---|---|---|
| `+0x40` | u32 | Frame counter, +1 per tick. **Never reset between programs.** Animations test its low bits (`& 1`, `& 3`, `& 8`, `% 3`), so blink phases depend on how long earlier screens ran |
| `+0x48` | u32 | Next program for the boot loader (index into its 13-program table, §5) |
| `+0x4C` | u32 | Parameter for that program |
| `+0x50` | u32 | Phase: top-level state of the running program |
| `+0x54` | u32 | Sub-phase |
| `+0x5C` + n×`0x7C` | 1,050 × 124 bytes | Sprite objects (§3.4) |
| `+0x1FCF4` | u32 | Exit flag: non-zero ends the main loop |
| `+0x1FD14` | u32 | Last `VSync(0)` result |
| `+0x206E4` | 2 × 13,000 bytes | libgs packet buffers |
| `+0x26C74`, `+0x28C74` | | The two ordering tables |
| `+0x2AC74` | | Decode buffer for one data-file item |
| `+0x3F074` + n×`0x24` | 1,235 × 36 bytes | A `GsSPRITE` template per `PAZLEE.BIN` item, built at startup |
| `+0x4AD84` | 100 × u16 | Best time per stage, in tenths of a second; reset to 9999 (999.9 s) |
| `+0x4AEA0` + n×`0x0C` | 5 entries | High-score table checked before name entry |
| `+0x4B508` + 4p | u32 | Player p's screen (§4) |
| `+0x4B510` + 4p | u32 | Player p's step within the screen |
| `+0x4B518` + 4p | u32 | Player p's sub-step (also a menu cursor on some screens) |
| `+0x4B520` + 4p | u32 | Player p's fourth state word |
| `+0x4B53C` | u32 | Two-player flag: 0 when either player is on screen 8, else 1 |

## 2. The main loop

`pazle_main` (`0x800963B0`) is called by `start` with the shared state pointer.

**Startup:**

1. `ResetCallback`, `CdInit`; stores the state pointer.
2. `globals_init`: zeroes the game variables.
3. `system_init`:
   - memory card (`InitCARD`, `StartCARD`, `_bu_init`, 8 card events)
   - `PadInit(0)`
   - GPU: `ResetGraph(3)`, `GsInitGraph(320, 240, 4, 0, 0)` (non-interlaced, GPU offset mode,
     no dither), two ordering tables of 2^11 entries
   - `SpuInit`, then `sound_init` (Phase 1 §5: VAB, reverb, volumes)
   - `sprite_templates_init`: one `GsSPRITE` per data-file item, nothing uploaded yet
   - display on
4. `pad_init`, then clear the exit flag.

**Every frame,** until the exit flag is set:

| # | Call | What it does |
|---|---|---|
| 1 | `state+0x40 += 1` | Frame counter |
| 2 | `GsGetActiveBuff`, `FUN_800C5250`, `GsClearOt` | Start the next buffer (`FUN_800C5250` takes the packet area; probably `GsSetWorkBase`) |
| 3 | `phase_dispatch` | **All game logic** (§4) |
| 4 | `objects_draw` | Sorts every live sprite object into the ordering table |
| 5 | `upload_queue_flush` | Uploads images queued during the frame |
| 6 | `DrawSync(0)`, `VSync(0)` | Wait for the GPU, then for vblank |
| 7 | `ResetGraph(1)`, `GsSwapDispBuff`, `GsSortClear(0,0,0)`, `GsDrawOt` | Show the frame just built, start drawing it |
| 8 | `pad_read` | Read both pads (§3.1) |
| 9 | `bgm_poll` | Restarts the music after a CD reset |
| 10 | `rand()` | One call per frame, result unused (§3.2) |
| 11 | `soft_reset_check` | Start+Select (§3.1) |

**Shutdown:** close the card events, then `system_shutdown` (`VSync(60)`, sound off, CD
flushed, counters stopped) and return to the boot program.

**Timing for the port:**

- **One tick per vblank.** There's no frame skipping or delta time. If an update ran long, the
  game would slow down, not skip. In the traced run the counter rose by exactly 8,000 over
  8,000 frames.
- **Input is one frame behind.** The pad is read after `VSync`, at the end of frame N, and the
  logic first sees it in frame N+1. Pressed-this-frame bits come from comparing with the
  previous read. The port should keep this order: read, then step with that read.
- **The frame counter carries over from earlier programs.** A pixel-exact comparison needs the
  emulator's value at Puzzle Mode entry as the port's starting value.

## 3. Subsystems around the loop

### 3.1 Pad

`pad_read` calls `PadRead(0)`. The low 16 bits are player 1, the high 16 bits player 2. Per
player it keeps three halfwords (stride 6 bytes from `0x800F36F0`):

| Address (P1 / P2) | Contents |
|---|---|
| `0x800F36F2` / `0x800F36F8` | Held buttons |
| `0x800F36F4` / `0x800F36FA` | Newly pressed this frame: `(previous ^ now) & now` |

Bits are libetc's `PadRead` layout. Seen in the code so far:

| Bit | Button | Use seen |
|---|---|---|
| `0x0800` | Start | Pause; join as player 2 |
| `0x0100` | Select | Soft reset (with Start) |
| `0x0040` | Cross | Confirm |
| `0x0020` | Circle | Cancel / back |
| `0x2000` | Right | Menu cursor |
| `0x8000` | Left | Menu cursor |

The other bits are `0x1000` Up, `0x4000` Down, `0x0010` Triangle, `0x0080` Square, `0x0004` L1,
`0x0008` R1, `0x0001` L2 and `0x0002` R2. Gameplay controls (move, rotate, drop) are Phase 3–4.

**Soft reset (`soft_reset_check`).** Holding Start+Select on either pad for more than 120
frames (2 s) sets the exit flag and asks the boot program for `TITLE.EXE` (program 3) with
phase 9.

### 3.2 Random numbers

`rand` at `0x800C0C48` is a 12-byte stub that calls the BIOS: `li t2,0xA0; jr t2; li t1,0x2F`
(BIOS function A0:2Fh). Neither program ever calls `srand`. The boot program also calls `rand()`
once per frame from power-on.

- **Algorithm:** `seed = seed × 1103515245 + 12345; return (seed >> 16) & 0x7FFF`. This is the
  documented Sony BIOS behaviour. The OpenBIOS in our emulator does the same, with its seed
  starting at 0 (`openbios/kernel/libcmisc.c` in pcsx-redux/nugget `361f3f6`, the build our
  PCSX-Redux uses).
- **Consequence:** the seed at any point is the number of `rand()` calls since power-on. That
  count depends on loading times, so on a real console it's effectively unpredictable.
  - The port only needs the same formula and the same call points.
  - For trace comparisons, Phase 5 reads the seed out of the emulator and injects it.
- **To check later:** the Sony BIOS's starting seed (we have no Sony BIOS here); where
  OpenBIOS keeps the seed in RAM (Phase 3).

### 3.3 Sound and music calls

- `se_play(id)` (`0x80095778`): looks up a program and note for `id` in the table at
  `0x800DC47C`, 8 bytes per effect, and plays them with `SsVoKeyOn` at the SE volume.
  - In two-player play (`+0x4B53C` set, stereo) it adds 5 for player 1 and 10 for player 2, the
    left and right copies from Phase 1 §5.
  - Volume 0 skips the call.
- `bgm_request(id)` (`0x80095DA8`): Phase 1 §7. Each screen's requests are listed in §4.

### 3.4 Sprites and images

- **Sprite objects.** 1,050 objects of `0x7C` bytes at `state + 0x5C + n×0x7C`:
  - 0–399 belong to player 1, 400–799 to player 2. Code addresses them as
    `player offset (0x800EE410: 0 or 400) + slot`.
  - 800–1049 are shared.
  - `objects_draw` walks them from 1049 down to 0 and sorts each live one with
    `GsSortFastSprite`, or `GsSortSprite` when it's scaled, rotated or flipped.
  - Default priority: `20 − n/50`.
- **Fields known so far:**

  | Offset | Contents |
  |---|---|
  | `+0x00`, `+0x04` | x, y (16.16) |
  | `+0x08`, `+0x0C` | Scale x, y |
  | `+0x10` | Rotation |
  | `+0x14` | Kind (−1, −2, −3 are special draw paths) |
  | `+0x24` | Image |
  | `+0x40` | Priority |
  | `+0x44` | Flip bits |

- **Image numbers.** The image field is `0x10000 + item + 1`, from the template address
  arithmetic in `objects_draw`; Phase 7 will confirm it. Images below `0x10200` also get a
  per-image offset from the table at `0x800D64AC`.
- **Uploads.** `item_load(n)` (`0x8009740C`) LZ-decodes `PAZLEE.BIN` item n and calls
  `tim_upload`. That `LoadImage`s the pixels at the TIM's own VRAM position, **plus 256 rows for
  player 2**, and its CLUT at the stored position plus one row for player 2. So the two players'
  copies of the same art sit in the top and bottom halves of VRAM (Phase 1's open question 5).

## 4. The state machine

Every screen is a function-pointer table indexed by a state variable. The game copies the table
from the read-only area to the stack and calls `table[state]`. `docs/re/dispatch-tree.txt` has
the whole tree: 61 tables reaching 440 functions.

**Phase level** (`phase_dispatch`, table `0x800942E0`, on `state+0x50`):

| Phase | Function | What it does |
|---|---|---|
| 0 | `phase0_start` | Sub-phase 0 (`phase0_setup`): clears all sprites, puts player 1 on screen 0 and player 2 on screen 8, then phase 1 |
| 1 | `phase1_players` | Every frame, runs `screen_dispatch` and `pause_check` for player 1 (index 0, sprite offset 0), then player 2 (index 1, offset 400). When both players are on screen 8, exits to `RANKING.EXE` (program 7) |
| 2, 3 | — | Empty |

The player index lives at `0x800EEAD0`. Per-player arrays are indexed by it throughout.

**Screen level** (`screen_dispatch`, table `0x800942F8`, on `state+0x4B508[player]`):

| # | Name | Music | Seen | Leads to | Notes |
|---|---|---|---|---|---|
| 0 | `scr00_menu` | `0x2F` | yes | 1, 3 | New Game / Continue / Password |
| 1 | `scr01_map` | `0x2F` | yes | 2, 8 | World map, the assistant's dialogue, zone choice |
| 2 | `scr02_story` | `0x26` | yes | 3 | Zone story scene |
| 3 | `scr03_stage_setup` | `0x23` | yes | 4 | 20 frames; prepares the stage |
| 4 | `scr04_stage_intro` | | yes | 5 | Stage intro with "The Professor" rules panel (885 frames before play started, with Cross pressed every 120) |
| 5 | `scr05_play` | stage tune | yes | 9, 6 | Gameplay. Step machine: 1 while a piece falls, then 2 → 5 → 0 → 1 over 3 frames for each new piece |
| 6 | `scr06_continue` | `0x2E`, `0x2D` | yes | 4, 7 | "CONTINUE?" countdown, then game over |
| 7 | `scr07_rank_entry` | `0x31` | | 13 | If the score makes the top 5 (`+0x4AEA0`): name entry with a 5,400-frame (90 s) timer. Otherwise straight to 13 |
| 8 | `scr08_idle` | | yes (P2) | 0 | Not playing: "PRESS START" |
| 9 | `scr09_stage_clear` | `0x2C` | | 3, 10, 11 | Stage clear. Track 24 is probably its jingle |
| 10 | `scr10_zone_clear` | `0x32`/`0x33` | | 11, 2, 1 | Zone cleared; zone 4 (Atlantis?) uses tracks 32/33 |
| 11 | `scr11_zone_end` | stop | | 6, 7 | |
| 12 | `scr12_pause` | stop | yes | saved, 8, exit | Pause. A two-option menu (Left/Right, Cross); option 0 quits (§5) |
| 13 | `scr13_save` | `0x2F` | | 1, 8 | Save / password screen |

"Seen" means it was reached in the traced run. "Leads to" comes from the code: every write of a
screen number to `+0x4B508`, attributed to the screen whose tree contains the writing function.
Roles of unseen screens are inferred from their transitions and music requests. Phase 3's movie corpus should reach them all.

**Pause (`pause_check`).** If Start was just pressed, the current screen is pausable (per-screen
flag table at `0x800DC424`) and a guard flag is clear, then:

1. The screen and its three step words are saved.
2. The player moves to screen 12.
3. Music stops (`bgm_request(0x34)`).

Resuming restores them. In the run, Start at frame 10800 paused on frame 10801, and Start at
11100 resumed on frame 11102.

**Step level.** Each screen dispatches again on `+0x4B510[player]`, and some on
`+0x4B518[player]` or on screen-specific arrays. Their tables are in the tree. Naming those is
Phase 3–4 work, tied to the variables each one touches.

## 5. How the boot program runs a mode

`SLUS_003.38`'s loop (`main`) has the same shape as Puzzle Mode's: logic, `DrawSync`, `VSync`,
`PadRead`, flip, `rand()`. The logic is a five-state loader (`boot_dispatch`, table
`0x800221BC`):

| State | Function | What it does |
|---|---|---|
| 0 | `boot_prepare` | Clears VRAM, turns the display on, decides whether to show "Now Loading" |
| 1 | `boot_load` | Eight steps (table `0x8002219C`): set CD mode `0x80` (double speed), read the program's data file to `0x800F4000` (skipped for `JLOGO`), read the 2 KB EXE header, read the body to its `t_addr`. Failed reads retry from `CdSearchFile` after 64 tries |
| 2 | `boot_loading_finish` | Lets the "Now Loading" animation finish |
| 3 | `boot_settle` | Counts down 4 frames, then clears both players' screen and step words (`+0x4B508`–`+0x4B534`) |
| 4 | `boot_exec` | Stops everything, `Exec`s the program with `state` as its argument, re-initialises the libraries when it returns, then back to state 0 |

**Program numbers** (`state+0x48`; names at `0x80039A74`, data files at `0x80039C14`):

| # | Program | Data file |
|---|---|---|
| 0 | `JLOGO.EXE` | — |
| 1 | `SW_ON.EXE` | `SW_ONE.BIN` |
| 2 | `TIT_DEMO.EXE` | `TDEMOE.BIN` |
| 3 | `TITLE.EXE` | `TITLEE.BIN` |
| 4 | `HOW_N.EXE` | `HOWE.BIN` |
| 5 | `HOW_P.EXE` | `HOWPE.BIN` |
| 6 | `HOW_VS.EXE` | `HOWV.BIN` |
| 7 | `RANKING.EXE` | `RANKINGE.BIN` |
| 8 | `SELECT.EXE` | `SELECTE.BIN` |
| 9 | `NOMAL.EXE` | `NOMAL.BIN` |
| 10 | `PAZLE.EXE` | `PAZLEE.BIN` |
| 11 | `VSPUZ.EXE` | `VSPUZ.BIN` |
| 12 | `EDIT.EXE` | `EDITE.BIN` |

**Hand-off.** A program leaves by setting the exit flag plus `+0x48` (next program), `+0x4C`,
`+0x50` (the next program's starting phase) and `+0x54`. The trace shows this between programs:
for example `TIT_DEMO` sets phase 9 and program 3, then `TITLE` starts and later sets
program 8 (`SELECT`), which sets 10 (`PAZLE`).

`PAZLE.EXE` leaves in three ways:

| Exit | Next | Phase |
|---|---|---|
| Soft reset | `TITLE` (3) | 9 |
| Quit from the pause menu while the other player is idle (otherwise only this player drops to screen 8) | `TITLE` (3) | 9 |
| Both players on screen 8 | `RANKING` (7) | 0 |

`boot_prepare` skips the "Now Loading" art when the next program is `TITLE` and the parameter
(`+0x4C`, not the phase) is 9. Nothing seen so far sets that.

## 6. Tools added in this phase

| Tool | What it does |
|---|---|
| `re/ghidra/DefineTableFunctions.java` | Pre-pass before exports. Defines functions that no direct call reaches: pointer-table targets, plus code in the gaps between functions (lui/addiu callbacks, unused code). Took `PAZLE.EXE` from 1,103 to 1,610 functions and code coverage from 57% to 99.9%. The boot program gained 42 |
| `re/ghidra/ExportCallGraph.java` | Every function's extent and every direct call edge, as TSV |
| `re/ghidra/ExportFunctionNames.java` `all` | Also exports default `FUN_` names, so REA learns the recovered function starts |
| `re/tools/dispatch_tree.py` | Prints the dispatch tree from a root, reading the tables out of the EXE |
| `re/tools/exeread.py` | Dumps words, halfwords, bytes or a string at a RAM address of an EXE |
| `re/lua/smoke.lua` `TP_WATCH` | Logs listed RAM values whenever they change; a `!` prefix also takes a screenshot |
| `re/symbols/PAZLE.game.tsv`, `SLUS_003.38.game.tsv` | Hand-given names with evidence notes. `make_seeds.py` merges them last, so they win |

**Seeds v1:** `re/symbols/PAZLE.seeds.tsv` now holds 2,212 entries:

- every function start in both programs, so REA's own analysis covers the table-reached code
- the PsyQ names
- 78 hand-given names, among them every screen root and every top-level dispatcher

REA was re-run on `scr05_play` and shows the names.

## 7. REA fix: zero-filled segments were read-only

`psxexe2elf.py` used to map the rest of RAM (BSS, the shared state block, the scratchpad) as
zero-filled ELF segments. Ghidra's ELF loader maps such segments **read-only**, whatever their
flags. The decompiler then treats every variable in them as the constant 0.

**Effect:** REA showed `scr05_play`'s per-player test `(&DAT_800ee3a4)[player] & 4` as
`DAT_800ee3a4 & 4`, because the player index at `0x800EEAD0` had been folded to 0. Every
per-player access read as player 1, with no warning.

**Fix:** the wrapper now stores those segments as real zero bytes. The ELF grows to about 2 MB,
and Ghidra keeps them writable. The same REA call now shows the index.

**Phase 1:** its single REA result (the CD report callback `0x80095C5C`) only reads variables
inside `PAZLE.EXE`'s own data area, which was always writable, so it stands.

## 8. Open questions for Phase 3

1. **Name the gameplay variables.** Phase 3 adds the RAM map: board, piece, queue, professor,
   ceiling, timers, score. Gameplay's step machine (`play_step_dispatch`, 8 entries) and the
   eight per-frame updaters `scr05_play` calls in order (`0x800A7DD4`, `0x800A7FD4`, …) are the
   starting points.
2. **Screens 7, 9, 10, 11 and 13 haven't been seen yet.** Reaching them needs a stage clear, a
   zone clear and a high score. That's Phase 5's movie corpus, or a RAM poke to jump ahead.
3. **The flags that end a stage.** Screen 5 moves to 9 when `0x800EE3A4[p] & 4` is set and to 6
   when `0x800EE348[p] & 2` is set. These are probably "stage cleared" and "professor lost".
4. **Phase 0 sub-step 1** (`0x800A1A18`, 8 bytes) is never reached in the trace. It's probably
   a stub.
5. **The BIOS seed.** Sony's starting value, and where OpenBIOS keeps the seed in RAM (§3.2).
6. **What `TITLE` does with phase 9.** It's set on every return to the title. The trace shows
   `TIT_DEMO` setting it too, so it probably means "skip the logo animation".
