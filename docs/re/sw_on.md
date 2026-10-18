# SW_ON.EXE: the copyright screen and the boot card check (Phase 9)

SW_ON.EXE is program 1, the first program the boot program (SLUS_003.38) loads after JLOGO. It
checks the memory cards, loads the save file into the shared state block (or puts the defaults
there), shows a card screen when no card is usable, then scrolls the copyright text, fades out and
hands over to TIT_DEMO (program 2). Port: `web/src/programs/sw_on/` (`sw_on.ts` the logic,
`renderer.ts` the frames, `rom.ts` its data). Names: `re/symbols/SW_ON.game.tsv`. The card
itself: [memcard.md](memcard.md).

## 1. Verification

`web/test/sw_on.test.ts` replays each movie from power-on (`compareFlow`, `onlyFirst`) and requires
every SW_ON row of the original's trace to be equal (all fields of `re/lua/fields/SW_ON.lua`,
the 0x780-byte saved block included, plus the GPU packet and frame hashes). Where SW_ON writes to
the card, the card image after the run must equal PCSX-Redux's byte for byte.

| Movie (`re/movies/power/`) | Cards (slot 1, slot 2) | Path | Rows |
|---|---|---|---|
| `sw_on-attract` | formatted empty, none | default: no save file, defaults, copyright, TIT_DEMO | 1-370 |
| `sw_on-nocard` | none, none | "not inserted" (8); Cross retries, Circle goes on without saving (28) | |
| `sw_on-unformatted` | unformatted (zeros), none | "initialize?" (12): cursor moves, yes formats (16-18); card checked against Redux | |
| `sw_on-full` | 15 files of another game, none | "insufficient memory" (24); Cross retries, Circle goes on | |
| `sw_on-save` | `re/movies/cards/saved.mcd`, none | a save file: copy A into the state block | |
| `sw_on-save-bad-a` | the same, copy A corrupted | copy B is checked, copied over A and loaded | |

The movies name their cards with `card SLOT none|blank|PATH` lines (scripts/run-movie.sh); the
first four were recorded with `TP_MEMCARD1/2`, which the test's `web/test/sw_on-cards.ts` mirrors.

## 2. Main loop (0x800957B0)

Counter `state+0x40` += 1 → logic (table 0x800940F8 by `state+0x4C`) → `objects_draw` → VSync →
swap → GsSortClear → DrawOt → PadRead (the trace's sample point) → pressed bits → the CD-reset
check (§5) → `rand()`. The port's `step` runs the tail of the previous iteration first, then the
counter and the logic, like the core's `Game.step`.

Before the loop `main` sets the CD volume from table 0x800AF0A8 by the music volume setting
(`state+0x4B4FF`); the port records it as a `cdvol` sound call in the constructor. The program's
BSS (0x800B5C38-0x800BACD4) is cleared. The decompression buffer (`state+0x2AC74`) and the sprite
templates (`state+0x3F074`) it fills at start are not written to the port's RAM: no traced field
reads them (the renderer keeps its own templates).

## 3. States (table 0x800940F8, by `state+0x4C`)

| State | What |
|---|---|
| 0 | objects cleared, slot 0, `state+0x4B538` = 1, defaults into the saved block |
| 2 | VSync(60) |
| 3 | the card check, one slot per tick (below) |
| 4-6 | the copyright text scrolls up 2 lines a tick, stays 180 ticks, fades over 64 (subtractive box) |
| 7 | `state+0x4B538` = 1, exit to program 2 (TIT_DEMO) |
| 8-9 | "memory card is not inserted": Cross checks again (0), Circle goes on (28) |
| 12-13 | "not initialized: initialize?" yes/no; yes 16, no 32 |
| 16-18 | check again, "initializing...", format; ok → 4, failure → 20 |
| 19 | create the save file and write the defaults: **no path leads here** |
| 20-21 | "unable to initialize" (retry / go on) |
| 24-25 | "insufficient memory" (retry / go on) |
| 28 | no saving this session → 4 |
| 29 | a yes/no that **no state leads to** |
| 32-33 | "unusable card" (retry / go on) |

State 3: `card_status` (0x800977CC) on the slot, repeated up to 7 times while it returns −1.
2 (a new card, cleared) waits a tick. 1: `save_read`; with an intact copy, copy A goes into the
saved block (→ 4). Without one, defaults; if the card has fewer than 15 blocks in use → 4. Else, or
with no usable card, the other slot is tried; after both, the screen depends on the two results.

**The `$s2` quirk:** `save_read` (0x80097B24) loops on a variable it never initialises, the
caller's `$s2`, until it is 1. In SW_ON `$s2` holds 0x800B8928 at that point, never 1, so the loop
behaves as intended (it ends on success or after 10 tries). The port keeps a local flag.

## 4. Frames

`objects_draw` (0x80096A48) sorts objects 1049 down to 0 with a live image as GsSortSprite of the
template FUN_800961E0 built for it (the same sprite as Puzzle Mode's `spriteTemplate`); priority
`+0x40` + 10; flip bits `+0x44`, blend kind `+0x14`. The fade is a box fill sorted during the
logic at priority 0. All 24 images are uploaded when the program starts (FUN_80095EC8); later
uploads put the same images at the same places.

## 5. The CD reset after a format (not modelled)

`format()`'s result variable 0x800B5D04 is also the main loop's "reset the CD" flag. After a
successful format (state 18) the next tail calls CdReset and, once it succeeds, clears the flag
and tells the CD to play from the TOC entry of track `0x800B5CDC`; the trace shows a garbage
Setloc (`cd [[14,5],[2,99,70,0],[3]]` at ticks 104 and 199 of `sw_on-unformatted`). The port sets
`SwOn.cdReset` on that tick and leaves the CD commands to the audio layer.
