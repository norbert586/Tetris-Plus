# Phase 7: renderer and assets (2026-10-18)

Puzzle Mode now draws in TypeScript (`web/src/render/`), from the original's own art, and its
frames are the original's. The exit criterion is met: **every frame of the trace corpus is
pixel-identical to the original's**, and so is the list of GPU commands that draws it (§5):

- 8 movies, 53,480 ticks, every screen of Puzzle Mode the corpus reaches: menus, password
  entry, the map, story scenes, stage intro and rules panels, play, pause and its menu,
  continue, game over, stage and zone clear, the ending and credits, name entry and the save
  screen;
- per tick, three things compared exactly: the images uploaded to VRAM (`up`), a hash of the
  frame's GPU packets (`ot`), and a hash of the 320×240 frame the GPU drew (`fb`).

The reference is PCSX-Redux's software GPU at our pinned build. Real hardware wasn't compared
(§7).

What else this phase delivers:

- **An asset pipeline.** `web/tools/extract-assets.ts` checks the disc's files by SHA-1 and
  decodes `PAZLEE.BIN`'s 1,235 images into `web/public/assets/pazlee.pack` (3.4 MB, 650 KB
  gzipped), which is committed. The decoders (`web/src/assets/`) are TypeScript, so a future
  in-browser importer can reuse them (§2).
- **A browser preview.** `npm run dev` in `web/` plays the port in the browser with the keyboard
  on pad 1 (§6). The real shell is Phase 9.
- **A way to look at the original's draw list.** `re/tools/otdump.py` decodes a frame's GPU
  packets from a RAM dump, and the harness can now dump VRAM (§4).

## 1. Files

| Path | What it is |
|---|---|
| `web/src/assets/archive.ts`, `tim.ts`, `pack.ts` | The data-file codec (method byte, LZ), TIM parsing, the web asset container |
| `web/tools/extract-assets.ts` | The asset pipeline: disc files → `web/public/assets/pazlee.pack` |
| `web/src/render/gpu.ts` | The GPU model: VRAM, the GP0 commands Puzzle Mode sends, Redux's pixel rules |
| `web/src/render/gte.ts` | The geometry coprocessor's RTPS and its division, for GsSortSprite |
| `web/src/render/libgs.ts` | libgs's ordering table and packet builders (GsSortClear, GsSortFastSprite, GsSortSprite, GsSortBoxFill) |
| `web/src/render/renderer.ts` | `Renderer`: VRAM uploads, the port of `objects_draw`, one frame per tick |
| `web/src/render/present.ts` | 15-bit to RGBA, and a small PNG writer for tools |
| `web/src/view/main.ts`, `web/index.html` | The browser preview |
| `web/test/render.test.ts` | Frame equality over the corpus; the player-2 deviation |
| `web/tools/frames.ts` | Plays a movie and writes chosen frames as PNG |
| `web/tools/render-dump.ts` | Draws one frame from an emulator RAM + VRAM dump and compares packets and pixels |
| `re/tools/otdump.py` | Prints a frame's GPU packets from a RAM dump |
| `re/lua/movie.lua` | Trace version 2: `up`, `ot`, `fb`; `TP_VRAM_AT`; `TP_UPLOAD_LOG` (§4) |

## 2. Assets

**Source files.** `PAZLE.EXE` (SHA-1 `b5e48bc8…`) and `PAZLEE.BIN` (`6f744492…`), from the
data track `scripts/fetch-disc.sh` unpacks. The extractor refuses anything else.

**What is extracted.** Every item of `PAZLEE.BIN`, decoded (method byte, then stored or LZ;
`docs/re/disc-inventory.md` §3) through PAZLE.EXE's offset table at `0x800E1318`, and
validated as a TIM. The TypeScript decoder matches `re/tools/tpbin.py` byte for byte on all
1,235 items.

**The pack** (`pazlee.pack`): `'TPK1'`, a count, then per item an offset and length into the
item bytes; identical items are stored once (the 303 blank glyphs and other fillers). Items
stay TIMs: the renderer needs their VRAM positions, CLUTs and pixel words exactly as the game
uploads them.

**Not extracted yet:** ~~`EF.VB`/`EF.VH` and the CD audio~~ (done in Phase 8, `docs/re/audio.md` §7); the other programs' screens
(title, mode select, options), which belong to the shell (Phase 9).

## 3. How PAZLE.EXE draws a frame

Read from the decompilation (`0x8009882C` and libgs) and confirmed by the packets in RAM.

**Video setup.** `GsInitGraph(320, 240, 4, 0, 0)`: non-interlaced, libgs's GPU-offset mode,
dithering off. Two display buffers at (0, 0) and (0, 240); the drawing offset is the buffer's
origin plus (160, 120). The GTE is left as `InitGeom` sets it: H = 1000, offset 0.

**One frame, in the main loop's order:**

1. `GsClearOt` on ordering table `b` = `GsGetActiveBuff()` (0x800EE484). The table has 2^11
   buckets, linked from the last down to the first; ClearOTagR links bucket 0 to a 4-word dummy
   packet at `0x800E73F8`.
2. The logic. Some screens sort packets directly: the password screen's shading boxes
   (`FUN_800B4344`, see below). Image uploads happen here (`item_load`) or are queued.
3. `objects_draw` sorts every live sprite object (§3.1).
4. `upload_queue_flush` uploads the queued images.
5. `DrawSync`, `VSync`, `GsSwapDispBuff`: buffer `b` is displayed; the drawing environment moves
   to buffer `1 − b`. `GsSortClear(0, 0, 0)` puts a fill of that buffer at the table's head, and
   `GsDrawOt` draws the table **into buffer 1 − b**. So tick t draws into buffer `t & 1`
   (y = 240 × (t & 1)) and is displayed during tick t + 1.

### 3.1 `objects_draw`

Objects 1049 down to 0; one is live when its image field (`+0x24`) is positive.

- **Priority:** the object's `+0x40` if positive, else `20 − n / 50`. Packets go into that
  bucket; a bucket is drawn newest first, so for one priority the lowest object number is
  drawn first. Buckets are drawn from the highest number down.
- **Kind −1** (`+0x14`): an opaque box whose colour is three `rand()` calls (`& 7` each); x, y
  from the low halves of `+0x00`/`+0x04`, w, h from `+0x08`/`+0x0C`; bucket 0. The core keeps
  the colours (`Game.boxColors`), because the `rand()` calls are logic.
- **Kinds −2 and −3:** full-panel fades: a box of grey `(64 − level) × 255 / 64` (level at
  `+0x4C`), subtractive (−2, darkening) or additive (−3, lightening).
- **Any other kind:** a sprite from the image's template (§3.2). Kind k ≠ 0 makes it
  semi-transparent with blend mode `(k − 1) & 3`.
  - **Position:** x, y are 16.16 (`+0x00`, `+0x04`). Images below `0x10200` add a per-image
    offset (16.16, table `0x800D64AC`); then x gets +16, plus, for player 2's objects
    (`+0x1C` = 1), the per-layer offset from `0x800D74AC` indexed by `+0x20` (layer 2: 160 px).
    Screen x = x − 180, y = y − 120 + 4, relative to the drawing offset.
  - **Palette** (`+0x48`, the player): the texture page moves 256 rows down and the CLUT one
    row down, to player 2's copy of the image.
  - **Fast path:** no flip, scale or rotation: `GsSortFastSprite`, a draw-mode word and a
    textured rectangle (`0x64`).
  - **Otherwise** `GsSortSprite`: flip bits from `+0x44` (bit 0 x, bit 1 y), scale `0x1000 +
    +0x08/+0x0C`, rotation `+0x10`. It builds a flat-textured quad (`0x2C`) whose corners the
    GTE projects (§3.3).

### 3.2 Sprite templates

`sprite_templates_init` builds a `GsSPRITE` per image at startup (`FUN_80097830`): mode from
the TIM flags, width = VRAM words × (4, 2, 1) by mode, texture page from the TIM's position,
u = (x × texels per word) & (`0xFF`, `0x7F`, `0x3F`), v = y & 255, the CLUT position, colour
128 (unmodulated), centre (w/2, h/2), scale 1.0. **It also uploads every image once, at its
own VRAM position**, in index order: that is VRAM's starting content, so the last image of
each shared area is what's there until the game uploads another.

### 3.3 GsSortSprite and the GTE

The matrix is the identity, scaled by `ScaleMatrix(scalex, scaley, 0)` (column-wise, `>> 12`);
the translation is (x, y, H). The four corners (−w/2, −h/2) … (+w/2, +h/2) go through RTPS:
MAC = (TR × 4096 + R × V) >> 12, SZ = H, and SX = (H/SZ × IR1) >> 16 with the GTE's
Newton-Raphson division. For SZ = H = 1000 that division gives exactly `0x10000`, so the
corners are the scaled rectangle. Texture coordinates run from u to u + (w & 255) − 1 (the far
edge uses the low byte of w), swapped when flipped. Rotation is never used by Puzzle Mode and
isn't ported (the renderer throws).

### 3.4 Image uploads

`tim_upload` (`0x800975C8`) loads the image at its TIM position **plus 256 rows for the current
player** and its CLUT **one row lower** for player 2: the two players' copies of an image live
in VRAM's top and bottom halves (Phase 1's open question 5).

- `item_load(n)` (`0x8009740C`) uploads at once. Called from about 60 places: object loads,
  stage art, story pictures, the menu, the password screen, player 2's idle animation
  (`FUN_800A787C`: after every animation start and every frame change), and others.
- `FUN_8009747C(n)` queues an upload for the end of the frame. **The queue holds 4; a fifth
  call in one frame is dropped.** `upload_queue_flush` also leaves the current-player global
  (`0x800EEAD0`) at the last queued player's value. Used by the professor's image opcode
  (`prof_op_image`) and by `anim_start_load` / `anim_tick_load` (name entry).

The core records both (`Game.uploads`, encoded as the trace's `up`: item + 0x10000 × player,
+ 0x100000 if queued); the renderer replays them into its VRAM model before drawing.

### 3.5 GPU commands used

| Command | From | Notes |
|---|---|---|
| `02` fill | GsSortClear | Absolute coordinates, width rounded up to 16 |
| `E1` draw mode | every sprite and box | Texture page, blend mode, colour depth; the dither bit is set, but the reference renderer dithers only Gouraud-shaded primitives, which Puzzle Mode doesn't use |
| `64`/`66` textured rectangle | GsSortFastSprite | Colour 128: unmodulated |
| `2C`/`2E` flat-textured quad | GsSortSprite | Split into triangles (1, 3, 2) and (0, 1, 2) |
| `60`/`62` flat rectangle | GsSortBoxFill | Random boxes, fades, the password shading |

The GPU model implements exactly these, with PCSX-Redux's software renderer's rules: texel 0 is
transparent; texture colour × command colour / 128; semi-transparency only where the texel's
bit 15 is set, with the four blend modes (½B + ½F, B + F, B − F, B + ¼F) per 5-bit channel and
saturation; clipping to the drawing area; and for triangles Redux's edge walker (16.16 edges,
spans from ceil(left) to ceil(right) − 1, per-row edge recomputation, truncated per-row UV
steps, and the half-texel span seed).

### 3.6 Answers to earlier open questions

- **Phase 1, question 5 (stored VRAM coordinates):** images are uploaded at their TIM position
  for player 1 and 256 rows lower for player 2; CLUTs at their position or one row lower (§3.4).
- **Ledger open item (stage art `+0x20`/`+0x24`):** `+0x20` is the 112×160 well background
  (object 30, items 37–86); `+0x24` is a 112×56 strip (object 31). The 160×224 zone backdrop
  behind them comes from `FUN_800B0FAC` (items 284 on, two per zone: stages 1–19 and stage 20),
  not from the record.

## 4. The oracle, extended

Trace version 2 (`re/lua/movie.lua`) adds three fields, recorded for the whole corpus:

| Field | What it is |
|---|---|
| `up` | Upload calls this tick, in order: `item_load(n)` → n + 0x10000 × player; the queue → the same + 0x100000 (dropped fifth calls included, as the logic makes them) |
| `ot` | FNV-1a (32-bit words) over every word after the link word of every packet in ordering table `b`'s chain, the clear and the dummy packet included |
| `fb` | FNV-1a (16-bit words) over the 320×240 pixels of buffer `1 − b`, mask bit included |

At the sample point (after `pad_read`'s `PadRead`) the tick's table has been drawn: on the
ticks checked, the frame in buffer `1 − b` is identical to the screenshot taken while it is
displayed a tick later. Every movie of the corpus was recorded twice with the new fields and
both runs agreed (`scripts/record-corpus.sh`).

New harness options: `TP_VRAM_AT=TICKS` dumps VRAM (1024×1024 words; Redux's upper half is
unused) and RAM at those ticks; `TP_UPLOAD_LOG=1` logs each upload call's return address, which
mapped every call site in the corpus to its function.

**Reading the original's draw list:** `python3 re/tools/otdump.py ram_TICK.bin [--raw]` prints
the frame's packets, decoded. `npx tsx tools/render-dump.ts RAM VRAM [OUT.ppm]` (in `web/`)
draws the same frame on the port from the dumps (textures from the VRAM dump) and reports the
first differing packet and the differing pixels.

## 5. Results

| Movie | Ticks | `up` | `ot` | `fb` |
|---|---|---|---|---|
| `egypt1-idle` | 17,600 | identical | identical | identical |
| `egypt1-climb` | 5,108 | identical | identical | identical |
| `knossos2-lines` | 1,832 | identical | identical | identical |
| `input-edges` | 4,368 | identical | identical | identical |
| `pause-retire` | 5,390 | identical | identical | identical |
| `egypt20-zoneclear` | 4,000 | identical | identical | identical |
| `atlantis20-ending` | 8,451 | identical | identical | identical |
| `hundred-select` | 6,731 | identical | identical | identical |

`npm test` checks all of it (`web/test/render.test.ts`, about 95 s); `npm run trace -- --render`
prints the first difference with context. Rendering costs about 1.9 ms a frame in Node.

**How it got there.** The draw list and the frame were identical on the first six dumped frames
except for one packet: ClearOTagR's dummy packet at the end of the table. The rest was the
uploads: the corpus's upload log named 24 call sites, which the core now makes at the original's
points (menu, password, story pictures, stage art and backdrop, idle animation, professor
images, credits, name entry). Upload call sites the corpus doesn't reach are either memory-card
screens (not ported; Phase 9 replaces the card) or zone scenes whose pictures go through the
same `picture()` helper as the traced ones.

## 6. Presentation

- **Colour:** each 5-bit channel becomes 8 bits as `(c << 3) | (c >> 2)`.
- **Player 2 (approved deviation, `docs/RESEARCH_AND_PLAN.md` §9):** `Renderer.hidePlayer2`
  leaves out player 2's sprites (objects from 400 up whose player field is 1; player 1 also uses
  objects above 400, such as the menu's labels) but keeps the brick wall behind them (player
  2's idle-screen object 0x1E). A test replays `knossos2-lines` both ways: nothing changes left
  of x = 156, and the wall stays. Verification runs with it off.
- **Browser preview** (`npm run dev`, `web/index.html`): the core and renderer at 59.826 Hz with
  a fixed-step accumulator, keyboard on pad 1 (arrows, X Cross, Z Circle, A Square, S Triangle,
  Enter Start, Shift Select), pad 2 released, the canvas scaled 3× with sharp pixels. Checked
  in headless Chromium from the menu to a stage's rules panel. Scaling options, a CRT filter,
  the gamepad and settings are Phase 9's shell.
- **Frames as PNG:** `npx tsx tools/frames.ts ../re/movies/NAME.tpm OUT TICKS [--hide-p2]
  [--scale N]`.

## 7. Limits

- **The reference is an emulator.** Frames match PCSX-Redux's software renderer, whose rules
  its authors verified against hardware in many cases; a hardware capture would be the
  stronger check. Puzzle Mode only uses sprites, axis-aligned quads and boxes, where emulators
  and hardware rarely disagree.
- **Not covered by the corpus:** rotation in GsSortSprite (never used), the memory-card screens
  (not ported), and the screens' rarer branches (the Maya and Knossos scenes, two-player play).
  The Phase 10 solver runs will cover every stage's frames.
- **No interlacing or 24-bit modes:** Puzzle Mode uses neither (the Jaleco logo video, outside
  Puzzle Mode, is 24-bit).

## 8. Next phases

- **Phase 8 (audio):** play `Game.se` and `Game.music`; extract `EF.VB` and the CD tracks with
  the same pipeline.
- **Phase 9 (shell):** the presenter (integer scaling, 4:3, optional CRT), gamepad, settings,
  browser storage instead of the memory card (screen 13's save options, the menu's Continue),
  and the screens around Puzzle Mode (title, mode select, options).
