# SELECT.EXE (program 8): the mode select and Option mode

SELECT.EXE is the program the title's menu starts. It shows the five mode tiles (Classic,
Puzzle, VS, Edit, Option) and runs Option mode: the controls, level, matches, sound, the sound
tests, the volumes, and loading and saving the options and the ranking data on a memory card.
It is ported in `web/src/programs/select/`. The port matches the original on every tick of three
runs recorded from power-on (§8): every traced field, every `rand()` call, every image upload,
every sound call, the ordering table's GPU packets (`ot`) and the drawn frame (`fb`). The CD
commands it issues and the memory card it leaves are checked too. There is one deliberate
deviation: Classic, VS and Edit are shown but cannot be started (§7).

Names: `re/symbols/SELECT.game.tsv`. Fields traced: `re/lua/fields/SELECT.lua` (mirrored by
`web/src/programs/select/trace.ts`). State block S = 0x8003E668 (`web/src/core/addr.ts`).

## 1. Hand-offs

**In.** TITLE names SELECT (8) with param 0, phase 0 when START is pressed on its menu
(`docs/re/title.md`). No program on the disc names SELECT with another param (see the scan in
`docs/re/ranking.md` §1). So param 2 below is never reached from the disc.

**Out.**

| Exit | Where | Next program, param, phase |
|---|---|---|
| Mode select, Cross on a tile's confirmation (step 9, `ms_leave` 0x80097E74) | tile 0-3 | 9 + tile (NOMAL 9, PAZLE 10, VSPUZ 11, EDIT 12), 0, 0 |
| Same, on Option | tile 4 | stays in SELECT: param + 1 (Option mode), phase 0, subphase 0 |
| param 2 (`select_direct` 0x800971D0) | | 9 + cursor, 0, 0. The cursor (0x800B90A0) is in BSS, cleared at load, so this is NOMAL |
| Option mode's Exit row (row 12 → phase 7, `option_exit` 0x800983DC) | | stays in SELECT: param 0, phase 0, subphase 0. The mode select restarts from step 0 (backgrounds, music 0x2F) |
| Soft reset (`soft_reset_check` 0x800969F4): Start+Select held for 121 ticks on either pad | any screen | TITLE (3), 0, 9, and both players' screen/step/substep words cleared |

**Ranking.** Option mode's "RANKING" row (row 11) is not the RANKING program. It loads or
saves the ranking data (S+0x4AE60, 0x78 bytes) on a memory card, inside SELECT. SELECT never
names program 7, and it never writes S+0x48/0x4C except for the exits above. Leaving through a
mode exit therefore leaves the ranking data, possibly just loaded from a card, in the shared
block for that mode's program to read.

## 2. The main loop

`select_main` (0x80095800) sets up the sound (`sound_init` 0x800955F0: the CD volume at the
music volume, the bgm state 0x34, stereo or mono from the settings) and uploads all 177 items
of SELECTE.BIN (`items_upload_all` 0x80095FFC). It then clears the pads and loops:

1. The counter S+0x40 + 1.
2. The logic (`select_logic` 0x80097114), dispatched by S+0x4C: 0 mode select, 1 Option mode,
   2 straight on to a mode, 3 nothing.
3. `objects_draw` (0x80096B7C); the frame's end (DrawSync, VSync, GsSwapDispBuff, GsSortClear,
   GsDrawOt).
4. PadRead: held and newly pressed words for pads 1 and 2 (0x800BE126/8, 0x800BE12C/E). This is
   the tracer's sample point.
5. CD error recovery: if the CD error flag (0x800B911C) is set, CdReset(0) runs. If it returns
   1, the flag and 0x800B9120 are cleared and the current track (0x800B90F4) is played again
   from its start (Setmode, Setloc, Play).
6. `rand()` once.
7. `soft_reset_check`; the loop ends when the exit flag (S+0x1FCF4) is set.

The port's `Select.step` runs this in the order the tracer sees it (`Game.step`'s pattern).
Tick 0 runs the setup. Each later tick first runs the previous iteration's tail (PadRead, CD
recovery, rand, soft reset; it returns if the program exited), then the counter and the logic.

## 3. The mode select (S+0x4C = 0)

State: step 0x800B9094, cursor 0x800B90A0 (0 Classic, 1 Puzzle, 2 VS, 3 Edit, 4 Option), wait
0x800B90A4.

| Step | Function | What it does |
|---|---|---|
| 0 | `ms_background` 0x80097298 | Clears the objects, sets the cursor to 0, requests music 0x2F, places the background halves |
| 1 | `ms_title_in` 0x80097330 | "SELECT MODE" and its shadow (objects 20, 19) come in from the right; effect 6 |
| 2 | `ms_title_slide` 0x800973B0 | They slide left 6 pixels a tick until x ≤ 0x12 |
| 3 | `ms_tiles` 0x8009740C | The tiles, their shadows, the names (tables 0x800B2800-0x800B2878), the covers and the cursor |
| 4 | `ms_choose` 0x80097650 | Directions move the cursor through the table at 0x800B2760, which makes a ring: right goes 0→1→2→3→4→0. Only a lone direction counts, so a diagonal is ignored. Cross greys the other tiles and starts the zoom |
| 5 | `ms_zoom` 0x80097868 | The tile grows for 16 ticks (deltas at 0x800B27B0), then the large picture, the text and "one/two players". Circle shrinks it back |
| 6 | `ms_confirm` 0x80097B3C | Cross: the frame animation, effect 0, wait 75, step 8. Circle: step 7 |
| 7 | `ms_shrink` 0x80097C8C | Back to step 4 |
| 8 | `ms_flash` 0x80097E18 | The frame flashes for 75 ticks |
| 9 | `ms_leave` 0x80097E74 | The exit (§1) |

## 4. Option mode (S+0x4C = 1)

Phase S+0x50: 0 `option_setup` (0x80097F74), 1 `option_menu` (0x80098228), 2-5 the memory card
screens (§5), 7 back to the mode select. The setup stops the music, sets S+0x4B538 = 1, clears
the objects and copies the settings into the row variables. On the menu, Up and Down move the
cursor (row 0x800B9A4C, 0-12, effect 3 on each move). Every row is redrawn every tick, with the
highlighted images 0x38 further on (0x800BE048).

### Settings

The settings are the 24 bytes at S+0x4B4EC. They make up the save file's options (§6). SW_ON
sets them at power-on (from the card's save if it has one). The values below are the ones on a
card with no save.

| Address | Size | Row | Meaning | Values | At power-on |
|---|---|---|---|---|---|
| S+0x4B4EC | u32 | 0 (left turn), pad 1 | Player 1's left-turn button | a mask from the table at 0x800B297C: 0x20 Circle, 0x40 Cross, 0x80 Square, 0x10 Triangle, 4 L1, 8 R1, 1 L2, 2 R2 (in that order) | 0x40 Cross |
| S+0x4B4F0 | u32 | 0, pad 2 | Player 2's left-turn button | same | 0x40 |
| S+0x4B4F4 | u32 | 1 (right turn), pad 1 | Player 1's right-turn button | same | 0x20 Circle |
| S+0x4B4F8 | u32 | 1, pad 2 | Player 2's right-turn button | same | 0x20 |
| S+0x4B4FC | u8 | 4 | Sound: bit 0 = 0 stereo, 1 mono | 0, 1 | 0 |
| S+0x4B4FD | u8 | 5 | Music: 0 console, 1 arcade | 0, 1 | 0 |
| S+0x4B4FE | u8 | 2 | Level | 0 EASY, 1 NORMAL, 2 HARD, 3 VERY HARD | 1 |
| S+0x4B4FF | u8 | 8 | Music volume | 0-7 (does not wrap) | 7 |
| S+0x4B500 | u8 | 9 | Effect volume | 0-7 (does not wrap) | 7 |
| S+0x4B501 | u8 | 3 | Number of matches | 0-3: 1, 3, 5, 7 | 1 (3) |
| S+0x4B502-0x4B503 | | | not written by SELECT | | 0 |

Row behaviour:

- **Rows 0 and 1, the turn buttons.** Pad 1's Right/Left changes player 1's button, and pad 2's
  changes player 2's. The press must be exactly Right (0x2000) or Left (0x8000). If pad 1 has no
  such press, pad 2 is looked at; if pad 1 has one, pad 2 is still handled. The index into the
  8-entry table wraps. A button the other turn already has is skipped by one more step in the
  same direction. The row indexes are at 0x800BE114 [4], the shown masks at 0x800BE024 [2].
- **Rows 2 (level) and 3 (matches)** wrap 0-3 with Right/Left.
- **Row 4 (sound).** Right or Left flips bit 0. That calls SsSetMono or SsSetStereo, and CdMix
  with the matching attenuators (the port records it in `Select.mix`).
- **Row 5 (music)** flips 0/1. `bgm_request` (0x80095140) uses the id as the CD track directly
  when this is nonzero.
- **Row 6 (sound test, music).** The number 0x800B9ADC runs 0-49 and wraps. Cross plays CD track
  number + 2, looping, if the disc has that track (S+0x206E0 is the track count, 52). Before
  that it sets S+0x4B53C = 0 and the CD volume.
- **Row 7 (sound test, effects).** The number 0x800B9A34 runs 0-49. Cross plays that effect
  (`se_play` 0x80094D2C) after S+0x4B53C = 0.
- **Rows 8 and 9 (volumes).** 0-7, clamped. While a track has been chosen (bgm id 0x800B90C4
  is not 0x34), row 8 sets the CD volume every tick (SsSetSerialVol at the table value for the
  volume).
- **Rows 10 (OPTION DATA) and 11 (RANKING).** Right or Left toggles LOAD/SAVE (0x800B9C48,
  0x800B9C84). Cross goes to phase 2 + choice (options) or 4 + choice (ranking), subphase 0.
- **Row 12 (EXIT).** Cross stops the music and sets phase 7.

## 5. The memory card screens (phases 2-5)

`web/src/programs/select/card.ts` ports them with `web/src/flow/memcard.ts`. Phase 2 loads the
options, 3 saves them, 4 loads the ranking data, 5 saves it. Subphase S+0x54:

| Subphase | Load | Save |
|---|---|---|
| 0 | "select a slot" (`card_load_prompt` 0x80099E24 / `card_save_prompt` 0x8009A2FC) | same |
| 1 | `card_choose_slot` 0x80099EA8: Left/Right slot 1/2 (0x800BBD70); Cross goes on; Circle back to the menu (4) | same |
| 2 | `card_check_load` 0x80099F9C: check the card, read the file | `card_check_save` 0x8009A380: check the card; unformatted → "initialize?" (11) |
| 3 | `card_message_wait` 0x8009A114: a message for 120 ticks, then back to the slot prompt | same |
| 4 | `card_back` 0x8009A168: back to the menu (phase 1) | same |
| 5 | apply: `card_apply_options` 0x8009A1AC / `card_apply_ranking` 0x8009A1DC | `card_check_file` 0x8009A514: the file exists → "overwrite?" (7), else a free block → new file (6), else "card full" |
| 6 | | `card_save_new` 0x8009A668 |
| 7 | | `card_ask_overwrite` 0x8009A6F4: yes/no (No is the default); Circle → the slot prompt |
| 8 | | copy A updated: `card_fill_options` 0x8009A9C8 / `card_fill_ranking` 0x8009AA04 |
| 9 | | `card_overwrite` 0x8009A838 |
| 10 | | `card_format` 0x8009A8E0, after the "initializing" message's 3 ticks |
| 11 | | `card_ask_initialize` 0x8009AA40: yes/no |
| 12 | | → 6 |
| 13 | | `card_overwrite_check` 0x8009AC3C |

Objects: 60 the panel, 62 the yes/no or slot cursor (its choice in the object's +0x4C), 63 the
message. The timer is S+0x1FD0C.

`card_check` (0x8009B348) runs libcard's `_card_info`, then `_card_clear` and `_card_load` on
the slot's channel (0x00 or 0x10). It waits for each event and returns 1 for a ready card, 3 for
an unformatted one, 2 for a new card (cleared, then checked again), 0 for no card, and -1 for an
error. It stores the result at 0x800B9050 and the slot at 0x800BBD70. The file is opened through
the BIOS on `bu00:BASLUS-00338` / `bu10:BASLUS-00338` (paths at 0x800B1CB4 + 255 × slot,
devices at 0x800B1EB4 + 128 × slot):

- Read: up to 7 tries, mode 0x10001 (`card_read_options` 0x8009B678 / `card_read_ranking`
  0x8009B6B4).
- New file: up to 10 tries (`card_create_file` 0x8009B7D0). Open 0x10200 (create, one block),
  close, build the file, open 0x10002, write 8 KB, close. On a failure it closes and deletes
  the file.
- Overwrite: up to 16 tries, mode 0x10002 (`card_write_back` 0x8009D214).
- Free blocks: firstfile/nextfile over `bu00:*` (`card_used_blocks` 0x8009BEC8).

## 6. The save file

`BASLUS-00338`, one 8 KB block, built in the buffer at 0x800B9D58 (header at 0x800BD590):

| Offset | Size | Contents |
|---|---|---|
| 0x000 | 4 | Magic `d8 dc 13 01`. It should be "SC" + icon flag + 1 block, but the code stores the low bytes of the addresses of the strings "S" and "C" (0x800941D8, 0x800941DC). This is a bug in the original, kept |
| 0x004 | 64 | Title (Shift-JIS, from 0x800B1C74) |
| 0x044 | 28 | zeros |
| 0x060 | 0x1A0 | The icon CLUT and 3 frames, from the TIMs at 0x800B1A34, 0x800B1AF4, 0x800B1BB4 |
| 0x200 | 1 | Copy A's checksum (XOR of its 0x780 bytes) |
| 0x201 | 0x780 | Copy A: S+0x4AD84..0x4B503 (ranking data at +0xDC, settings at +0x768) |
| 0x981 | 1 | Copy B's checksum |
| 0x982 | 0x780 | Copy B: the same |

A load takes copy A if its checksum is right, else copy B (`card_verify` 0x8009BF50), and
copies only the part asked for: the 24 settings bytes, or the 0x78 ranking bytes. An option
save writes the settings and the ranking data into copy A. A ranking save writes only the
ranking data. The file is then written with both copies equal to copy A. A new file is built
from the whole block S+0x4AD84.

Quirks, all kept:

- **Format result → CD error.** `card_format` stores the format result (1 on success) in the
  CD error flag (0x800B911C) as well as in its own result. On the next tick the main loop's CD
  recovery runs: CdReset, then the current track is played again. In Option mode the music was
  stopped, but 0x800B90F4 still names the mode select's track (27), so that music starts again
  in Option mode (`select-format`, tick 4297).
- **A failed load says "unable to save".** The load's error message (the card is there, but the
  read failed or no copy is intact) uses the same image as the save's error.

## 7. Deviation: Classic, VS and Edit cannot be started

Only Puzzle Mode (PAZLE) is ported. The original starts NOMAL (9), VSPUZ (11) or EDIT (12) when
Cross confirms those tiles. The port shows them as the original does, and they open and close
the same way, but they cannot be started. The rule is in one function,
`Select.modeAvailable(tile)` (true only for tile 1, Puzzle), used in two places:

- **Step 6 (`ms_confirm`).** Cross on Classic, VS or Edit does nothing: no animation, no sound,
  and the screen stays on the confirmation. SELECT has no error sound to play there. Circle
  still goes back. Option (tile 4) and Puzzle behave as in the original.
- **param 2 (`select_direct`, via `Select.leaveForMode`).** For a mode the port lacks, it sets
  S+0x4C = 0, so the mode select shows instead of the program starting. No program on the disc
  sets param 2 (§1); this only guards the path.

`web/test/select.test.ts` ("deviation") checks both paths, and that Puzzle still starts PAZLE.

## 8. Verification

Movies (all from power-on with `boot power`, in `re/movies/power/`; traces in
`re/traces/<name>.jsonl.gz`). All use slot 2 empty (`card 2 none`), as the port's default does.

| Movie | Slot 1 | SELECT ticks | What it covers |
|---|---|---|---|
| `select-tour` | blank formatted | 2402-3827 (1,426) | The cursor ring and a diagonal; Puzzle, VS (Circle during the zoom), Edit, Classic opened and closed; Option. Every Option row: both pads' turn buttons with skips, Right+Cross ignored, level and matches round, stereo/mono, music mode, the music test (tracks 51, 3), the effect test, both volumes (the CD volume follows), the load/save toggles, Exit. Then Puzzle, Cross, Cross: PAZLE starts |
| `select-card` | blank formatted | 2402-4416 (2,015) | Option data load (no file: "data not found"), slot 2 (no card), Circle; save (new file); level up, save: overwrite No, then Yes; level down, load (the level comes back); ranking save (overwrite Yes), load; slot 2 (no card); Circle on the overwrite question and the slot prompt; Exit |
| `select-format` | unformatted (`TP_MEMCARD1=unformatted.mcd`) | 3299-4579 (1,281) | SW_ON's "initialize?" answered No and cancelled. Load (not formatted); save: initialize No, then Yes, format (the CD error quirk, §6), new file; load; Exit; the soft reset to TITLE. START is still held when TITLE starts in phase 9, so TITLE goes straight back to SELECT (tick 4583; not compared) |

`web/test/select.test.ts` replays each movie on the port twice: from power-on (see the end of
this section), and from SELECT's first tick. For the second, the state block comes from the
original's RAM at SELECT's main (`web/test/fixtures/select-starts.ts`, made by
`re/tools/extract_entry_state.py` from `TP_MAIN_RAM=1` dumps). It checks:

- every traced field, `rand()` count, upload, effect and music request, `ot` and `fb`, on every
  tick (`compareFlow`);
- the card the run leaves, against the SHA-256 of the emulator's `memcard1.mcd` at the end of
  the run;
- the CD commands the program issues (Setmode, Setloc, Play), which must open the trace's list
  for that tick. The trace's `cd` also holds the CD callback's commands when a track ends, which
  belong to the audio layer;
- the program named next: PAZLE in the tour, TITLE (soft reset) in the format movie.

Each program's setup runs InitCARD, StartCARD and `_bu_init` (`card_init` 0x8009AF68). On the
emulator this rewrites the card's frame 63 (the last directory frame) as a copy of frame 0 ("MC",
checksum 0x0E). That changes nothing on a card formatted by Redux or by `memcard.ts`, but it does
on a card the game formatted, whose frame 63 differs. `src/flow/memcard.ts` does not model it, so
the test applies it for `select-format`, where SELECT starts again after the format.

The first row of a program counts the previous program's last `rand()` (its loop's tail runs
after the tracer's last sample of it), so `Select` starts tick 0 with one call counted, as the
TITLE ports do. `Game` (PAZLE) now does the same when the console starts it.

In the runs from SELECT's first tick, the cards start as SW_ON leaves them: its check has already taken the new-card event of the
card in slot 1. The test calls `cards.clear(0)` to reproduce that. Without it, an unformatted
card reports "new card" once more and the run differs (subphase 2 returns 2 instead of 3).

SELECT also runs from power-on. With SELECT registered (`src/flow/registry.ts`),
`ranking-records` (`web/test/ranking.test.ts`) runs from tick 1 through SW_ON, TIT_DEMO, TITLE,
SELECT (ticks 2402-2677: the cursor to Puzzle, Cross, Cross), PAZLE and RANKING, and it is
identical. The SELECT movies are also compared from tick 1 ("from power-on" in the test): the
registry's factories run SW_ON, TIT_DEMO and TITLE first, with the cards as they were at power-on
(for `select-format`, SW_ON's unformatted-card prompt included), and every tick up to SELECT's
exit is identical; frames are compared for SELECT.

## 9. Notes for integration

- **Sound.** `Select.sound` records key-ons (`se_play`) and CD plays (`playTrack`); `Select.cd`
  records the program's own CD commands; `Select.mix` records the stereo/mono switch (SsSetMono
  or SsSetStereo plus CdMix), which is not a `SoundCall`. The CD callback `bgm_report_callback`
  (0x80094FF4) loops the mode select's music between ticks; it is not ported in the program
  (the audio layer's drive does it). `cdRecover` (CD error recovery) is ported in
  `web/src/programs/select/sound.ts`.
- **Power-on state.** The music test and `bgm_request` read the CD's track count at S+0x206E0
  (52). The entry state includes it; the power-on state used by `Console` must too.
- **Uploads.** The trace's `up` is the address the decompressor is given (0x800F4000 + the
  item's offset from 0x800B23EC); the port records item numbers in `Select.uploads` and maps
  them in `trace.ts`.
