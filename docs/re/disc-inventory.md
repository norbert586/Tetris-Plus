# Phase 1: disc inventory (2026-10-17)

Every file on the disc now has a known format and role. The one exception is the stage data,
which is not in any data file: it must be inside `PAZLE.EXE` (see "Open questions").

- **Data files are image archives.** All 12 `*.BIN` files hold indexed, mostly LZ-compressed TIM
  images: 5,415 in total, and every one parses with exact block sizes. There are no
  sound, sequence or stage records in them.
- **Music is CD audio with two arrangements.** The same-length track pairs are a "console" set
  (tracks 2–33) and an "arcade" set (34–51), chosen by Option mode's *Music mode*. Track 52 is
  silence and means "stop".
- **One sound bank.** `EF.VH`/`EF.VB` hold all 50 sound effects and are loaded once at boot.
- **The main Puzzle Mode screens now have their music track** (9 tracks seen in the emulator),
  and the code's request table gives the rest.

All numbers below come from the disc image (verified against Redump) and from these runs:

- `PAZLE.EXE` and `SLUS_003.38` decompiled with the real PSX loader and PsyQ names.
- REA on `0x80095C5C`.
- Two traced emulator runs:
  - `attract`: no input, 12,000 frames.
  - `puzzle`: Phase 0's route into Egypt stage 1, then no input until frame 24,000. That covers
    gameplay, danger, continue, game over and the password screen.

## 1. Disc layout

The data track is LBA 0–22171. Tracks 02–52 are CD audio. LBAs are what the game passes to
`CdlSetloc`; `re/tools/iso_listing.py` prints them.

| File | LBA | Sectors | Bytes | Format | Role |
|---|---|---|---|---|---|
| `SYSTEM.CNF` | 23 | 1 | 69 | Text | `BOOT = cdrom:\SLUS_003.38;1`, TCB 4, EVENT 16, stack `0x801FFF00` |
| `SLUS_003.38` | 24 | 58 | 118,784 | PS-X EXE | Boot program; stays resident and loads everything else (§2) |
| `EF.VH` | 82 | 6 | 10,272 | VAB header | The game's only sound bank (§5) |
| `EF.VB` | 88 | 230 | 470,912 | VAB body | 50 SPU ADPCM samples |
| `JLOGO.EXE` | 318 | 83 | 169,984 | PS-X EXE | Jaleco logo player |
| `J_PS.STR` | 401 | 623 | 1,275,904 (Form 2) | STR (MDEC v3 + XA) | Jaleco logo video (§6) |
| `SW_ONE.BIN` | 1024 | 13 | 25,546 | Image archive | Copyright and memory-card screens |
| `SW_ON.EXE` | 1037 | 69 | 141,312 | PS-X EXE | Startup screens: copyright and memory-card check |
| `TDEMOE.BIN` | 1106 | 41 | 83,536 | Image archive | Story intro art and font |
| `TIT_DEMO.EXE` | 1147 | 69 | 141,312 | PS-X EXE | Story intro (professor and assistant) |
| `TITLEE.BIN` | 1216 | 193 | 394,789 | Image archive | Title logo animation, mode thumbnails |
| `TITLE.EXE` | 1409 | 66 | 135,168 | PS-X EXE | Title screen |
| `HOWE.BIN` | 1475 | 30 | 61,362 | Image archive | Classic how-to-play (out of scope) |
| `HOW_N.EXE` | 1505 | 111 | 227,328 | PS-X EXE | Classic how-to-play; also an attract demo |
| `HOWPE.BIN` | 1616 | 99 | 201,395 | Image archive | Puzzle how-to-play art |
| `HOW_P.EXE` | 1715 | 128 | 262,144 | PS-X EXE | Puzzle how-to-play; also an attract demo |
| `HOWV.BIN` | 1843 | 130 | 264,458 | Image archive | VS how-to-play (out of scope) |
| `HOW_VS.EXE` | 1973 | 119 | 243,712 | PS-X EXE | VS how-to-play (out of scope) |
| `RANKINGE.BIN` | 2092 | 32 | 63,578 | Image archive | Ranking screen art and font |
| `RANKING.EXE` | 2124 | 62 | 126,976 | PS-X EXE | Rankings (Classic and Puzzle tables) |
| `SELECTE.BIN` | 2186 | 67 | 136,666 | Image archive | Mode select and Option mode |
| `SELECT.EXE` | 2253 | 76 | 155,648 | PS-X EXE | "Select Mode" menu and Option mode |
| `NOMAL.BIN` | 2329 | 284 | 579,969 | Image archive | Classic mode (out of scope) |
| `NOMAL.EXE` | 2613 | 99 | 202,752 | PS-X EXE | Classic mode (out of scope) |
| **`PAZLEE.BIN`** | 2712 | 464 | 950,200 | Image archive | **All Puzzle Mode art** (§4) |
| **`PAZLE.EXE`** | 3176 | 180 | 368,640 | PS-X EXE | **Puzzle Mode**: menu, map, story scenes, stages, continue, game over, password, save |
| `VSPUZ.BIN` | 3356 | 131 | 267,850 | Image archive | VS mode (out of scope) |
| `VSPUZ.EXE` | 3487 | 109 | 223,232 | PS-X EXE | VS mode (out of scope) |
| `EDITE.BIN` | 3596 | 200 | 408,716 | Image archive | Edit mode (out of scope) |
| `EDIT.EXE` | 3796 | 138 | 282,624 | PS-X EXE | Edit mode (out of scope) |
| `DM3M30S.DA` | 3934 | 18,088 | 37,044,000 | All zero bytes | Filler: a Form 1 data file, not a pointer to an audio track, so nothing to port |

The name `DM3M30S.DA` ("dummy, 3 min 30 s") fits its size: exactly 3:30 of CD-DA bytes. The
silent 3:30 track 52 is the same length.

## 2. Programs and how they are loaded

| Program | Load address | Text size | End | Entry (pc0) |
|---|---|---|---|---|
| `SLUS_003.38` | `0x80022000` | `0x1C800` | `0x8003E800` | `0x800259F8` |
| `JLOGO.EXE` | `0x80094000` | `0x29000` | `0x800BD000` | `0x8009566C` |
| `SW_ON.EXE` | `0x80094000` | `0x22000` | `0x800B6000` | `0x8009A63C` |
| `TIT_DEMO.EXE` | `0x80094000` | `0x22000` | `0x800B6000` | `0x800981BC` |
| `TITLE.EXE` | `0x80094000` | `0x20800` | `0x800B4800` | `0x800994B4` |
| `SELECT.EXE` | `0x80094000` | `0x25800` | `0x800B9800` | `0x8009D548` |
| `PAZLE.EXE` | `0x80094000` | `0x59800` | `0x800ED800` | `0x800C0994` |
| `HOW_P.EXE` | `0x80094000` | `0x3F800` | `0x800D3800` | `0x800A57DC` |
| `RANKING.EXE` | `0x80094000` | `0x1E800` | `0x800B2800` | `0x80097900` |
| `HOW_N.EXE` | `0x80094000` | `0x37000` | `0x800CB000` | `0x800A2224` |
| `HOW_VS.EXE` | `0x80094000` | `0x3B000` | `0x800CF000` | `0x800A5B4C` |
| `NOMAL.EXE` | `0x80094000` | `0x31000` | `0x800C5000` | `0x800A51A4` |
| `VSPUZ.EXE` | `0x80094000` | `0x36000` | `0x800CA000` | `0x800A593C` |
| `EDIT.EXE` | `0x80094000` | `0x44800` | `0x800D8800` | `0x800B47E0` |

None has a BSS or small-data (`gp`) section in its header. The stack is at `0x801FFFF0`.

**Boot program (`SLUS_003.38`), `main` at `0x80022E60`:**

1. Initialises the libraries, then sets 320×240 with `GsInitGraph(320, 240, 4, 0, 0)`.
2. Clears `0x8003E668`–`0x80089BB8` (`0x4B550` bytes). This is the **shared state block**
   handed to every mode program as `state`; `PAZLE.EXE` keeps the pointer at `0x800ED328`.
   Known offsets so far:

   | Offset | Contents |
   |---|---|
   | `+0x20550` | CD table of contents (`CdlLOC` per track; see §7) |
   | `+0x206E0` | Highest track number |
   | `+0x4B4FC` bit 0 | Mono sound |
   | `+0x4B4FD` | Music mode (0 console, non-zero arcade) |
   | `+0x4B4FF` | BGM volume setting |
   | `+0x4B500` | SE volume setting |

3. Loads the sound bank: `EF.VH` → `0x80010000`, `EF.VB` → `0x80150000`, then
   `SsVabOpenHead` / `SsVabTransBody` (`FUN_800252C8`).
4. Reads the TOC into `0x8005EBB8` (`state + 0x20550`).
5. Runs `CdSearchFile` once for all 13 mode programs (table `0x80039A74`) and all 13 data files
   (table `0x80039C14`, 32-byte entries `name, load address, CdlFILE`).
6. Runs a state machine (`FUN_80024950` → `FUN_80024214`) that reads the next program's data
   file, then its EXE.

**Every data file loads at `0x800F4000`.** That's the second word of each `0x80039C14` entry.
The largest, `PAZLEE.BIN`, ends at `0x801DDFB8`.

**Between programs the boot code starts over.** `CdInit` prints `CD_init:addr=8003cafc` before
each program change. The order is the same every time: data file first, then EXE, about
1.5–4 s apart. These are emulator frame times, and the port won't reproduce load times.

| Frame (puzzle run) | Read by boot program | Program starts |
|---|---|---|
| 532 | `JLOGO.EXE` | 543 |
| 961 / 1014 | `SW_ONE.BIN`, `SW_ON.EXE` | 1025 |
| 1976 / 2040 | `TDEMOE.BIN`, `TIT_DEMO.EXE` | 2051 |
| 2368 / 2493 | `TITLEE.BIN`, `TITLE.EXE` | 2504 |
| 2908 / 2983 | `SELECTE.BIN`, `SELECT.EXE` | 2994 |
| 3915 / 4149 | `PAZLEE.BIN`, `PAZLE.EXE` | 4160 |

The attract loop with no input runs `JLOGO` → `SW_ON` → `TIT_DEMO` → `TITLE` → `HOW_N`
(frame 7172) → `HOW_P` (frame 9944).

## 3. Data file format (`*.BIN`)

**Codec.** Each item is:

```
u8  method      0 = stored, 1 = LZ
u16 out_length  little endian
... payload
```

- **Method 0 (stored):** `out_length` raw bytes.
- **Method 1 (LZ):** groups of one u16 flag word, read from bit 0 upward, plus up to 16 tokens.
  - A flag word of 0 means 16 literal bytes.
  - Otherwise each 0 bit is one literal byte, and each 1 bit is a two-byte match `b0, b1`:
    - distance `((b1 << 8 | b0) & 0x7FF) + 1`
    - length `(b1 >> 3) + 3`, so 3–34 bytes
    - copied byte by byte, so overlapping matches repeat bytes
  - Groups repeat until `out_length` bytes have been written.
- **Where the codec lives:** the boot program has it at `0x80023204`. Each mode program carries
  its own copy, for example `PAZLE.EXE` at `0x80097AF4`.

**Indexing.** The last LZ group always runs all 16 tokens, so the decoder reads past the end of
an item. As a result, an item's size can't be recovered from its data. Instead, each mode
program has a table of u32 item offsets into its data file, and decodes item *n* from
`0x800F4000 + table[n]`. For example, `PAZLE.EXE` decodes items with `FUN_8009740C` (by index)
into `state + 0x2AC74`.

**Contents.** Every item is a TIM:

- a 4-byte ID, then flags, a CLUT block and an image block
- 4-bit or 8-bit with one CLUT row; no 16- or 24-bit images on this disc
- each carries its own VRAM coordinates: CLUTs in rows 9–511; images at x 320–1022, so to the
  right of the 320-pixel-wide display buffers

`PAZLEE.BIN` decodes to 3.4 MB, more than VRAM's 1 MB, so screens must reload images into
shared VRAM areas. Phase 7 will confirm the exact use of the stored coordinates.

| Data file | Program | Offset table | Items | Distinct | 4-bit / 8-bit TIMs | LZ items | Decoded bytes |
|---|---|---|---|---|---|---|---|
| `SW_ONE.BIN` | `SW_ON.EXE` | `0x800AF4E0` | 24 | 24 | 24 / 0 | 24 | 215,296 |
| `TDEMOE.BIN` | `TIT_DEMO.EXE` | `0x800AF110` | 409 | 99 | 379 / 30 | 409 | 213,408 |
| `TITLEE.BIN` | `TITLE.EXE` | `0x800ADC9C` | 143 | 143 | 60 / 83 | 143 | 2,795,686 |
| `SELECTE.BIN` | `SELECT.EXE` | `0x800B23EC` | 177 | 177 | 167 / 10 | 176 | 418,864 |
| **`PAZLEE.BIN`** | **`PAZLE.EXE`** | **`0x800E1318`** | **1,235** | **878** | **871 / 364** | **1,215** | **3,404,148** |
| `HOWPE.BIN` | `HOW_P.EXE` | `0x800C3D2C` | 933 | 291 | 744 / 189 | 924 | 1,013,998 |
| `RANKINGE.BIN` | `RANKING.EXE` | `0x800AC0C4` | 102 | 102 | 97 / 5 | 102 | 94,176 |
| `HOWE.BIN` | `HOW_N.EXE` | `0x800C3CFC` | 644 | 122 | 632 / 12 | 637 | 187,814 |
| `HOWV.BIN` | `HOW_VS.EXE` | `0x800C8198` | 405 | 396 | 176 / 229 | 397 | 1,149,770 |
| `NOMAL.BIN` | `NOMAL.EXE` | `0x800BDA90` | 382 | 369 | 285 / 97 | 367 | 1,219,256 |
| `VSPUZ.BIN` | `VSPUZ.EXE` | `0x800C3294` | 411 | 408 | 182 / 229 | 403 | 1,155,388 |
| `EDITE.BIN` | `EDIT.EXE` | `0x800D0E70` | 550 | 540 | 338 / 212 | 538 | 1,634,240 |

Repeated items are placeholders that keep indices fixed. In `PAZLEE.BIN`, a blank 8×8 glyph
(item 535) fills 303 slots, and `HOWPE.BIN`'s most common filler appears 641 times. The `E`
suffix fits these being the English images with gaps where Japanese ones were.

Leftovers from the Japanese version: `SW_ONE.BIN` item 5 is a Japanese memory-card prompt.
The `SW_ON` copyright screen credits "Tetris Plus © 1996 The Tetris Company".

## 4. Puzzle Mode art (`PAZLEE.BIN`)

Identified from contact sheets (`re/tools/tim2png.py sheet`). These are ranges by eye. The
exact role of each index comes from the code that references it, in Phases 4 and 7.

| Items | Contents |
|---|---|
| 0–36 | HUD bits: "PUZZLE MODE" logo, mini blocks, the 7 piece previews (21–27), zone name plates (28–31), "PRESS START", "TRIPLE"/"TETRIS! special recovery" (35–36), and the spiked ceiling (12) |
| 37–86 | 50 full playfield backgrounds (~112×160), in each zone's style: Egypt, Angkor, Maya, Knossos, Atlantis |
| 87–98 | Small digits; four ceiling variants (91–94); ceiling counter pieces |
| 99–273 | **Professor animation frames** (walk, climb, fall, sleep, surprise, crushed, "V" sign, dig) and effects (sparkles, dust, debris) |
| 274–283 | Digits 0–9 |
| 284–298 | Zone photos behind the story scenes: 5 zones × 3 colour grades (day, dusk, night tints) |
| 299–301 | Brick tile, world map, "WORLD MAP" |
| 302–432 | Results and HUD text: "TIME BONUS", "NEW RECORD", "NO BONUS", "SCORE", "STAGE CLEAR" letters, big digits, "CONTINUE?"/"GAME OVER" (391–395), "STAGE", "GOAL" (410), rank labels, professor result pictures (414–417), "BEST TIME"/"TIME" (422–423), "FINAL" |
| 433–490 | "TREASURE"/"NOTHING" (434–435); treasure items (gems, relics; 436–473); point values (474–488) |
| 491–501 | How-to-play panels: "Erase blocks and drop the professor to the bottom!" and the rules about climbing and the ceiling |
| 502–534 | Story-scene illustrations: professor and assistant, one set per zone, plus the ending scenes |
| 535–933 | Font glyph slots: dialogue font, 24 speaker portraits (792–815), and about 300 blank placeholders |
| 934–1004 | "NEXT" frame, the gate, menu labels: "NEW GAME"/"CONTINUE"/"PASSWORD", "DATA 1–3", "PLAY THIS STAGE?", "INCORRECT PASSWORD", password entry |
| 1005–1031 | "THE END" letters, assistant sprites (1010–1029), ending art |
| 1032–1103 | Score panels, digits, memory-card messages, "SELECT" cursors |
| 1104–1234 | Menu fonts, zone-name labels, "SLOT 1/2", "RETIRE", "EXIT", "SAVE DATA?", "PLEASE WAIT" |

## 5. Sound effects (`EF.VH` / `EF.VB`)

- VAB version 7, id 0. 15 programs, 150 tones and **50 VAG samples**; the VAG sizes add up to
  `EF.VB` exactly.
- Every tone is a single key (36–51) with root key = key + 12 and no fine tune, so each key plays
  one effect at its recorded pitch.
- ADSR is `80FF/DFFF` or `80FF/5FDF`; tone mode 4.
- The 15 programs are 5 sets × 3 pans:
  - programs 0–4: centre (pan 64)
  - programs 5–9: left (pan 16)
  - programs 10–14: right (pan 112)
- `PAZLE.EXE`'s SFX call (`FUN_80095778`) adds 5 or 10 to the program in two-player play, so each
  player's effects come from their side of the stereo field.
- Loaded once at boot; `PAZLE.EXE` re-opens the header and calls `SsVabFakeBody(0)`, so the
  samples stay in SPU RAM.
- Settings `PAZLE.EXE` applies (`FUN_800961C4`):
  - reverb type 1 (`SsUtSetReverbType(1)`), depth 8/8, reverb volume `0x20`
  - master volume `0x7F`
  - SE volume table at `0x800DC46C`: `0, 80, 88, 96, 104, 112, 120, 127`, indexed by the setting
    at `state + 0x4B500`

## 6. Video (`J_PS.STR`)

- 623 Form 2 sectors: 563 video, 38 XA audio, the rest padding.
- 120 MDEC frames at 320×240, bitstream version 3, 5 sectors per frame. That's about 4 s at
  double speed.
- Audio is XA ADPCM: stereo, 37.8 kHz, 4-bit.
- It's the Jaleco logo at power-on, the only video on the disc. `JLOGO.EXE` switches the display
  to 24-bit for it.
- The port will need a one-off conversion (for example ffmpeg's `psxstr` demuxer); the decoders
  don't need to handle it.

## 7. Music (CD audio)

### 7.1 How the game plays music

From `PAZLE.EXE`; `SELECT` and `TITLE` link the same routines.

1. **The request function `FUN_80095DA8(id)`** maps a music id to a track. Ids `0x22`–`0x33`
   (34–51) are "logical" tunes:
   - **Arcade** music mode (`state + 0x4B4FD` set): the id is the track number, so tracks 34–51
     play.
   - **Console** mode: a switch maps each id to a track in 2–33 (table below).
   - Ids below `0x22` are track numbers (tracks 2, 16, 17, 23 have no arcade version).
   - Id `0x34` (52, the silent track) means **stop**: the CD keeps going at volume 0.
2. **Two players.** When both players want music, the one with the larger priority (third
   column of the track table) wins. Ids `0x23`/`0x24` add a per-player bias.
3. **Playing a track (`FUN_80095A0C`):**
   - Set mode `0x05` (CD-DA, report).
   - Seek to `TOC[track]`, then Play. The end is `TOC[track] + end_offset`.
4. **Per-track table at `0x800DC610`** (12 bytes per track 2–52: `end_offset`, `mode`,
   `priority`):
   - `end_offset` is the track length minus 150 sectors (2 s) in every case.
   - `mode` 1 loops; `mode` 0 plays once.
5. **The report callback `FUN_80095C5C`** (decompiled with REA):
   - Takes each absolute position report.
   - Once the position passes the end: mode 1 seeks back to the start and plays again; mode 0
     sets the CD volume to 0 (`SsSetSerialVol(0, 0, 0)`).
6. **Quirks a faithful port has to copy:**
   - **Track starts are rounded down to the second.** The drive's GetTD reports only minutes
     and seconds (the boot code prints `CdGetToc2: %02x:%02x:00`). Every play therefore starts
     0–1 s before the track's real start, in the pregap's silence. Observed: tracks 2, 3 and 4
     start 0.63 s early; 14 and 15 0.05 s; 25, 26 and 27 0.56 s; 28 0.16 s.
   - **Loop and end checks run on whole seconds too.** Position reports are read with the
     frame byte zeroed. Track 4 looped every 3,964 frames (66.3 s) against an `end_offset` of
     65 s.
   - **"Play once" doesn't stop the disc.** It mutes it, and the track's tail keeps playing
     silently.
7. **Mix (`FUN_800961C4`):**
   - Stereo: `CdMix` L→L `0x7F`, R→R `0x7F`.
   - Mono (`state + 0x4B4FC` bit 0): all four `0x40`.
   - BGM volume table at `0x800DC45C`: `0, 16, 32, 48, 64, 80, 96, 112` for the setting at
     `state + 0x4B4FF`; the result goes to `SsSetSerialVol`.

### 7.2 Gameplay music logic

- **Stage tune.** `FUN_8009F50C` requests `0x23 + stageInZone / 10`:
  - `0x23` for stages 1–10 of a zone, `0x24` for 11–20 (by the formula; only stage 1 was seen).
  - Console tracks per zone index, from tables `0x800DC880` and `0x800DC88A`:

    | Zone index | `0x23` (stages 1–10) | `0x24` (stages 11–20) |
    |---|---|---|
    | 0 | track 4 | track 5 |
    | 1 | track 10 | track 11 |
    | 2 | track 6 | track 7 |
    | 3 | track 8 | track 9 |
    | 4 | track 12 | track 13 |

    Zone index 0 is Egypt (seen). The others' zone names aren't confirmed yet.
- **Danger music.** When a counter (to be identified in Phase 3) drops below 5, the request
  switches to `0x25` (track 14). It switches back when the counter recovers.
- **Request `0x2C` (track 24)** fires from `FUN_800A156C` when a per-player count reaches 15.
- **Zone 4 special case.** For ids `0x32`/`0x33`, zone index 4 gets tracks 32/33 instead of
  30/31.

### 7.3 Track table

"Pair" is the other arrangement of the same id. Screens marked *seen* come from the traced runs;
the rest are only known from the request table.

| Track | Length | Loop | Id | Pair | Seen on |
|---|---|---|---|---|---|
| 02 | 0:30.00 | once | direct | — | Story intro (`TIT_DEMO`), *seen* |
| 03 | 0:30.00 | once | `0x22` or direct | 34? | Title screen (`TITLE`), *seen*. Whether arcade mode plays 34 here depends on which id `TITLE` sends; not traced yet |
| 04 | 1:07.00 | loop | `0x23` zone 0 | 35 | Egypt stages 1–10, *seen* |
| 05 | 1:04.00 | loop | `0x24` zone 0 | 36 | |
| 06 | 1:24.45 | loop | `0x23` zone 2 | 35 | |
| 07 | 1:16.23 | loop | `0x24` zone 2 | 36 | |
| 08 | 1:11.38 | loop | `0x23` zone 3 | 35 | |
| 09 | 1:19.45 | loop | `0x24` zone 3 | 36 | |
| 10 | 1:28.08 | loop | `0x23` zone 1 | 35 | |
| 11 | 1:09.60 | loop | `0x24` zone 1 | 36 | |
| 12 | 2:25.38 | loop | `0x23` zone 4 | 35 | |
| 13 | 2:07.00 | loop | `0x24` zone 4 | 36 | |
| 14 | 0:44.00 | loop | `0x25` | 37 | Danger: ceiling close to the professor, *seen* |
| 15 | 0:45.23 | loop | `0x26` | 38 | Zone story scene (Egypt intro), *seen* |
| 16 | 0:58.00 | loop | direct | — | |
| 17 | 0:54.00 | loop | direct | — | |
| 18 | 2:00.00 | loop | `0x27` | 39 | |
| 19 | 1:06.00 | loop | `0x28` | 40 | |
| 20 | 1:03.15 | loop | `0x29` | 41 | |
| 21 | 1:00.15 | loop | `0x2A` | 42 | |
| 22 | 1:53.00 | loop | `0x2B` | 43 | |
| 23 | 2:26.60 | loop | direct | — | |
| 24 | 0:07.00 | once | `0x2C` | 44 | Jingle; requested at a count of 15 in `FUN_800A156C` |
| 25 | 0:05.00 | once | `0x2D` | 45 | "GAME OVER" jingle, *seen* |
| 26 | 0:26.00 | once | `0x2E` | 46 | "CONTINUE?" countdown, *seen* |
| 27 | 0:43.45 | loop | `0x2F` | 47 | Select Mode, Puzzle menu, world map, password/save screen, *seen* |
| 28 | 1:47.00 | loop | `0x30` | 48 | Puzzle how-to-play demo (`HOW_P`), *seen* |
| 29 | 1:00.00 | loop | `0x31` | 49 | |
| 30 | 0:35.00 | loop | `0x32` | 50 | |
| 31 | 1:02.00 | loop | `0x33` | 51 | |
| 32 | 0:52.00 | loop | `0x32` zone 4 | 50 | |
| 33 | 1:42.00 | loop | `0x33` zone 4 | 51 | |
| 34–51 | | | `0x22`–`0x33` | | Arcade arrangements: one per id, so arcade mode has one stage pair (35, 36) for all zones |
| 52 | 3:30.00 | — | `0x34` | — | Digital silence; the "stop" id |

- **Lengths:** from the BIN files, pregap excluded; `re/tools/cdda_tracks.py` prints them with
  peak and RMS levels.
- **Same-length pairs:** 14/37, 19/40, 25/45, 26/46 and 28/48 are equal-length arrangements of
  one id. The pairs 2/3/34 and 29/42 are equal-length by coincidence.

## 8. The Puzzle Mode working set

What the port needs from the disc:

| Need | Source |
|---|---|
| Rules, timings, stage data, text, tables | `PAZLE.EXE` (Phase 2–4) |
| Puzzle Mode art | `PAZLEE.BIN` (all 1,235 items) |
| Sound effects | `EF.VH`/`EF.VB` |
| Puzzle music | Console tracks 4–33 and their arcade versions 35–51 |
| Screens around it | `SELECT.EXE` + `SELECTE.BIN` (mode select, options: music mode, sound, volume); `TITLE.EXE` + `TITLEE.BIN` with track 3; `SW_ON.EXE` + `SW_ONE.BIN` (copyright); `TIT_DEMO.EXE` + `TDEMOE.BIN` with track 2 (story intro) |
| Optional | `JLOGO.EXE` + `J_PS.STR` (logo video); `HOW_P.EXE` + `HOWPE.BIN` with track 28 (Puzzle how-to-play); `RANKING.EXE` + `RANKINGE.BIN` (Puzzle best times) |
| Not needed | `NOMAL`, `VSPUZ`, `EDIT`, `HOW_N`, `HOW_VS` and their data files; `DM3M30S.DA`; track 52 (the port can just stop) |

## 9. Open questions (carried into Phases 2–4)

1. **Where the stage data lives.** It's not in any data file, so the 100 stage layouts must be
   in `PAZLE.EXE`'s initialised data (`0x800D4FB0`–`0x800ED800`, about 100 KB, minus the item
   table at `0x800E1318`–`0x800E2664`). Phase 4 finds them by known-plaintext search against a
   gameplay RAM dump.
2. **Which zone each index 1–4 is.** The zone names appear in different orders across images:
   map labels Egypt/Maya/Knossos/Angkor Wat; zone photos and menus
   Egypt/Angkor/Maya/Knossos/Atlantis. The zone variable needs mapping.
3. **Unseen music.** Tracks 5–13, 16–23 and 29–33 need a screen. They're probably stage clear,
   zone clear, map moves, endings and Atlantis. A Phase 5 movie corpus that reaches them
   settles this; until then the request table is the source of truth.
4. **What triggers danger music and track 24** (the counter compared with 5 and 15). This is
   Phase 3 RAM-map work.
5. **How the stored VRAM coordinates are used.** The TIM headers' positions versus where each
   screen uploads them; Phase 7.
6. **`HOW_N.EXE`'s music.** Not traced: the program is out of scope and missing from the hook
   table.

## 10. Tools added in this phase

| Tool | What it does |
|---|---|
| `re/tools/iso_listing.py` | Lists data-track files with LBA, size and XA attributes |
| `re/tools/cdda_tracks.py` | Per-track length, levels, and which tracks share length or audio |
| `re/tools/tpbin.py` | Data file codec: finds the program's offset table, lists or extracts items |
| `re/tools/tim2png.py` | Validates TIMs and renders them, as contact sheets or one PNG per item |
| `re/tools/vab_info.py` | Summarises a VAB header and checks it against the body |
| `re/ghidra/ExportDecompiled.java` | Headless Ghidra: all functions' C plus callers in one greppable file |
| `re/tools/cd_hooks.py` → `re/lua/cd_hooks.txt` | Per-program `CdControl*` addresses for tracing |
| `re/lua/smoke.lua` (extended) | `TP_CD_HOOKS` logs every CD command; `TP_TAP` takes several periodic taps |
| `re/tools/cd_trace.py` | Turns a traced run into file reads and track plays |

`scripts/run-emulator.sh` now passes `-debugger`. Without it, Redux silently ignores Lua
breakpoints.

**Lua gotcha:** a breakpoint handle must stay reachable from a global, or the garbage collector
removes the breakpoint mid-run. The boot hooks vanished this way until they were stored in
`TpBootCdBreakpoints`.
