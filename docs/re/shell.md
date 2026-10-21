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
| The programs around Puzzle Mode: copyright and card check, story intro, title, mode select with Options, rankings | Surveyed (§5); not ported. Until they are, the shell starts Puzzle Mode directly and starts it again when it exits |
| A complete run on the port | Open |

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
