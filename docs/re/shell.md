# The shell (Phase 9)

The browser page around the game: `web/index.html` and `web/src/shell/`. It runs the whole game
from power-on (`web/src/flow/console.ts`, docs/re/flow.md) and adds only what a browser needs.

## Start

Browsers start sound and fullscreen only after a user gesture, so the page waits for a click, a
key or (once the page has focus) a gamepad button. Then:

With a saved game, the page instead offers **Continue** (Enter, or Start or Cross on a gamepad)
or **New game** (N, or Select), with where and when it was saved. A gamepad button acts when it
is released, so the game doesn't see it held. Continue skips the logo and the programs before
Puzzle Mode (see Saving below); New game is the start below, and keeps the save.

1. The Jaleco logo plays as a video (`public/assets/jlogo.webm`, `jlogo.mp4` for browsers without
   WebM), made from `J_PS.STR` by `tools/extract-video.ts`: 120 MDEC frames at 30 frames a second
   (double-speed CD, five sectors a frame) with its XA audio. The original's `JLOGO.EXE` plays the
   same stream with the MDEC; the port shows the decoded video instead (the only part of the game
   not drawn by the GPU model). Any key skips it, and a setting turns it off.
2. The Console starts `SW_ON.EXE` with the state block as the boot program leaves it at power-on
   (`web/src/flow/power-state.ts`). Its mode select shows Puzzle, Option and Stats, centred
   (`browserMenu`, `docs/re/select.md` §7).

All program packs are fetched before the gesture prompt (about 7 MB), so programs change without
a pause, as decided (no loading pauses, docs/RESEARCH_AND_PLAN.md §6).

## Timing

`requestAnimationFrame` with a fixed-step accumulator: one tick per 1/59.826 s (NTSC progressive)
whatever the display's refresh rate, at most 250 ms of catch-up after a stall. Input is read right
before each tick. The frame shown is the last tick's display buffer.

## Input (`input.ts`)

Keyboard and the Gamepad API (standard mapping, plus the left stick as the d-pad) give pad 1's
PadRead word; pad 2 stays released until two-player mode exists. Defaults: arrows, X Cross, Z
Circle, A Square, S Triangle, Enter Start, Right Shift or Backspace Select, Q/W L1/R1, 1/2 L2/R2;
on a gamepad the PlayStation layout (Cross bottom, Circle right). A d-pad can't press opposite
directions together, so from the keyboard the direction pressed last wins. Everything is
rebindable in the settings.

## Settings (`settings.ts`, `panel.ts`)

Escape pauses and opens the panel: controls (keyboard and gamepad, one binding per click), scale
(whole multiples of 320x240 by default, or fill the window at 4:3), optional scanlines,
fullscreen (also Alt+Enter or a double click), master volume, pause in the background (on by
default) and the logo video. They are saved in `localStorage` (`tetris-plus.settings.v1`).
The panel also exports card 1 as a raw `.mcd` (the same bytes as an emulator's card file),
imports one (`.mcd`, `.mcr`, or a DexDrive `.gme`) and erases it to a formatted empty card. While
the game runs, an import or erase is a card swap: the card is inserted with its new-card flag
raised, so the programs see a new card at their next check, as on the console.
The game's own settings (turn buttons, stereo/mono, music mode, volumes) stay in its Option mode
and its memory-card save, as on the console.

## Saving (`web/src/flow/snapshot.ts`, `saves.ts`)

One saved game, made on Puzzle Mode's pause screen: while player 1's "PAUSE" shows (screen 12,
step 0), a note over the game says "Press △ (S) to save your game", and a fresh Triangle press
saves (the game ignores Triangle there). The settings panel also has **Save now** (enabled on
that screen), and **Load** and **Delete** for the save. Saving again replaces the save.

- **What a save holds** (`Snapshot`): the 2 MB of RAM (Puzzle Mode keeps all its state at the
  original's addresses), the BIOS rand() seed, the program's tick count and the renderer's VRAM
  (1 MB), plus where and when (zone, stage, 100-stage mode; shown as "Egypt, stage 3"). It is
  kept in IndexedDB (`tetris-plus` / `saves` / `game`); saving also asks the browser to keep the
  site's storage (`navigator.storage.persist`). The memory card is not part of it.
- **Resuming** starts the Console on the saved RAM with Puzzle Mode carrying on at the saved tick
  (`ConsoleOptions.resume`; `Game` skips its start-up), puts the VRAM back in a new renderer and
  shows the saved frame. The pause screen is where the game has stopped its music, so the sound
  starts afresh (`AudioPlayer.reset`: a new model for Puzzle Mode, every voice keyed off), and
  unpausing restarts the stage's music as the game always does.
- **Exact**: `web/test/snapshot.test.ts` saves on the pause screens of `full-run` and
  `pause-retire`, resumes from a structured clone of the save (as IndexedDB stores it), and checks
  that every later tick equals the run that was never saved: the RAM, the program, its sound calls
  and image uploads, and every frame (`ot`, `fb`, and the pixels at the end), through RANKING and
  TIT_DEMO in `full-run`.
- A save from a later port whose format changed is not offered (`SNAPSHOT_VERSION`).

## Records and Stats (`web/src/flow/records.ts`, `stats.ts`)

- **Records on the card.** After every tick (except during SW_ON, which loads them), the shell
  compares the records in RAM (best times and both rankings, the saved block's first 0x154
  bytes) with the last it saw; when they change (a stage cleared faster, a name entered), it
  writes them into card 1's save file, merged with the card's, so a loaded save can't lower them
  (`docs/re/memcard.md` §7). Loading a save also merges the card's records into its RAM, so the
  stage's best time on screen is the real one.
- **The Stats page**, from the mode select's Stats tile (`docs/re/select.md` §7): progress (stages
  with a best time, of 100, and per zone), time played (in all and in Puzzle Mode), the Puzzle
  ranking, and every stage's best time as the stage clock shows it. Plain HTML over the game, like
  the settings. Up/Down scroll it; Cross, Circle, Start or Escape close it (the game gets no
  buttons while it is open).
- **Time played** is the shell's count of ticks run (none while paused), kept in `localStorage`
  (`tetris-plus.playtime.v1`, saved every 600 ticks and when the page closes).

## Pause

When the window loses focus or the tab is hidden, the game stops between ticks and the audio
context is suspended; a click or key resumes it. Keys held while focus left are released.

## Development

`?start=NAME` starts at another program (for example `?start=PAZLE`) with the power-on state
block. `npm run dev` serves the page.
