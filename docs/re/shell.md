# Phase 9: flow and shell (in progress)

Phase 9 turns the port into something to play: the memory card, the browser shell around the
game (input, display, settings, persistence), the programs before and after Puzzle Mode, and a
complete run. This page records what is done so far.

## 1. Status

| Part | State |
|---|---|
| Memory card: the menu's Continue and the save screen's card steps | Ported. `card-save` and `card-continue` match the original: every traced field, every frame, and the 128 KB card image byte for byte |
| Browser shell: keyboard and gamepad input, remapping, scaling, scanlines, fullscreen, pausing, master volume | Done (§3) |
| Persistence: the cards in the browser, import/export as `.mcd` | Done (§4) |
| Several programs in one trace, the port's `Machine` | Done (§6): the tracer follows a movie through every program; the port runs them in turn on shared memory |
| SW_ON, TIT_DEMO, TITLE, SELECT (with Option mode), RANKING | Ported (§7): every movie that runs them is identical to the original, frames and card images included, from power-on |
| The attract demos HOW_N, HOW_VS | Not ported (they play the other modes); the `Machine` stands in for them with what they leave (§6), so the attract loop keeps the original's counter and random numbers |
| The other modes (Classic, VS Puzzle, Edit) | Not ported; choosing one in the shell returns to the mode select |
| JLOGO.EXE (the Jaleco logo) | Its video as WebM and MP4 (§8); the shell plays it at power-on |
| Sound of the programs around Puzzle Mode | Done (§10): every program's effects, music and CD traffic as the original's, `--audio` identical on the whole corpus; the browser plays them |
| A complete run | The port plays the whole game (§9); the movie is being checked on the original |

## 2. The memory card

The original keeps everything that persists on the card: one 8 KB file, `BASLUS-00338`, holds
the shared state block's persistent part (`state+0x4AD84`, 0x780 bytes).

| Offset | Bytes | Contents |
|---|---|---|
| `0x000` | `0xDC` | Best times (100 stages, then 10 more words) |
| `0x0DC` | `0x3C` | Classic mode ranking (5 × 12 bytes) |
| `0x118` | `0x3C` | Puzzle mode ranking |
| `0x154` | 6 | The three save slots: stage (`zone × 20 + stage`, `0xFF` empty), zones cleared |
| `0x15A` | `0x60E` | Edit mode's puzzles (by the defaults' contents: boards of piece cells) |
| `0x768` | `0x18` | Options: buttons, stereo, music mode, difficulty, volumes |

### 2.1 The file

`FUN_800B6858` builds a 0x200-byte header: magic, icon flag `0x13` (three frames), one block,
the Shift-JIS title "ＴＥＴＲＩＳ　ＰＬＵＳ", then the icon's CLUT and three 16×16 frames copied
from TIMs in the program (`0x800D4FC4`, `0x800D5084`, `0x800D5144`). The block follows twice,
each copy after its XOR checksum: the checksum at `0x200` and copy 1 at `0x201`, the checksum
at `0x981` and copy 2 at `0x982`. On load, a bad copy 1 is repaired from copy 2.

**Quirk: the magic is wrong.** The code stores the low bytes of the *addresses* of the strings
"S" and "C" (`0x80094910`, `0x80094914`) instead of the letters, so the file starts
`10 14 13 01` instead of `53 43 13 01`. The port keeps it. (SW_ON and SELECT, which also write
the file, store other address bytes the same way, `C8 CC` by the survey's reading; not yet checked
in a run.)

### 2.2 Card access

The game calls libcard's `_card_info` and `_card_load` and waits for one of four software
events in a `TestEvent` loop, then uses the BIOS file functions (`open`, `read`, `write`,
`close`, `delete`, `firstfile`/`nextfile`, `format`). `FUN_800B6074` turns the events into
one result: 1 ready, 0 no card, −1 error, 2 new card (the card's "new" flag is acknowledged with
a dummy write and the check runs again next frame), 3 unformatted. All of it blocks inside one
logic tick, so card access costs no ticks. Before a check the game calls `VSync(90)`: the
picture holds for 1.5 s. The core reports this as `Game.stall` and the shell holds the picture
for that long.

`web/src/core/card.ts` keeps the game's card routines and answers their BIOS calls from a model
of the card: a 128 KB image in the standard layout (frame 0 "MC", 15 directory frames, 15
blocks), the new-card flag, and the file calls' behaviour (create with `0x200` in the mode,
whole 128-byte sectors, deleted entries `0xA1`-`0xA3`). A blank card is byte for byte the one
PCSX-Redux creates.

### 2.3 The screens

- **Continue** (menu step 2, table `0x8009417C`, 11 steps): choose port 1 or 2 with
  Left/Right; the card is taken (a flag stops the other player using it at the same time),
  checked and loaded; the three slots show their stage, "no data" or "all cleared"; Cross on a
  slot continues its game (an empty one starts a new game), Circle goes back to the menu.
  Every failure shows a message for 120 frames and returns to the port choice.
- **Save** (screen 13 substeps 4-37, table `0x800941A8`): the same check and load; without a
  file, count the blocks in use (under 15 leaves room) and prepare a fresh file's contents
  (`FUN_800B3184`: no best times, the default rankings, empty slots, the default options);
  an unformatted card offers to format; a used slot asks before overwriting. Saving writes the
  slot, the best times and both rankings into the file, creating it first if needed. The
  player then leaves (screen 8).

### 2.4 Verification

- **Function level.** `cardToState` (`FUN_800B7128`), `stateToCard` (`FUN_800B7714`) and
  `cardDefaults` (`FUN_800B3184`) run in Unicorn on random file buffers and state blocks
  (`card_to_state`, `state_to_card`, `card_defaults` in `web/test/fixtures/unicorn/`); all
  cases match.
- **Movies.** Movies can now choose the cards: `card PORT blank|none|FILE` (FILE a `.mcd` or
  `.mcd.gz` under the repo). `scripts/run-movie.sh` installs the card in the emulator's fresh
  HOME and copies the cards out after the run (`card1.mcd`, `card2.mcd` in the run
  directory). Trace version 4 adds the card fields: `sub`, `card_port`, `slot_cursor`,
  `card_flags`, `card_result`, `card_io`, `saved_stage`, `slots`, `card_sum`.
- **`card-save`** (5,307 ticks): retire on Egypt 1, let the continue countdown run out, and
  save to the blank card in port 1 (no file, room checked, fresh contents, slot 1, the file
  created and written). Identical to the original: every traced field, every frame (GPU packets
  and pixels), and the card image the port writes is the original's, all 131,072 bytes. The
  card is kept as `re/cards/egypt1-saved.mcd.gz`.

### 2.5 `card-continue`

With that card in port 1: Continue, port 2 (a blank card: "data not found" for 120 frames),
port 1, the slots, Down, Up, Circle back to the menu, Continue again, slot 1: Egypt 1 starts.

Recording it found a boot difference: with a save on the card, SW_ON loads it at power-on and
the programs after it start about 90-110 frames later, so the `puzzle` route's mode-select
presses came too early. The new boot route `puzzle-saved` presses 120 frames later. The port's
replays apply SW_ON's load at power-on (`powerOnLoad`, a stand-in until SW_ON is ported).

Identical to the original over its 1,600 ticks: traced fields and frames.

### 2.6 Found while porting

- An empty save slot draws image `0x10000` (item −1). The renderer now treats it as the
  original does: the template before the array is all zero bytes, so it sorts a zero-size
  sprite that draws nothing.

## 3. The shell

`web/index.html` and `web/src/view/main.ts`, with `web/src/shell/`:

- **Loop.** Fixed steps at 59.826 Hz from `requestAnimationFrame`; input is read just before
  each tick. A `VSync(n)` wait holds the picture for n frames.
- **Input** (`shell/input.ts`). Keyboard, remappable in the settings, and every connected
  gamepad in the browser's standard mapping (bottom face button Cross, right Circle, left
  Square, top Triangle, shoulders L1/R1/L2/R2, Back Select, Start Start, d-pad and left stick).
  Pad 2 stays released until two-player mode exists (`docs/RESEARCH_AND_PLAN.md` §9).
- **Display.** 320×240 drawn to a canvas, scaled by whole multiples (default) or to fill the
  window at 4:3, pixelated; optional scanlines; fullscreen with F or a double click.
- **Pausing.** Esc opens the settings and pauses; leaving the tab or the window pauses too
  (input released, sound suspended).
- **Power-on.** The first key press or click switches the console on (browsers need a gesture
  for sound): the Jaleco logo plays (WebM, or MP4 where VP9 is missing), then the `Machine`
  starts SW_ON with the frame counter at 0 and the BIOS seed measured at power-on
  (`0x57729884`), and the programs follow as on the console: the card check and copyright, the
  story, the title, the mode select, Puzzle Mode, the rankings and the attract loop.
- **Other modes.** Choosing Classic, VS Puzzle or Edit on the mode select returns to it (the
  boot program is told to load SELECT, as TITLE's Start does) with a note in the status line.
- **Sound.** Starts with the first key press or click; a master volume in the settings.

## 4. Persistence

The shell stores the cards themselves (`shell/storage.ts`, `localStorage`), so progress,
best times, rankings and options persist exactly as the original keeps them, and a card moves
between the port and emulators as a `.mcd` file (import also takes `.mcr`, and `.gme`). The
settings panel can export, import and erase card 1, and put a second card in port 2 (it is
inserted with its new-card flag raised, as a real card would be). The shell's own settings
(keys, volume, scale, scanlines, port 2) are stored separately.

At power-on the shell applies SW_ON's load (`powerOnLoad`): a valid save in port 1 fills the
persistent block, as the original's startup does.

## 5. The programs around Puzzle Mode

A survey of SW_ON, TIT_DEMO, TITLE, SELECT and RANKING (and JLOGO, HOW_P) found:

- **The flow.** Power-on: JLOGO (Jaleco logo video) → SW_ON (card check, copyright) →
  TIT_DEMO (story intro) → TITLE. Start on the title goes to SELECT; 1,800 idle frames start
  the attract loop (how-to-play demos, rankings). SELECT starts the chosen mode (PAZLE is mode
  1) or edits the options in place. PAZLE exits to RANKING (300 frames, both tables) or, by
  soft reset or quitting, to TITLE.
- **The engine is shared.** Same main loop, sprite objects, image loading, sound calls and
  soft reset as PAZLE; the other programs use a simpler draw loop (sprites only, no box kinds or
  per-image offsets) and no new GPU primitives. All run at 320×240.
- **Option mode** (in SELECT) is the only place the options are edited: buttons, difficulty,
  stereo, music arrangement, volumes, sound test, card load/save.
- **Size.** About 530 game functions (SW_ON 128, TIT_DEMO 109, TITLE 94, SELECT 129,
  RANKING 75), roughly 64 KB of new logic beyond what PAZLE shares.

## 6. Several programs: the harness and the `Machine`

Every program loads at `0x80094000` and shares the boot program's state block, so the
verification follows the original from program to program.

**The tracer** (`re/lua/movie.lua`) knows each program by a profile (`re/lua/programs.lua`):
the first 16 bytes at `0x80094000` that identify it, its main function, the instruction after
its main loop's `PadRead` call (the sample point, where the movie's pad word is injected), its
`rand()` stub, `se_play`/`bgm_request`, image uploads, its CD calls and CD callback, its ordering
tables, and its traced fields. The programs other than PAZLE trace a common set (frame counter,
seed, pads, next program and parameters, exit flag, the players' screen words, Puzzle Mode's
menu rows) plus `obj`, a hash of all 1,050 sprite objects, and `persist`, a hash of the
persistent block (`state+0x4AD84`, what the memory card keeps), and the frame hashes `ot`/`fb`.

**Movies** (`.tpm`) chain programs with segments: `program NAME` starts the inputs, pokes and
`end` of the next run of that program; ticks count from that program's start. Lines before the
first `program` belong to the boot route's program (PAZLE), so the old movies are unchanged.
`boot power` presses nothing: the movie drives every program from power-on. A program the movie
doesn't name runs untraced with the pad idle. The trace writes a `{"seg":N,"program":...,
"fields":[...]}` line where each later segment starts. `TP_RAM_START=1` dumps RAM as each traced
program starts. The rewritten tracer gives the old movies the same traces as before
(`knossos2-lines` re-recorded: all 1,833 rows equal).

**The port** runs programs on a `Machine` (`web/src/core/machine.ts`), as the boot program does:
one program at a time on the shared memory, random numbers and cards; when one exits, the one it
named in `state+0x48` starts after `boot_settle` clears the players' screen words. Each program
extends `Program` (`web/src/core/program.ts`: the main loop's pad read, `rand()`, soft reset,
exit, per-tick events) and loads its own data image (`programs/<name>/rom.ts`, from
`re/tools/extract_core_rom.py` with the program's ranges) over zeroed program memory. Puzzle
Mode's `Game` runs on the machine too. A machine started at SW_ON begins from the shared block
as SW_ON finds it at power-on (`power-on.ts`, from `re/tools/extract_state.py`).

**Between programs** the boot program loads the next one from the CD. The port doesn't show
that pause (`docs/RESEARCH_AND_PLAN.md` §6), but the loader's main loop calls `rand()` once a
frame, and the BIOS generator is the one every program uses. The loader leaves the frame counter
alone. Measured on the original (`LOADER_RAND`), the number of calls is the same every time for
each transition, whatever the program did before: SW_ON → TIT_DEMO 200, TIT_DEMO → TITLE 260,
TITLE → SELECT 214, SELECT → PAZLE 414, PAZLE → RANKING 194, RANKING → TIT_DEMO 200 (plus the
one `rand()` in the exiting program's last main-loop iteration). The `Machine` makes the same calls, so a session
on the port gets the original's random numbers across the whole chain. Replays take the
counter and seed each program starts with from the trace.

**The attract demos.** After 1,800 idle frames TITLE starts a how-to-play demo, HOW_N or
HOW_VS in turn (`state+0x4B540` bit 0), which plays the other modes and goes on to RANKING.
They aren't ported; movie `attract` (power-on, no input, two rounds: 11,544 traced ticks, the
demos untraced) measured what each leaves, and the `Machine` applies it in their place
(`DEMO_STAND_IN`): the frames they and their loads take (HOW_N 6,835, HOW_VS 2,980), their
`rand()` calls with TITLE's last one (20,850 and 3,433), the shared words they write
(`state+0x18` 50, `+0x20` 19 or −11, `+0x24` 4 or 5, `+0x58` 102, `+0x4B540` 1 or 0), and
RANKING as the next program, phase 0. The sprite objects they leave don't matter: RANKING
clears them all as it starts. Run free from power-on with no re-syncing, the port's frame
counter, seed, objects and next-program words equal the original's on every tick of both
rounds; the replay is identical too, frames included.

**Rendering.** Each program's images come from its own data file
(`tools/extract-assets.ts` writes one pack per program: `swone`, `tdemoe`, `titlee`,
`selecte`, `rankinge`) and its sprite sorter: Puzzle Mode's `objects_draw` or the simpler one
SW_ON, TITLE, SELECT and RANKING use (`DrawStyle`, `web/src/render/programs.ts`): every live
object is a `GsSortSprite` of its template, centred on `int(x) − 0xA4`, `int(y) − 0x74` (TITLE,
RANKING) or `− 0x78`, with the ordering-table priority from the object (+10 in TITLE). RANKING
draws objects whose image is above `0x10000` and sets only the blend-rate bits; TITLE draws any
non-zero image and also sets the semi-transparency bit.

## 7. The programs

Each is ported from its decompile (`../tp-private/work/decomp/<EXE>.c`) into
`web/src/core/programs/<name>/`, in full, quirks included, and checked by movies recorded for
it (traces in `re/traces/`): `npm run trace -- --render` replays each from power-on and is
identical on every traced field, the GPU packet hash and the frame hash. The card movies also
compare the card images the run leaves with the emulator's, byte for byte.

### 7.1 RANKING.EXE

Ported in full (`programs/ranking/ranking.ts`, main `0x800956C0`). The two header banners, three
panels (the top one drops 1 px a frame, the other two come from the sides), then both tables
built at once off-screen: per row a name in three glyphs, a 7-digit score, then for Classic
lines (3 digits) and level (2), for Puzzle the stage (`stage % 20 + 1`, not shown for zone 5,
"all cleared") and the zone's picture. Numbers leave their leading zeros' places empty. Both
tables slide in 5 px a frame until in place, hold 300 frames, and the program starts TIT_DEMO.
No input but the soft reset, no sound (its sound code is there but nothing calls it; the set-up runs, §10).

**`ranking`** (5,501 ticks): `card-save`'s route, then Quit on the save screen: both players on
screen 8, Puzzle Mode exits to RANKING, which runs 440 ticks. Identical to the original, every
field and frame of both programs, on the first recording.

### 7.2 SW_ON.EXE

The card check and the copyright (`programs/sw_on/sw_on.ts`): all 36 steps of its state machine,
its own card routines (check, load, format; the create routine is ported but unreachable), the
copyright scroll, hold and fade. Movies: `sw-on-saved` (a save loads silently, 370 ticks),
`sw-on-port2` (port 1 empty, a blank card in port 2, 371), `sw-on-nocard` (no card: retry,
then on, 517), `sw-on-format` (an unformatted card, formatted on screen, 529),
`sw-on-noformat` (format declined: "can't save", 567), `sw-on-full` (15 blocks used, 517).

Found in the original:
- **Format never creates the file.** After "format" the step machine goes back to the check,
  which finds room and moves on: the card stays formatted but empty.
- **The format result lands in the CD watchdog flag** (`0x800B5D04`), so the next main-loop
  pass resets the CD and plays the lead-out (DataEnd about every 95 ticks until SW_ON exits).
  SELECT does the same with its own flag. The audio model plays it (§10).
- **New cards.** An unformatted card reports "new card" to the first `_card_info`; formatted
  ones don't (`MemoryCard.fresh`). `_card_clear`'s dummy write sends 128 bytes from RAM
  address 0 to frame 63 (2 at `0x60`, `0xFF` at `0x68`); the BIOS format leaves frame 63 alone;
  creating a file copies frame 0 over frame 63 (OpenBIOS). With these the card images match.
- The "formatting" message writes object 0's y twice and never object 1's; the unreachable
  header writer would store `0xC8 0xCC` for "SC"; main's pad init clears 48 bytes past the end
  of the BSS; there is no soft-reset check; the card check takes about 95 vblanks on the
  emulator (not held on the port).

`powerOnBlock` (`programs/sw_on/power-on-block.ts`) runs SW_ON headless for the persistent
block it leaves; replays and the simulator that start in Puzzle Mode use it.

### 7.3 TIT_DEMO.EXE

The story (`programs/tit_demo/tit_demo.ts`): the scene machine (fades, the scrolling picture,
the blinking captions), the text machine and its typewriter (three pages, wide glyphs), Start to
skip. It draws differently from the other programs (renderer style `titdemo`): objects with a
non-zero image, all in one bucket by object number, the per-image offsets for every image,
sprites at y − 0x70. Movies: `boot-story` (the whole story), `tit-demo-start` (Start during
setup, ignored, then at tick 1,200), `tit-demo-skip` (Start while the captions blink).

Found: the text never shakes (the shake amplitude is copied from a variable nothing writes); the
soft-reset check is linked but never called; one scene step fades an object that was never set
up, so it ends at once; the init's pad clear writes past the end of the BSS.

### 7.4 TITLE.EXE

The logo animation (`programs/title/title.ts`): ten phases with their sub-steps, the sparkles,
the letters, the white flash, Start to SELECT, and after 1,800 idle frames the attract demo
(HOW_N or HOW_VS by `state+0x4B540`). Movies: `boot-story` (the full animation and the
timeout), `boot-select`, `title-skip` (Start mid-animation), `title-early` (Start on tick 2),
`title-retire` (Puzzle Mode quits to the title, which starts at its last phase).

Found: Start on tick 2 skips phase 0 before it requests the title music, which then never
plays; a skip doesn't reset the step counter (phase 9 does); phase 1's fourth sub-step is
unreachable; there is no soft-reset check. TITLE re-uploads images through a buffer address,
which the tracer can't name, so its `up` field is empty; the frame hashes confirm the uploads.

### 7.5 SELECT.EXE

The mode select and Option mode (`programs/select/select.ts`, with its own card routines in
`programs/select/card.ts`): the banners, the icons and their neighbour moves, the zoom, the
confirmation, the 75-frame wait and the exit to the chosen mode; every Option row (both pads'
button configuration, difficulty, VS settings, stereo, music arrangement, music and sound test,
both volumes, card load and save, exit); the card screens. Movies: `boot-select`,
`select-moves` (every move, the zoom, Classic), `select-option` (every row with both pads, then
VS Puzzle), `select-card` (no data, no card, save, overwrite, load, Edit), `select-card-saved`
(load, overwrite, format and create on a second card, Puzzle Mode), `select-card-full` (a full
card, then the soft reset).

Found: the card header's magic is `D8 DC`, the low bytes of the strings' addresses (the same
slip as Puzzle Mode's); a new card leaves the step where it is, so it probes again next frame
after another `VSync(90)`; each pad configures its own player's buttons and skips the one the
other row holds; saving the options also copies the rankings; No on the overwrite or format
question goes back to the port prompt.

## 8. JLOGO.EXE: the Jaleco logo

JLOGO plays `J_PS.STR` with the library's MDEC and XA players: 120 frames at 15 fps (8 s), the
logo animating, then a fade to black, with sound. The port plays it as a video:
`tools/extract-video.ts` rebuilds the file's raw sectors (the disc's Form 2 file lacks their sync
and header) for FFmpeg's `psxstr` demuxer and encodes `public/assets/jlogo.webm` (VP9 and Opus,
134 KB) and `jlogo.mp4` (H.264 and AAC, 95 KB, for browsers without VP9). Its picture comes from FFmpeg's MDEC decoder, not the console's, so it isn't checked
pixel for pixel: an approximation of the original's decoder output.

## 9. A complete run

`tools/complete-run.ts` plays the whole game on the port and writes what it did as a movie,
`re/movies/complete-run.tpm`, for the original to play. From power-on with blank cards:
SW_ON; Start on the story and the title; Right, Cross, Cross on the mode select (Puzzle); in
Puzzle Mode Cross every 40 ticks (the menu, the map, the story pages, the stage screens, the
letters of the name), and once each stage's play has started a poke puts the professor on row
15, the goal, so the stage clears as if he had climbed there (the 100 boards aren't solved:
the run checks the flow, not the puzzles); after the ending the save screen saves to the card
in port 1, then Quit; RANKING; the story again, until the title starts.

On the port: 96,709 ticks (27 minutes): SW_ON 370, TIT_DEMO 101, TITLE 101, SELECT 667, Puzzle
Mode 94,927 (the 100 stages, five zone clears, the ending and credits, the game over, name
entry, the save), RANKING 440, TIT_DEMO 101, then TITLE.


## 10. Sound of every program

Every program the port runs now makes the original's sound: SW_ON, TIT_DEMO, TITLE, SELECT and
RANKING produce the same `SoundCall`s Puzzle Mode does, one audio model follows the machine from
program to program, and `npm run trace -- --render --audio` is identical on the whole corpus.

### 10.1 The sound code in each program

Each program links its own copy of PAZLE's sound code (`se_play`, `bgm_request`,
`bgm_play_track`, the CD report callback, the main loop's CD watchdog, the set-up) and of
libsnd, at its own addresses. `web/src/core/sound.ts` keeps one `SoundAddresses` table per
program (`PROGRAM_SOUND`); `Program` (`program.ts`) calls `sePlay`, `bgmRequest`, the set-up
and the watchdog through its program's table, so the ports call them where the originals do.

| | PAZLE | SW_ON | TIT_DEMO | TITLE | SELECT | RANKING |
|---|---|---|---|---|---|---|
| `se_play` | `0x80095778` | — | — | `0x80094D30` | `0x80094D2C` | — |
| `bgm_request` | `0x80095DA8` | — (`bgm_play_track`-like `0x800953FC`, uncalled) | `0x800951FC` | `0x800950E8` | `0x80095140` | — (`0x80095460`, uncalled) |
| Sound set-up | `0x800961C4` | `0x800955A0` | `0x80095544` | `0x80095518` | `0x800955F0` | `0x800954EC` |
| CD callback | `0x80095C5C` | `0x80094FA4` | `0x800950D4` | `0x80094FC0` | `0x80094FF4` | `0x8009507C` |
| Watchdog (flag) | `bgm_poll` `0x80095B08` (`0x800ED394`) | in main (`0x800B5D04`) | `0x80094FBC` (`0x800B5DDC`) | in main (`0x800B42F0`) | in main (`0x800B911C`) | `0x80094F64` (`0x800B25A8`) |
| Music volumes (+0x10 effect volumes, +0x20 effects) | `0x800DC45C` | `0x800AF0A8` | `0x800AECDC` | `0x800AD868` | `0x800B1FB4` | `0x800ABC90` |
| Track table (end, mode, priority) | `0x800DC610` | `0x800AF25C` | `0x800AEE8C` | `0x800ADA18` | `0x800B2168` | `0x800ABE40` |
| `bgm_request` state (playing side, id, wanted ×2, join ×2) | `0x800ED338` | `0x800B5CA8` | `0x800B5D80` | `0x800B4294` | `0x800B90C0` | `0x800B254C` |
| Side (`se_play`'s player), zones, zone tunes | `0x800EEAD0`, `0x800EEBB0`, `0x800DC880` | — | `0x800B5D18`, `0x800B5D6C`, `0x800AF0FC` | `0x800B4328`, `0x800B4334`, `0x800ADC88` | `0x800B90A8`, `0x800B90AC`, `0x800B23D8` | — |
| libsnd pitch table, flush index | `0x800EC94C`, `0x800EDBA8` | `0x800B52BC`, `0x800B6514` | `0x800B5338`, `0x800B66B4` | `0x800B38A0`, `0x800B4B78` | `0x800B86B4`, `0x800B994C` | `0x800B1B60`, `0x800B2E00` |

The tables hold the same values in every program (volumes, effects, tracks, pitches); only the
words before the track table differ, which is what a play of "track 0" reads (below).

Who calls what:
- **SW_ON** plays nothing itself; its set-up runs, and the format quirk (§7.2) starts the CD.
- **TIT_DEMO** requests the story music (request 2, track 2, plays once) on every frame of its
  phase 0; the first call plays it, the others find it already playing and return.
- **TITLE**: request `0x22` (track 3, looping) as the logo starts, effect 0 on Start, effect `0x19`.
- **SELECT**: request `0x2F` at the mode select, `0x34` (stop) into Option mode and out of it,
  effects on every move. Option mode adds the only direct calls: the **music test** sets
  `bgm_request`'s playing id to the track, sets the CD volume and plays the track looping
  (no request); the **music volume** row calls `SsSetSerialVol` every frame unless the playing
  id is `0x34`; the **stereo** row calls `SsSetMono`/`SsSetStereo` and `CdMix` at once (the
  new `mono` call). The effect volume row only changes the setting.
- **RANKING**: nothing; its set-up runs.

### 10.2 What the model does at a program's start

Each program's first step records `init` (its main's `CdInit`, then its sound set-up). The
model (`web/src/audio/model.ts`) then, at the start of that tick (the load):

- **The drive.** `CdInit` sends CdlInit, which (Redux's `cdlInit`) stops playing and puts the
  head at 00:02:00; the program's CD variables are fresh BSS (no track, no loop). Nothing of the
  previous program's music survives: the loader's reads had stopped it anyway. This is why
  Puzzle Mode's head position was fitted at 150 in Phase 8.
- **The SPU.** All voices keyed off, the mix, CD volume (the program's music volume table)
  and reverb registers as Puzzle Mode's set-up writes them: every program's tick 1 shows the
  same `koff`, `spu` and `rev`.
- **libsnd.** A fresh voice manager on the program's own pitch table, mono from the setting.
  Its flush history index (§3 of audio.md) counts the flushes since the program's `SsStart`;
  read from RAM dumps at each program's first sample (`TP_RAM_AT=1`; `movie.lua` now names a
  later program's dumps `ram_sSEG_TICK.bin`): PAZLE 13, SW_ON 12, TIT_DEMO 15, TITLE 15,
  SELECT 8, RANKING 8. SW_ON's is 12 whether its first tick took 27, 99 or 170 vblanks (the
  card check before `SsStart`); SELECT's is 7 in `select-card`, one vblank of the image load
  after `SsStart` that the port can't know. The corpus is identical with either.
- **CdMix** to stereo or mono, which the player applies to the CD's channels.

`bgm_request`'s state (playing side 0, ids `0x34`) is set by `soundInit`; Puzzle Mode's port
now does it too (before, its playing id started at 0 instead of `0x34`, which only matters for
a stop request before any music, which no movie had).

### 10.3 The CD watchdog and the end of the disc

The callback sets the watchdog flag on any interrupt but DataReady; the main loop's tail then
calls `CdReset(0)` and plays the current track again from its start (`restart`). The drive model
now does what Redux does at the end of the disc: playing past the lead-out stops the drive with a
DataEnd interrupt (`[4, 2, 0, …]` in the trace's `cdr`). The CdReset runs right after the
sample and blocks the tick (8-10 vblanks); the drive stops there (CdlInit), and the commands
follow when it returns.

**The format quirk** (SW_ON and SELECT store `format()`'s result in the flag): the next tick
restarts the current track. In SW_ON that is track 0, so the TOC's entry 0, the lead-out
63:46:00 (the TOC is the boot program's at `state+0x20550`; the model takes it from the disc,
and entry 0 is the disc's end rounded down to a second, the same 53 entries): the head seeks
from 00:02:00 across the disc (0.86 s), plays the last 53 sectors (0.71 s, too short for a
position report) and hits the end; DataEnd sets the flag again, and the cycle repeats every
94-97 ticks until SW_ON exits (`sw-on-format`: four plays, at ticks 164, 259, 356 and 453, each matching). In SELECT,
the track bgm_request last played (`select-card-saved`: track 47, stopped by request `0x34`
but still spinning) starts again from its start, audible only if the volume is up. Puzzle
Mode's `bgm_poll` is ported too: a non-looping track left to run into the end of the disc would
restart the same way (no movie gets there).

### 10.4 The player

`AudioPlayer` (`web/src/audio/player.ts`) takes the machine's memory once and follows
whichever program runs: nothing is read at Puzzle Mode's addresses any more. CdMix is a gain
matrix that each `init` and the stereo row set (`0x7F` per side, or `0x40` from each side to
both). The shell ticks the model with `1 + stall` vblanks, so the music runs on through a
held picture (`VSync(n)`). `tools/render-audio.ts` renders a whole multi-program movie.

### 10.5 Verification

`npm run trace -- --render --audio`: all 30 movies with traces identical (sound per tick; CD
commands and reports within a tick, as audio.md §6), 106,637 ticks, 35,619 of them outside
Puzzle Mode: SW_ON 7,311, TIT_DEMO 12,993, TITLE 8,768, SELECT 5,227, RANKING 1,320. Outside
Puzzle Mode the corpus has 165 key-ons, 113 CD commands and 3,844 reports. By movie:

| Movie | Ticks | | Movie | Ticks |
|---|---|---|---|---|
| boot-select | 1,359 | | select-option | 1,775 |
| boot-story | 4,622 | | sw-on-format | 529 |
| ranking | 5,501 | | sw-on-full | 517 |
| attract | 11,544 | | sw-on-nocard | 517 |
| card-continue | 1,600 | | sw-on-noformat | 567 |
| card-save | 5,307 | | sw-on-port2 | 371 |
| select-card | 1,839 | | sw-on-saved | 370 |
| select-card-full | 1,441 | | tit-demo-skip | 831 |
| select-card-saved | 1,393 | | tit-demo-start | 1,581 |
| select-moves | 1,017 | | title-early | 2,365 |
| title-retire | 5,546 | | title-skip | 2,565 |

and the Puzzle Mode movies as before (atlantis20-ending 8,451, egypt1-climb 5,108, egypt1-idle
17,600, egypt20-zoneclear 4,000, hundred-select 6,731, input-edges 4,368, knossos2-lines
1,832, pause-retire 5,390). The traces needed no new hooks: `programs.lua` already hooked each
program's callback and CD calls, and the SPU's registers are watched whatever runs. Re-running
`boot-select`, `ranking`, `select-card`, `sw-on-format` and `sw-on-port2` for the RAM dumps gave
the committed traces' values on every field. `npm test` (87 tests) and `npx tsc --noEmit` pass.
