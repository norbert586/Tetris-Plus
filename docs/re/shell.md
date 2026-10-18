# The shell (Phase 9)

The browser page around the game: `web/index.html` and `web/src/shell/`. It runs the whole game
from power-on (`web/src/flow/console.ts`, docs/re/flow.md) and adds only what a browser needs.

## Start

Browsers start sound and fullscreen only after a user gesture, so the page waits for a click, a
key or (once the page has focus) a gamepad button. Then:

1. The Jaleco logo plays as a video (`public/assets/jlogo.webm`, `jlogo.mp4` for browsers without
   WebM), made from `J_PS.STR` by `tools/extract-video.ts`: 120 MDEC frames at 30 frames a second
   (double-speed CD, five sectors a frame) with its XA audio. The original's `JLOGO.EXE` plays the
   same stream with the MDEC; the port shows the decoded video instead (the only part of the game
   not drawn by the GPU model). Any key skips it, and a setting turns it off.
2. The Console starts `SW_ON.EXE` with the state block as the boot program leaves it at power-on
   (`web/src/flow/power-state.ts`).

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
The game's own settings (turn buttons, stereo/mono, music mode, volumes) stay in its Option mode
and its memory-card save, as on the console.

## Pause

When the window loses focus or the tab is hidden, the game stops between ticks and the audio
context is suspended; a click or key resumes it. Keys held while focus left are released.

## Offline

Installing and offline play (Phase 10).

The production build is a progressive web app. `public/manifest.webmanifest` names it, sets
fullscreen landscape and its icons, so browsers offer to install it. `public/sw.js`, the service
worker, is registered only in the production build:
- on install it caches the page, the manifest and the icons; the script, packs, sound bank and
  music are cached on first use, so one complete visit makes the game playable offline;
- pages are fetched from the network first, falling back to the cached `index.html` offline;
- everything else comes from the cache, and files without a content hash in their name (packs,
  music) are refreshed in the background, so a deploy reaches players on their next visit;
- range requests (the logo video) go to the network.
Bump `CACHE` in `sw.js` to drop old caches.

## Performance

Frame hashes (`ot`, `fb`) are only for comparing with the original's traces; the shell turns them
off (`hashing.frames` in `src/render/renderer.ts`). `tetrisPlusStats` in the browser console
counts ticks, frames and the time spent per frame (`busyMs`, `worstMs`). `npx tsx tools/bench.ts`
times every program of the full-run movie in Node (`--hash` with hashing on). Measured figures
are in `docs/re/phase10.md`.

## Development

`?start=NAME` starts at another program (for example `?start=PAZLE`) with the power-on state
block. `npm run dev` serves the page.
