# Phase 9: the story intro, the title screen and the attract loop (2026-10-18)

TIT_DEMO.EXE (program 2, the story intro) and TITLE.EXE (program 3, the title screen) run in
TypeScript (`web/src/programs/tit_demo/`, `web/src/programs/title/`) and behave exactly like the
originals: **every tick of every run of them in four movies has the original's trace, ordering
table and frame** (§6). The attract loop around them is mapped program by program from a traced
power-on run (§4).

| Path | What it is |
|---|---|
| `web/src/programs/title/common.ts` | `ModeProgram`: the main loop both programs share, pad read, `se_play`, `bgm_request`, the trace row |
| `web/src/programs/tit_demo/logic.ts`, `renderer.ts` | TIT_DEMO's logic (phases, scenes, captions) and its `objects_draw` |
| `web/src/programs/title/logic.ts`, `renderer.ts` | TITLE's logic (params, phases 0-9) and its `objects_draw` |
| `web/src/programs/*/rom.ts` | Their data, from `re/tools/extract_core_rom.py` (TIT_DEMO `0x80094000-0x800940B4`, `0x800ADC68-0x800AFD00`; TITLE `0x80094000-0x80094124`, `0x800AD844-0x800AE230`) |
| `web/test/title.test.ts` | Trace and frame equality on every run of both programs in the movies below |
| `web/test/fixtures/title-starts.ts` | The state block each run of TIT_DEMO found (`re/tools/extract_entry_state.py`) |
| `re/lua/fields/TIT_DEMO.lua`, `TITLE.lua` | Their traced fields |
| `re/symbols/TIT_DEMO.game.tsv`, `TITLE.game.tsv` | Function names |
| `re/movies/attract-cycle.tpm`, `title-skip.tpm`, `title-anim.tpm`, `title-carry.tpm` | Movies; traces in `re/traces/` |

## 1. The shared main loop

Both programs (and the HOW programs, RANKING and SW_ON) are the same design as PAZLE.EXE,
recompiled: `start` clears the BSS (TIT_DEMO `0x800B5CCC-0x800B8BB4`, TITLE `0x800B425C-0x800B7078`)
and calls main, which initialises the GPU, sound (`sound_init`: bgm state `0x34`, CD volume by the
music setting), builds a GsSPRITE template for every item of its data file (unpacking and
uploading each, `sprite_templates_init`), clears the exit flag and loops:

    counter++; GsGetActiveBuff; GsClearOt; logic; objects_draw; DrawSync; VSync; ResetGraph(1);
    GsSwapDispBuff; GsSortClear(0,0,0); GsDrawOt; pad_read; cd_poll; rand()

until the exit flag is set. `ModeProgram.step` runs the previous iteration's tail (pad read, rand)
and then the logic, as `Game.step` does. The CD poll only acts after a CD error (`CdReset` and a
replay) and is not ported. Neither program calls its `soft_reset_check` (START+SELECT for 121
ticks): it has no caller in either EXE.

The first row of a program's run has `rand: 1`: the previous program's last iteration called
`rand()` after the tracer's last sample of it. The replay injects the trace's `mainseed`, which
already includes that call (and the boot loader's own, uncounted calls), so the port counts it
without making it.

Sprite objects are PAZLE's: 1,050 of `0x7C` bytes at `state+0x5C`, same field layout.

## 2. TIT_DEMO.EXE

Phases (`state+0x50`, table `0x80094000`):

| Phase | Routine | What it does |
|---|---|---|
| 0 | `FUN_80096BE4` | Subphases 0-3: clear all objects and the story variables, then phase 1. Every tick: `bgm_request(2)` (CD track 2, once) |
| 1 | `FUN_80096C0C` | pad 1 START newly pressed: phase 3. Otherwise one scene step and one caption step |
| 2 | `FUN_80096C54` | exit: TITLE, param 0, phase 0 |
| 3 | `FUN_80096C80` | exit: TITLE, param 0, phase 9 (the finished title) |

Scenes (`0x800B5CF8`, table `0x80094038`, 12 steps): the background (objects 0, 1) fades in under
a darkening box (object 2, kind -2, level `+0x4C`); two scroll layers (objects 5, 6) move up
`0x7000` a tick; at each stop of table `0x800AF784` a sign appears (object 10) whose blend mode
cycles through `0x800AF7B0` every 15 ticks; the last stops swap the layers' images and the
scene fades out (object 7; on odd ticks only, so the program's length depends on the counter's
parity: 1,789 or 1,790 ticks). Captions (`0x800B5D08`, table `0x80094070`; pages table
`0x800940A4`): three captions (`0x800AF7D0`, `0x18` each: script, origin, repeats, ticks per
letter, hold, pause), typed one script word every few ticks into objects 100-199: a letter (high
nibble picks the font, `0x800AF838`; `0x5xxxxxxx` letters are two images wide), `0xF0000000` a
space, `0xFFFFFFFE` a new line, `0xFFFFFFFF` the end of a script.

`objects_draw` (`FUN_80096854`, `TitDemoRenderer`): objects 1049 down to 0 at priority
`20 - n/50`; kind -1 a box with `rand() & 7` colours (never used by the story), kinds -2/-3 a
subtractive/additive box at level `(64 - fade) * 255 / 64`, else GsSortSprite at
`(x + 0x800ADC68[image]) >> 16 + layer offset - 0xA4`, `(y + ...) >> 16 - 0x70`, palette row
`+0x48`.

Inputs: only pad 1 START, and only in phase 1 (phase 0 is ticks 1-3).

## 3. TITLE.EXE

`state+0x4C` ("param", table `0x80094000`):

| Param | Routine | What it does |
|---|---|---|
| 0 | `FUN_800971A8` | clear the objects, PRESS START (object 100, animation 3), param 1 |
| 1 | `FUN_80097244` | animate object 100; pad 1 START newly pressed: in phase 9 `se_play(0)` and param 3, else phase 9; otherwise the phase step |
| 2 | `FUN_800972C0` | the attract timeout: exit, naming HOW_N if `state+0x4B540` is even (and setting it to 1), else HOW_VS (setting it to 0); param, phase, subphase 0 |
| 3 | `FUN_80097378` | exit: SELECT, param 0, phase 0 |
| 4 | `FUN_800973A4` | an image viewer (the d-pad steps objects 0 and 1 through the images); nothing sets param 4 |

Phases (`state+0x50`, table `0x80094014`) and their ticks in the attract run (TITLE's first tick
is 2160; subphase tables `0x8009403C`, `0x800B422C-0x800B4258`, `0x80094048`, `0x80094060`):

| Phase | Ticks | What it shows |
|---|---|---|
| 0 | 2161 | `bgm_request(0x22)`: CD track 3 |
| 1 | 2161-2193 | the four TETRIS blocks slide in (objects 22-25, odd ticks) |
| 2 | 2194-2305 | a panel crosses (objects 18, 20, 21; item 22 unpacked and uploaded again) |
| 3 | 2306-2367 | round 1: two blocks drop, rubble rises, dust clouds (objects 26-, 30-65, 66-) |
| 4 | 2368-2474 | the panel crosses back (item 23 reuploaded) |
| 5 | 2475-2531 | round 2: three blocks |
| 6 | 2532-2623 | two panels open vertically (objects 18-21) |
| 7 | 2624-2696 | round 3: four blocks; then the TETRIS letters' animation (animations 8 and 9, every frame unpacked and uploaded) |
| 8 | 2697-2818 | `se_play(0x19)`; PLUS typed one letter a tick (tables `0x8009407C/B4/EC`); the professor's bow (animations 6, 7); a white flash (additive boxes at priority 0, fading over 30 ticks) |
| 9 | 2819-4620 | the finished title with PRESS START blinking; after 1,801 ticks (`0x707 <` the timer) param 2 |

Every phase's moves happen on odd counter ticks, as the original. Animation 1's first frame and
animation 3's off frames are image `0x10000`, which reads the 36 bytes before the templates
(`state+0x3F050`, zero in every dump): a zero-size sprite GsSortSprite skips.

`objects_draw` (`FUN_8009683C`, `TitleRenderer`): objects 1049 down to 0 with GsSortSprite at
priority `+0x40 + 10`, at `(x >> 16) - 0xA4`, `(y >> 16) - 0x74`, no offset table. Boxes the
logic sorts (the flash) go in first.

Inputs: only pad 1 START (newly pressed), in param 1: in phases 0-8 it jumps to phase 9 (the
logo animation is skipped, PRESS START shows at once); in phase 9 it plays effect 0 and leaves
for SELECT on the next tick. Pad 2 and every other button do nothing (`title-skip`). Each program
starts with its pad state cleared, so a START still held from TIT_DEMO's skip is newly pressed on
TITLE's first pad read, which comes before its 2nd tick's logic; the title plays effect 0 then and
leaves for SELECT on its 3rd tick (`title-carry`: TITLE runs ticks 902-904).

## 4. The attract loop

From `re/movies/attract-cycle.tpm` (power-on, no input; ticks are the frame counter; the HOW
programs were traced with the shared fields only, `re/lua/programs.lua`):

| Program | Ticks | Exits with (next, param, phase, subphase) | Left early by |
|---|---|---|---|
| SW_ON | 1-370 (370) | TIT_DEMO, 0, 0, 0 | |
| TIT_DEMO | 371-2159 (1,789) | TITLE, 0, 0, 0 | pad 1 START: TITLE, 0, 9 |
| TITLE | 2160-4622 (2,463) | HOW_N (`state+0x4B540` 0 → 1), 0, 0, 0 | START: phase 9; START in phase 9: SELECT, 0, 0 |
| HOW_N | 4623-7048 (2,426) | HOW_P, 0, 0, 0 (`FUN_80098058`) | pad 1 START: TITLE, 0, 9 (`FUN_800979D0`); START+SELECT 121 ticks: TITLE, 0, 9 |
| HOW_P | 7049-11457 (4,409) | RANKING, 0, 0, 0 | as HOW_N |
| RANKING | 11458-11897 (440) | TIT_DEMO, 0, 0, 0 | docs/re/ranking.md |
| TIT_DEMO | 11898-13687 (1,790) | TITLE, 0, 0, 0 | |
| TITLE | 13688-16150 (2,463) | HOW_VS (`state+0x4B540` 1 → 0), 0, 0, 0 | |
| HOW_VS | 16151-19130 (2,980) | RANKING, 0, 0, 0 (`FUN_800979D0` in HOW_VS) | as HOW_N |
| RANKING | 19131-19570 (440) | TIT_DEMO, 0, 0, 0 | |
| TIT_DEMO | 19571-21359 (1,789) | TITLE | |
| TITLE | 21360-23822 | HOW_N again | |

So one cycle is TIT_DEMO, TITLE, HOW_N, HOW_P, RANKING, TIT_DEMO, TITLE, HOW_VS, RANKING:
19,200 ticks. HOW_P runs only after HOW_N, never from the title. The HOW programs replace the pad
with recorded input but keep pad 1's real START (`(pressed & 0x800) | recorded`); their START
check is in their phase 1 (phase 3 then exits), and their main loops do call `soft_reset_check`
after `rand()`. Their tracer entries (main, padread, rand, ot, cd) come from new Ghidra
decompiles of HOW_N/HOW_P/HOW_VS.EXE (same scripts as the others).

**Recommendation for the out-of-scope demos (HOW_N, HOW_VS).** Give the Console a stand-in
program for each that does what the original does at its edges, and nothing in between:

- On its first tick it exits naming what the original names: HOW_N → HOW_P, HOW_VS → RANKING,
  with param 0, phase 0, subphase 0. Comparing the state block at each program's main, the
  demos write no settings, records or `state+0x4B540`; they leave their game's numbers in
  `state+0x18`, `+0x20`, `+0x24` (after HOW_N: 5, 9, 1; HOW_P: 0x32, 0x13, 4; HOW_VS
  changes `+0x20` to -11 and `+0x24` to 5; the demos are deterministic) and HOW_VS leaves `state+0x4B53C` (two players) at 1, which RANKING and
  TIT_DEMO then see (TITLE clears it). A stand-in should write the same values: they are what
  the next programs find (`state+0x58`, the live object count, is rewritten by every program).
- Optionally (closer to the original's timing) it runs as many ticks as the original
  (2,426 / 2,980), drawing black, adding 1 to the counter each tick, and leaving for TITLE with
  param 0, phase 9 on a newly pressed pad 1 START, as the original does.

The immediate pass-through keeps the loop's order (TITLE's toggle still alternates; RANKING
still follows) and only shortens it; the counter then runs 2,426 or 2,980 ticks behind the
original's, which changes nothing but the parity of later ticks (the odd-tick moves in TIT_DEMO
and TITLE). HOW_P (the Puzzle demo) is in scope and needs its own port for the loop to be
complete.

## 5. Movies

| Movie | Ticks | Covers |
|---|---|---|
| `attract-cycle` | 26,000 | the whole attract loop (§4); three runs of TIT_DEMO and TITLE, both timeouts |
| `title-skip` | 1,320 | START in TIT_DEMO's phase 0 (ignored); every other button and pad 2 in TIT_DEMO and in TITLE (ignored); the skip to TITLE phase 9; START there (effect 0, SELECT) |
| `title-anim` | 2,720 | START during the logo animation (phase 3 → 9), then START (SELECT) |
| `title-carry` | 940 | START held 12 ticks: the skip, then TITLE sees START on its 2nd tick and leaves on its 3rd |

## 6. Verification

`npx vitest run test/title.test.ts`: every run of TIT_DEMO and the TITLE after it in the four
movies replays from TIT_DEMO's first tick with the state block the original's TIT_DEMO found
(`test/fixtures/title-starts.ts`) and must equal the original's trace on every tick: the shared
fields, the programs' own (pads, story and title state, the first objects' images, positions and
fade levels, bgm state), `rand` counts, `se`/`bgm` calls, TITLE's unpacked items (`up`: the packed
address of every item the decompressor reads), the ordering table (`ot`) and the frame (`fb`).
It also checks the program TITLE names is the one the original runs. 6 runs, 16,453 ticks.

With the SW_ON port present, the same comparison also passes from power-on through SW_ON,
TIT_DEMO and TITLE (`title.test.ts`'s power-on cases, on `title-skip` and `title-carry`).

## 7. Deviations and notes for the lead

- Loading is not reproduced (the brief's rule); the replay injects each program's `mainseed`.
- The CD poll's error recovery is not ported (it never runs on a working drive).
- Sound: both programs' calls are recorded in `Program.sound` with PAZLE's `SoundCall`s:
  `sound_init`'s CD volume (`cdvol`) on the first tick, `bgm_request`'s `play`/`cdvol`
  (TIT_DEMO: track 2; TITLE: track 3 by request `0x22`) and `se_play`'s key-ons (TITLE: effects 0
  and `0x19`). Calls are verified at call level (`se`, `bgm`). The CD commands are the programs'
  own: `bgm_play_track` sends CdControlB Setmode (`0x0E`, 5), Setloc, Play (trace `cd`
  `[[14,5],[2,m,s,f],[3]]`), and the CD callback loops or mutes at the track end.
- `bgm_play_track` only plays tracks up to the CD's track count, `state+0x206E0`, which
  `web/src/flow/power-state.ts` does not include (its range stops at `0x20650`): from power-on the
  port records no `play`. `re/tools/extract_entry_state.py` widens the range to `0x206E4` (and to
  `0x4B544` for the attract toggle `state+0x4B540`); the power state needs the same.
- RANKING's test sets its first row's `rand` to 0; the convention here is 1 (§1). Chained from
  power-on, both programs must agree.
