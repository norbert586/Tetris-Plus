# RANKING.EXE (program 7): the ranking screens

RANKING.EXE shows the two ranking tables, Classic and Puzzle, side by side, then hands over to
the attract loop. It is ported in `web/src/programs/ranking/`, and the port matches the original
on every tick of three runs recorded from power-on: every traced field, every `rand()` call, the
ordering table's GPU packets (`ot`) and the drawn frame (`fb`). The hand-offs into the program
and out of it are listed in §1, and the tests and their movies in §5.

## 1. Hand-offs

**Who names RANKING.** A program names the next program in state+0x48 and its param in
state+0x4C. A scan of every EXE on the disc for stores of 7 to +0x48 finds four writers, and all
of them pass param 0:

| Writer | Address | When |
|---|---|---|
| HOW_P.EXE (the Puzzle demo) | 0x80098760 | The demo ends on its own. It is the last of TITLE → HOW_N → HOW_P. |
| HOW_VS.EXE (the VS demo) | 0x800979D0 | The demo ends on its own. TITLE → HOW_VS. |
| PAZLE.EXE | 0x800A1854 (`phase1_players`) | Both players are on screen 8 (idle): player 1 quit on the save screen, or the map found every zone cleared, while player 2 was idle. |
| NOMAL.EXE (Classic) | 0x80097A88 | Both players' screen words (state+0x4B508/0x4B50C) are 5. |

Nothing names RANKING with another param. The only stores of a non-zero param are each
program's own "param + 1" step: RANKING's phase 7, SELECT's option mode and TITLE.
**SELECT.EXE never names RANKING.** Its exits are TITLE (soft reset) and `9 + tile` (NOMAL,
PAZLE, VSPUZ, EDIT); its option mode keeps the ranking menu inside SELECT (load or save the
ranking data to a memory card). TITLE alternates the demos with bit 0 of state+0x4B540: HOW_N
(then HOW_P) first, HOW_VS on the next cycle. HOW_N names HOW_P (5); the HOW programs' other exits name TITLE (3, phase 9).

**What RANKING names.** This depends on its param (`param_dispatch` 0x80096840, table
0x80094000):

| Param | What happens | Next |
|---|---|---|
| 0 | The tables (§2), 440 ticks | TIT_DEMO (2), param 0, phase 0 |
| 1 | Leaves on its first tick (`param1_exit` 0x800968C8). No program uses this. | TIT_DEMO (2), param 0, phase 0 |
| 2, 3 | Empty functions: RANKING would run until a soft reset. No program uses these. | — |
| any | Start + Select held on either pad for more than 120 ticks (`soft_reset_check` 0x8009640C, in the loop's tail). The screen, step and sub-step words are cleared. | TITLE (3), param 0, phase 9 |

The attract loop on the original (`attract-cycle`, no input; two recordings of it, by different agents, were identical): SW_ON 0, TIT_DEMO 370, TITLE
2159, HOW_N 4622, HOW_P 7048, **RANKING 11457-11897**, TIT_DEMO 11897, TITLE 13687, HOW_VS
16150, **RANKING 19130-19570**, TIT_DEMO 19570, TITLE 21359, HOW_N 23822. Each number is the
frame counter at that program's main.

## 2. What it shows

There are no inputs apart from the soft reset, and RANKING makes no sound calls (§4).

| Phase | Function | Ticks | What it does |
|---|---|---|---|
| 0 | `phase0_clear` 0x80096E34 | 1 | Clears all 1,050 objects. Background halves: objects 10 and 11 (images 0x10001, 0x10002). |
| 1 | `phase1_titles` 0x80096EA4 | 1 | Heading (object 20) 64 px above its place; table titles (21, 22) 160 px off the left and right edges, velocity ±5 px. |
| 2 | `phase2_drop` 0x80096F70 | 64 | The heading falls 1 px a tick to y = 12. |
| 3 | `phase3_tables` 0x80096FBC | 1 | Builds both tables (below). Row r starts 200 + 40r px out: table 1 to the left, table 2 to the right. |
| 4 | `phase4_slide` 0x800976D0 | 72 | A title moves until its x is reached. A row (objects 100 + 32r … +31, or 260 + 32r …) moves while its rank object isn't at its place. The phase ends when both row-5 rank objects are in place. |
| 5 | `phase5_wait` 0x80097878 | 300 | Counts 0x800B2534. |
| 6 | `phase6_exit` 0x800978B4 | 1 | Exit flag; names TIT_DEMO. |
| 7 | `phase7_next_param` 0x800978E0 | — | param + 1 (never reached). |

**Records.** The records live in the shared state block, 5 entries of 12 bytes per table:

- Table 1 (Classic), state+0x4AE60: name letters at +0 to +2 (0x1F is a blank), score at +4
  (s32, 7 digits), lines at +8 (s16, 3 digits), level at +10 (s8, 2 digits).
- Table 2 (Puzzle), state+0x4AE9C: name at +0 to +2, score at +4 (s32, 7 digits), stage at +8
  (s8, shown as `(stage % 20) + 1`), zone at +9 (s8; zone 5, the 100-stage mode, shows no
  stage). The zone's mark is image `column 5 + [0, 3, 1, 2, 4, 5][zone]` (table 0x80094050). A
  zone byte outside 0-5 reads the stack in the original; the port throws.

The boot program sets the default tables, and Puzzle Mode's name entry (PAZLE screen 7) or
NOMAL's writes the new records.

**Layout.** The rank number object of row r sits at table 0x800AC354 (5 + 5 rows of image, x,
y). Each row uses one of three layouts (0x800AC4C8: rows 1-3 use layout 0 in table 1 and layout 1
in table 2, rows 4-5 use layout 2). A layout (0x800AC3CC, 0x54 bytes) has 7 column kinds of
{image, x, y} relative to the rank number:

| Kind | Content |
|---|---|
| 0 | name letters (image + letter) |
| 1 | score digits (7) |
| 2 | label (column 13) |
| 3 | label (column 16; table 2 only when zone ≠ 5) |
| 4 | lines / stage digits (3) |
| 5 | column 24: label in table 1, zone mark in table 2 (image + mark) |
| 6 | level digits (2, table 1) |

A kind whose image is 0 isn't drawn. Layout 2 draws only the name and the score, in smaller
fonts. `digits_set` (0x80096BDC) clears its digit objects, then fills them from the first one,
leaving out leading zeros; the last digit is always drawn. A value too large for its digits
draws `base + value / 10^(n-1)` as its first "digit": `ranking-records` shows 12345678 this way.

## 3. State

| Address | What |
|---|---|
| 0x800B2524 | the state block's address |
| 0x800B24E4 [2] | soft-reset counters |
| 0x800B2534 | phase 5's counter |
| 0x800B2538 / 0x800B253C | phase 3's row offset |
| 0x800B25C8 | GsGetActiveBuff |
| 0x800B52EC | pads, 6 bytes each: held +2, pressed +4, pad 2 held +8, pressed +10 |
| state+0x40 / +0x48 / +0x4C / +0x50 / +0x54 / +0x1FCF4 | flow words |
| state+0x5C | sprite objects, Puzzle Mode's layout |

The BSS (0x800B24FC-0x800B5300) is cleared by `start`. The data the port reads (0x80094000-
0x80094AD0, 0x800ABC80-0x800B24FC) is `rom.ts`, made by `re/tools/extract_core_rom.py`.
Function names are in `re/symbols/RANKING.game.tsv`; the trace fields are in
`re/lua/fields/RANKING.lua` (objects 0-419: image, x, y; the records; pads; counters).

The main loop (0x800956C0) runs in this order:

1. counter + 1
2. GsGetActiveBuff
3. GsClearOt
4. `param_dispatch`
5. `objects_draw`
6. DrawSync, VSync, ResetGraph(1), GsSwapDispBuff
7. GsSortClear(0, 0, 0), GsDrawOt
8. `pad_read` (the sample point is 0x80094B64)
9. `bgm_poll`
10. rand()
11. `soft_reset_check`

`Ranking.step` runs steps 8-11 for the previous tick first, as `Game.step` does.

## 4. Drawing and sound

**Drawing.** `objects_draw` (0x80096564) walks objects 1049 down to 0 and draws each one whose
image is above 0x10000:

- It uses the template for image − 0x10001; the templates are built from RANKINGE.BIN's 102
  items and are the same as Puzzle Mode's.
- Position: x = (x >> 16) − 0xA4 + w/2, y = (y >> 16) − 0x74 + h/2.
- Scale + 0x1000, rotation, and the flip bits (23, 22).
- Kind ≠ 0 sets `((kind & 7) − 1) << 28`. Unlike Puzzle Mode, there is no semi-transparency
  bit.
- Priority: the object's priority field.

Each sprite goes through GsSortSprite, then GsSortClear(0, 0, 0). GsSortSprite is matched by
code with PAZLE's, so `libgs.ts` serves unchanged. All 102 images are uploaded once, before
the loop (`templates_init`). The renderer is `web/src/programs/ranking/renderer.ts`.

**Sound.** `sound_init` (0x800954EC) does the usual init:

- SsInit, the VAB (its id goes to state+0x1FD34).
- SsSetSerialVol from the music-volume table 0x800ABC90.
- Reverb type 1, depth 8; SsSetRVol 0x20; SsSetMVol 0x7F.
- CdMix: stereo (0x7F, 0, 0x7F, 0), or 0x40 four times when state+0x4B4FC bit 0 is set.

In the loop RANKING calls neither se_play nor bgm_request: both are linked but have no callers.
It issues no CD command, and the traces show no key-on, CD command or SPU change after a run's
first tick. So `Program.sound`
stays empty, and the init is the audio layer's boot.

## 5. Verification

`web/test/ranking.test.ts` replays every RANKING run in these movies with `test/flow.ts`
`compareFlow`. Each run starts from the state block the original's RANKING found
(`test/fixtures/ranking-starts.ts`, made by `re/tools/extract_ranking_starts.py` from
`TP_MAIN_RAM=1` dumps; the ranges of `power-state.ts`). Each tick compares every traced field,
`rand`, `ot` and `fb`. The test then checks the hand-off: the program named equals the program
the original runs next.

| Movie | Ticks | Run | Result |
|---|---|---|---|
| `attract-cycle` | 26,000 | 11458-11897 (after HOW_P); 19131-19570 (after HOW_VS); both with the default records | identical; both name TIT_DEMO |
| `ranking-records` | 3,200 | Route to Puzzle Mode (title Start, Start; mode select Right, Cross, Cross). On tick 2700, pokes put player 1 on screen 8 and fill both tables with edge cases: blank letters, 9999999, 0, 12345678 (overflowing digit), zone 5, stage 19, 45 and 0xFF. Puzzle Mode then names RANKING. Run 2702-3069; pad 2 holds Start + Select from 2950. | identical; the soft reset names TITLE (phase 9), checked by running the tail with the next tick's pad |

When every program the movie runs before RANKING is ported and traced without gaps, the test
switches to a run from power-on (`FACTORIES` from `src/flow/registry.ts`). The attract movie
also runs HOW_N, HOW_P and HOW_VS, so it needs those too.

**RAM check.** The port's RAM after run 1 was compared with the original's at TIT_DEMO's main
(scratchpad check, not a test). The state block matches except:

- what the boot loader writes between programs: the file name at state+0x1FD2C, and object 0's
  image word at state+0x80;
- the GPU packet areas at state+0x206E4;
- the decode buffer at state+0x2AC74.

## 6. Deviations

- **Scratch memory.** The port doesn't write the sprite templates at state+0x3F074, the decode
  buffer at state+0x2AC74, the GPU packet areas or the ordering tables. The renderer builds
  templates from the pack, and no later program reads them.
- **First row's `rand`.** It counts the boot program's calls before main, which the port
  skips (like `mainseed`). The test checks that the seed at that row equals `mainseed`, then
  compares `rand` from 0.
- **Unreachable code.** Params other than 0-3, and a zone byte outside 0-5, throw `NotPorted`.
