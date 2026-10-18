# Phase 8: audio (2026-10-18)

Puzzle Mode now sounds as it should in the browser: its 50 sound effects through a port of the
SPU, its 50 music tracks from the CD, and the program's own sound driver deciding what plays
when. The exit criterion is met: **every sound and CD event of the trace corpus matches the
original's** (§9):

- per tick, exactly: every key-on with the voice libsnd chose and the six registers it wrote
  (volume left and right, pitch, sample address, ADSR), every key-off, the SPU's mix registers
  (main, reverb and CD volume, control, reverb on, reverb work area) and its 32 reverb registers;
- the CD's commands (Setmode, Setloc, Play) and every position report the program's CD
  callback receives, with its contents; these may each land a tick early or late (§6), and none
  does by more.

The reference is PCSX-Redux at our pinned build, as for every phase. What isn't compared
sample for sample is the sound itself: the oracle doesn't expose its SPU's output or RAM to the
harness, so the mixer is a port of the oracle's (with one correction, §8) checked against the
envelope model the event traces verify, and its ADPCM decoding against FFmpeg's.

What else this phase delivers:

- **Trace version 3** (§2): the harness records the SPU register writes and the CD traffic.
  The whole corpus was re-recorded; every old field is unchanged.
- **Audio assets** (§7): the sound bank (`EF.VH`, `EF.VB`), the disc's layout (`disc.json`) and
  the music tracks as Ogg Opus, committed under `web/public/assets/`.
- **Sound in the preview**: `npm run dev` plays effects and music; sound starts with the first
  key press.
- **`web/tools/render-audio.ts`** renders a movie's sound to a WAV file.

## 1. How Puzzle Mode makes sound

Two paths, both driven from the program's logic (`web/src/core/sound.ts`):

**Sound effects: `se_play(id)` (`0x80095778`).** The effect's volume comes from the effect
volume setting (`state+0x4B500`, 0–7) through the table at `0x800DC46C`
(0, 80, 88, 96, 104, 112, 120, 127); 0 means silence and nothing is called. Otherwise it calls
`SsVoKeyOn(program, note << 8, vol, vol)` with the program and note from the table at
`0x800DC47C` (8 bytes per effect: program, note × 256). In a two-player game in stereo, player
1's effects use program + 5 and player 2's program + 10, which are the same sounds panned left
and right. The core now records each call as a `SoundCall` (`key`: program, note, volume).

**Music: `bgm_request(id)` (`0x80095DA8`)** picks the CD track (Phase 6), then
`bgm_play_track(track, mode)` (`0x80095A0C`) sends the drive Setmode 5 (CD-DA, reports on),
Setloc to the track's TOC entry and Play, and `SsSetSerialVol` sets the CD volume from the music
volume setting (`0x800DC45C`: 0, 16, …, 112). Track 52 (`0x34`) means "stop": only the volume
changes, to 0. The track table at `0x800DC610` (12 bytes per track from track 2) gives each
track an end offset in sectors and a mode: 1 loops, 0 plays once. The core records `play`
(track, mode) and `cdvol` calls.

**The CD callback (`0x80095C5C`)** runs on every drive report. An absolute report (second byte's
bit 7 clear) sets the current position to its minute and second; then, if the position is past
the track's end, a looping track is started again (Setloc, Play) and a non-looping one is
silenced with `SsSetSerialVol(0, 0, 0)`; the disc keeps playing into the next track, unheard.

**Set-up** (Puzzle Mode's start, `FUN_800961C4`): `SsSetTickMode(1)` (libsnd's work runs in the
vblank interrupt), the sound bank to SPU RAM, CD input on at the music volume, reverb type 1
(`SsUtSetReverbType`) at depth 8, main volume 127, and mono or stereo from the sound setting
(`state+0x4B4FC` bit 0): `SsSetMono` makes libsnd play both sides at the louder side's level and
`CdMix` sends both CD channels to both sides at half level.

## 2. Trace version 3

`re/lua/movie.lua` now watches the SPU's registers: a write breakpoint on the whole register
block (`0x1F801C00`–`0x1F801FFF`) decodes each store from the instruction at the program
counter (sb/sh/sw; the BIOS's from ROM) and keeps a copy of every register, carried in save-state
side files. New fields (`docs/re/oracle-harness.md` §3):

| Field | What it holds |
|---|---|
| `vs` | Vblanks since the previous sample: 1 while playing, more when a tick loads a screen. libsnd works per vblank, not per tick |
| `kon` | Each key-on: voice, then its volume left and right, pitch, start address, ADSR1, ADSR2 and repeat address at that moment |
| `koff` | Each non-zero key-off write: voices 0–15 as is, 16–23 × 65536 |
| `spu` | Main volume L/R, reverb volume L/R, CD volume L/R, external volume L/R, SPUCNT, reverb-on mask, pitch modulation, noise, reverb work area, when they change |
| `rev` | The 32 reverb registers (`0x1DC0`–`0x1DFE`), when they change |
| `cd` | Each `CdControl`/`CdControlF`/`CdControlB` call: command, then Setloc's 3 bytes or Setmode's 1 (Play is sent without its parameter) |
| `cdr` | Each call of the CD callback: interrupt type, then the result bytes: status, track, index, minute, second (+0x80: relative), sector |

`TP_AUDIO_LOG=1` also writes `audio.log` with the CPU cycle of every vblank, sample, key-on, CD
command and report, which is how the timing in §5 and §6 was measured. All 8 corpus traces were
re-recorded twice each and are deterministic.

## 3. libsnd's voice manager (`web/src/audio/libsnd.ts`)

PAZLE.EXE links PsyQ's libsnd; Puzzle Mode uses only `SsVoKeyOn`. The port follows the
disassembly:

- **`SsVoKeyOn` → `SpuVmSeKeyOn`** passes pan 64, drops the fine pitch, and plays every tone of
  the program whose key range holds the note.
- **`SpuVmAlloc` (`0x800C9BE8`)**: the first voice that is free and silent (key status 0, last
  ENVX 0); else, among voices of the lowest priority below the tone's, the quietest (lowest last
  ENVX), then the oldest. Every voice ages by one; the chosen one gets age 0 and the tone's
  priority.
- **`SpuVmDoAllocate`**: start address (`0x1010` + the sizes of the samples before it, in
  8-byte units), ADSR, and the voice counts as sounding (last ENVX `0x7FFF`).
- **`SpuVmKeyOnNow`**: volume `q = trunc(vol × mvol × 0x3FFF / 0x3F01)`, then
  `trunc(q × progVol × toneVol / 0x3F01)`, panned by the tone's, the program's and the call's
  pan (below 64 scales the right side by pan/63, otherwise the left by (127 − pan)/63), mono
  takes the louder side, and the register is `x² / 0x3FFF`. Pitch from `note2pitch2`: the
  12 × 16 table at `0x800EC94C`, shifted by octaves from the tone's centre note. Effect 0 at
  volume 127 writes 11847, as the original does.
- **`SpuVmFlush`**, once per vblank from the interrupt: reads ENVX for the 24 voices into a
  16-entry history (index at `0x800EDBA8`); a voice whose ENVX was 0 in all of entries 0–14 is
  freed; then the changed voice registers, KOFF, KON and the reverb-on mask. Because entry 15
  never counts, a freshly silent voice is freed after 15 or 16 flushes depending on the index's
  phase, so the port starts the index where the original has it (2 when tick 1 starts; 14 at
  tick 2's sample, read from RAM dumps). With the wrong phase, `input-edges` keyed tick 4063's
  two effects on voices 0 and 1 instead of 1 and 2.

Allocation is the part that depends on time: whether a voice is free depends on the ENVX the
flush read, so the port needs the SPU's envelopes as the CPU sees them (§4).

## 4. Envelopes as the CPU reads them (`web/src/audio/envelope.ts`)

The oracle answers an ENVX read by stepping a copy of the voice's ADSR envelope from its key-on
to the reader's CPU cycle, one step per sample (768 cycles), after a key-on delay of 6 samples;
the voice ends (ENVX 0) when its pitch counter, starting at `0x30000` and advancing by
pitch × 16 a sample, passes the end of a sample's last block (flag 1 without repeat). The port
does the same (`Envelopes`), with the ADSR rate tables of `adsr.cc`. All 50 samples have the
same block layout: a silent first block, flag 4 (loop start) on the second, flag 1 on the
second-to-last (the end) and flag 7 on the last, which never plays.

## 5. The clock (`web/src/audio/model.ts`, `driver.ts`)

The model counts CPU cycles from the first tick: 564,400 a vblank (NTSC on the oracle,
33.8688 MHz / ~60.01 Hz; measured between vblank events). Tick *t* ends with its trace sample,
45,519 cycles into its last vblank, and its logic runs before that. Measured from `audio.log`:

- the flush reads ENVX at about 16,000 cycles into a vblank and writes KON at about 18,000
  (17,973–18,233);
- so an effect started by tick *t*'s logic is keyed on by the next vblank's flush, before
  tick *t*'s sample: it appears in the same tick's `kon`;
- the logic's first CD command (Setmode) comes about 49,700 cycles into the tick's first vblank;
  in a tick that spans several vblanks (a screen load) it comes about 36,400 cycles before the
  tick's last vblank;
- each blocking `CdControlB` takes about 31,700 cycles until the next command.

With these, the key-on sequence and every voice choice match the original on the whole corpus.

## 6. The CD (`web/src/audio/cd.ts`)

The drive model is the oracle's (`cdrom.cc`), and the program's state and callback are the
original's (§1). The drive: a Play with a Setloc pending waits 20 ms, seeks for 3 µs per sector
of distance + 1 ms, reads one sector (13.333 ms) and plays from there, one sector per
13.333 ms (451,582 cycles measured, the scheduler's lateness included). Position reports start
750 ms after playing does, on every sector whose absolute frame is a multiple of 10, alternating
absolute (frame / 10 even) and track-relative; the Q subchannel counts down in a pregap. The
drive keeps playing, and reporting, until the next Play arrives. The callback runs about
60,500 cycles after its report. Puzzle Mode starts with the head at the start of the disc.

The TOC the program reads gives each track's start rounded down to the second, which can fall
up to 74 sectors into the track's 2-second pregap, so playback starts there.

**Timing within a tick.** Given the cycle of each command, the model places every report within
20,000 cycles of the original's (measured on two movies' `audio.log`). What it can't know is
when, inside a tick, the program's logic sends its commands: that depends on how long the CPU
spends on the logic, which the port doesn't model. So a report, and the loop restart or
silencing it triggers, can land one tick early or late. The trace comparison allows exactly
that for `cd`, `cdr` and the CD volume (one tick, nothing else); all other fields are compared
per tick.

## 7. Assets (`web/tools/extract-audio.ts`)

- `EF.VH` (10,272 bytes, SHA-1 `1b5ff2b4…`) and `EF.VB` (470,912 bytes, `3033c519…`): the
  sound bank as is. `Vab` (`web/src/audio/vab.ts`) reads the header: 15 programs, 50 samples.
- `disc.json`: each track's index 01 and pregap, and each track file's first sector, from the
  cue sheet and the track files' sizes (286,853 sectors).
- `music/02.opus` … `51.opus`: CD-DA tracks 2–51 (track 52 is the "stop" track), each from its
  index 00 so the pregap is included, as Ogg Opus at 96 kb/s (38 MB in all). A track's sector
  *n* is at (*n* − the file's first sector) / 75 seconds.

Re-run after a disc fetch: `npx tsx tools/extract-audio.ts` (in `web/`; needs FFmpeg with
libopus; `--no-music` for the bank and layout only).

## 8. Playback (`web/src/audio/spu.ts`, `worklet.ts`, `player.ts`)

**The SPU** (`Spu`) is a port of the oracle's mixer: 24 voices, each decoding its sample's ADPCM
blocks, interpolating with the hardware's 4-tap gaussian table (`gauss.ts`), applying its ADSR
envelope (the same code as §4) and its fixed volume (`raw / 0x4000`); voices with reverb on feed
the reverb unit (psx-spx's algorithm with its 39-tap half-band filters, on a 22.05 kHz work area
in SPU RAM, as `reverb.cc`), and the main volume scales the sum. One correction: ADPCM decoding
uses the hardware's arithmetic (psx-spx, DuckStation: the two prediction terms summed, + 32,
shifted by 6, clamped to 16 bits). The oracle shifts each term separately and doesn't clamp,
which drifts by a few units from what a console plays. `tools/check-adpcm.ts` checks the decoder
against FFmpeg's `adpcm_psx` on all 50 samples: they agree to within 72 of 32,768 (FFmpeg
truncates its division; the difference is rounding).

**The mixer against the envelope model.** `test/audio.test.ts` plays every sample at four
pitches on the mixer and checks that each voice falls silent on the very sample where the ENVX
model reads 0, so the sound a voice makes ends exactly when libsnd, on the original, would
consider it free.

**The player** (`AudioPlayer`) runs the model after every game tick, with one vblank per tick,
and maps its cycles to the AudioContext's clock (44.1 kHz) a little ahead of time (120 ms; it
re-anchors if the game falls behind). Register writes go to the SPU in an AudioWorklet at the
sample they're due. The CD's sectors play from the Opus tracks (fetched and decoded when the
program sends Setloc, a few kept), through `CdMix` (×127/128, the oracle's measured CD level
0.950 × 0.973; mono sends half of each channel to both sides) and the CD volume registers, which
the player follows as gain changes at their time.

**The mix.** Everything is at the original's register values, so the balance between effects
and music is the program's: effect 0 at the default effect volume plays its voice at
11847 / 16384 of full scale, the music at the default music volume at 28896 / 32768 × the CD
level. A console's analogue output stage isn't modelled.

## 9. Verification

| What | Where | Result |
|---|---|---|
| Sound and CD events per tick, all 8 movies (53,480 ticks) | `npm test` (`test/traces.test.ts`), `npm run trace -- --audio` | identical; CD events within one tick |
| Effect 0's registers, sample addresses | `test/audio.test.ts` | as the original wrote them |
| Mixer voice end vs ENVX model, 50 samples × 4 pitches | `test/audio.test.ts` | identical |
| ADPCM decoding vs FFmpeg | `tools/check-adpcm.ts` | within 72 / 32,768 (rounding) |
| The whole game's sound on the flow ports (§11): full-run from power-on, TIT_DEMO + TITLE, RANKING, SELECT and SW_ON runs | `test/game-audio.test.ts` | identical; CD events within one tick |

## 10. Files

| Path | What it is |
|---|---|
| `web/src/core/sound.ts` | `se_play` and `bgm_request` now record `SoundCall`s (`Game.sound`) |
| `web/src/audio/vab.ts` | The sound bank |
| `web/src/audio/libsnd.ts` | libsnd's voice manager: key-on, allocation, flush |
| `web/src/audio/envelope.ts` | ADSR, and ENVX as the CPU reads it |
| `web/src/audio/driver.ts` | The SPU registers and libsnd per vblank; the trace's `kon`, `koff`, `spu`, `rev` |
| `web/src/audio/cd.ts` | The CD drive and the program's CD callback |
| `web/src/audio/model.ts` | One tick of sound on the original's clock |
| `web/src/audio/spu.ts`, `gauss.ts` | The SPU mixer |
| `web/src/audio/worklet.ts`, `player.ts` | Browser playback |
| `web/tools/extract-audio.ts` | Audio assets |
| `web/tools/render-audio.ts` | A movie's sound to WAV |
| `web/tools/check-adpcm.ts` | ADPCM decoder vs FFmpeg |
| `web/test/audio.ts`, `audio.test.ts` | The model for tests; sound unit tests |
| `re/lua/movie.lua` | Trace version 3, `TP_AUDIO_LOG` |
| `web/src/audio/programs.ts`, `sound-tables.ts` | Each program's sound addresses and timings; the tables' bytes (§11) |
| `re/tools/find_sound_tables.py` | Finds the tables in every EXE, checks they match, writes `sound-tables.ts` |
| `web/test/game-audio.test.ts` | The whole game's sound against the power-route traces |
| `web/test/flow.ts` | `compareFlow`'s `audio` option |

## 11. The whole game (2026-10-18)

The audio layer now follows the whole game, not just Puzzle Mode: the console's one SPU and one
CD drive carry over from program to program, and each program's sound set-up runs on its first
tick.

### What every program shares

The mode programs link the same sound code and the same tables, each at its own addresses:

- libsnd, with its own voice table and flush history in the program's BSS;
- `se_play`, `bgm_request`, `bgm_play_track` and the CD callback, the same code as §1;
- the set-up before the main loop (`FUN_800961C4` in PAZLE, `FUN_80095518` in TITLE, …):
  - `SsSetTickMode(1)`, then `SsVabOpenHead` on the bank the boot program keeps at
    `0x80010000` (`EF.VH`, the same bank for all) and `SsVabFakeBody`;
  - CD input on at the music volume, reverb type 1 at depth 8, reverb volume 32, main volume 127;
  - `bgm_request`'s state (0, `0x34` ×3), `SsStart`, and `SsSetMono` and `CdMix` from the sound
    setting.
- the exit (`FUN_80096604` in TIT_DEMO):
  - `VSync(60)`, clearing the reverb work area, key-off, `SsVabClose`, `SsSetMVol(0, 0)`, `SsEnd`;
  - then `CdSync` and `CdFlush`, before the boot program's loader reads the next program's files.

The tables are the same bytes in every EXE:

- libsnd's pitch table;
- the track table (end offsets, loop modes, priorities);
- the music volume table.

`re/tools/find_sound_tables.py` finds each one in every program by its contents, checks that
they match, and writes them once (`web/src/audio/sound-tables.ts`). The audio layer keeps its
own copy of them at each program's addresses, so a port doesn't have to carry them in its
`rom.ts`.

Every program's first tick in the traces shows the same thing:

- `koff` 0xFFFF, 0xFFFF × 65536, 0xFF × 65536;
- the mix registers and the 32 reverb registers as §5's boot values;
- the CD volume from the music setting;
- the reverb-on mask back to 0.

### Per program (`web/src/audio/programs.ts`)

| Program | Pitch table | Track table | Music volume | History index at first sample | First CD command (before the sample) | Exit stops the CD after |
|---|---|---|---|---|---|---|
| SW_ON | `800B52BC` | `800AF25C` | `800AF0A8` | (tick 1 not modelled) | (no music) | (no music) |
| TIT_DEMO | `800B5338` | `800AEE8C` | `800AECDC` | 15 | 206,989 (always) | 36.0 M cycles |
| TITLE | `800B38A0` | `800ADA18` | `800AD868` | 15 (twice) | (second tick) | 34.6 M |
| RANKING | `800B1B60` | `800ABE40` | `800ABC90` | 8 | (no music) | (no music) |
| SELECT | `800B86B4` | `800B2168` | `800B1FB4` | 7 (7, 7, 8) | 263,000 (263,007; 262,719; 683,699) | 64.5 M |
| PAZLE | `800EC94C` | `800DC610` | `800DC45C` | 13 | (second tick) | 63.0 M |
| HOW_N, HOW_P, HOW_VS | listed in `programs.ts` | | | | | |

NOMAL, VSPUZ and EDIT have tables at:

| Program | Pitch | Track | Music volume |
|---|---|---|---|
| NOMAL | `800C4280` | `800BD80C` | `800BD65C` |
| VSPUZ | `800C9290` | `800BB714` | `800BB564` |
| EDIT | `800D79C0` | `800CC24C` | `800CC098` |

Their sound timings aren't measured, so they have no entry yet.

Where each column comes from (runs with `TP_AUDIO_LOG=1 TP_VRAM_AT=...` on `ranking-records`,
`select-tour`, `select-format` and `sw_on-unformatted`):

- **The head after a load: 173 for every program.** The boot program's loader finds each file
  with `CdSearchFile`, which reads the root directory (LBA 22, MSF 172), so whatever was loaded,
  the head rests just past the directory. Measured from Setmode to the first report of each
  program's first Play:

  | Program | Original | Model, head at 173 |
  |---|---|---|
  | TIT_DEMO | 30,659,125 | 30,642,592 |
  | TITLE | 30,888,099 | 30,886,447 |
  | SELECT | 44,300,841 | 44,298,492 |

  The end of each program's own files, the first guess, put SELECT's first report two ticks
  early.
- **History index.** libsnd's flush ring index (§3), read from RAM dumps at the first tick's
  sample. The index address is each program's `SpuVmFlush` global, in the entry's `history`
  field. SELECT's varies with the load (7 twice, 8 once). TIT_DEMO, TITLE and RANKING allocate
  only voice 0 there, so theirs isn't tested by the traces. SELECT's and Puzzle Mode's run under the comparisons
  (select-format keys voices 0-4 in turn).
- **First CD command.** In a tick that loads a program, the logic's first CD command comes
  before the sample, by an amount that depends on where the load ended within a vblank. TIT_DEMO
  is always 399,853 cycles into a vblank. SELECT varies: 346,814 and 346,880 twice, 490,513 once.
  The entry has the common value. Otherwise §5's rule applies.
- **Exit stops the CD after.** From the exiting program's last sample, the drive goes on playing
  and reporting through the exit until the loader's first read. The value lies between:
  - the last report the loading tick holds;
  - the next report the drive would have made.

  Windows:

  | Program | From `audio.log` | From a sweep on `full-run` |
  |---|---|---|
  | TIT_DEMO | 32.8–37.4 M | |
  | TITLE | 34.3–38.8 M and 30.35–34.86 M | 34–37 M |
  | SELECT | 62.3–66.8 M | 63–66 M |
  | PAZLE | 60.7–65.2 M | 61–64 M |

  A program without a value uses 64 vblanks.

### The model (`model.ts`)

`step(calls, vblanks, start, extras)` does three things on a program's first tick, when it is
given the new program's entry as `start`:

1. It runs the drive until the old program's exit stops it. That drive state is the old
   program's (its track, loop mode and end), so its reports land in this tick as on the console.
2. It moves the head to 173 with fresh callback state.
3. It runs the set-up:
   - the same key-off, mix, CD volume and reverb writes;
   - a new libsnd (every voice free) with the program's pitch table and mono setting;
   - the history index set so that it reads the measured value at the sample.

The SPU registers and envelopes carry over. Live (one vblank per tick), the stop and the set-up
come just before the new program's logic: the port skips loading (docs/RESEARCH_AND_PLAN.md §9),
so the old music stops at the program change instead of about a second into the load.

`extras` (`tickExtras(program)`) carries what a port does to the sound outside its SoundCalls:

- **`mix`** (`Select.mix`): Option mode's stereo/mono switch and SELECT's set-up.
  - `SsSetMono`/`SsSetStereo` sets libsnd's mono flag from that tick's key-ons, so key-on
    volumes are the louder side on both sides in mono.
  - `TickSound.mix` passes the switch to the player, which sets the `CdMix` matrix at its time
    (both channels to both sides at half level, or straight through).
- **`cdReset`** (`Select.cdReset`, `SwOn.cdReset`): the main loop's CD error recovery, in the
  tail right after the previous sample.
  - **`CdReset`** stops the drive's play and reports and leaves the head at 00:02:00 (150).
    After select-format's format, the Play of track 27 that follows reaches its first report
    44,302,037 cycles after Setmode, as from the start of the disc.
  - **SELECT** then records the track's replay as a `play` call (`cdRecover`).
  - **SW_ON** records nothing. The model plays the TOC entry of the track named by
    `PROGRAM_AUDIO.SW_ON.cdTrack` (`0x800B5CDC`, which holds 0). TOC entry 0 is 63:46:00
    (`S+0x20550`), the disc's last 53 sectors: the "garbage Setloc" (99, 70 in decimal).
- **Disc end → error → reset again.**
  - The drive plays those 53 sectors (no report: they end before the 750 ms settle) and stops at
    the disc's end with an error, which the program's callback turns into its CD error flag.
  - At the next tick, the model runs the same reset for a program with a `cdTrack`.
  - This is why sw_on-unformatted resets at ticks 104, 199, 296 and 393. Each reset follows the
    previous Play by 53.79–54.36 M cycles; the model's seek from 150 plus 53 sectors gives 53.9 M.

### Live play: the original's waits (`web/src/shell/main.ts`)

On the original, a tick that calls the memory card or `VSync(n)` takes many vblanks:

- about 165 for a card check, with Puzzle Mode's `VSync(90)` before it;
- about 130 for an 8 KB read or write;
- 60 for SW_ON's `VSync(60)`.

The picture holds while the music plays on. The port runs such a tick at once. The decision:
keep the CD position faithful by holding the game, not by skipping the sound ahead.

- **The shell** reads the tick's waits and passes them to the player as extra vblanks:
  - SW_ON counts its own, in `SwOn.vblanks`;
  - the other programs' card calls add up in `MemoryCards.vblanks`, which the shell then clears;
  - Puzzle Mode's `VSync(90)` before its card checks (save substep 5, Continue substep 3) now
    adds 90 there too (`src/core/screens/after.ts`, `menu.ts`).
- **The model** runs that many vblanks of libsnd flushes and CD sectors.
- **The shell then delays the next tick** by as long, so picture and sound stay together, as on
  the console.

What the port can't count, live:

- the CD reset's own wait (8–10 vblanks in sw_on-unformatted);
- loading pauses.

### What is compared (`test/game-audio.test.ts`, `compareFlow`'s `audio` option)

`compareFlow(..., { audio })` runs one model across the flow and compares `vs`, `kon`, `koff`,
`spu` and `rev` per tick. As in `compareMovie`, `cd`, `cdr` and the CD volume are timed events
allowed one tick of slack. Results on the power-route traces, all identical:

- **`full-run` from power-on, every one of its 10,277 ticks:**
  - SW_ON, then TIT_DEMO, TITLE and SELECT;
  - Puzzle Mode (password, stage select, a stage, the ending, credits, name entry);
  - then RANKING and TIT_DEMO.

  That is every program change of a complete game, with 99 key-ons and 1,217 CD reports.
- **TIT_DEMO then TITLE**, as one run each:
  - `attract-cycle` 371–4622, 11898–16150 and 19571–23822;
  - `title-skip` 371–1301, `title-anim` 371–2601, `title-carry` 371–904.
- **RANKING**, from its first tick: `attract-cycle` 11458–11897 and 19131–19570, and
  `ranking-records` 2702–3069.
- **SELECT**, from its first tick and from power-on: `select-tour` (2402–3827), `select-card`
  (2402–4416) and `select-format` (3299–4579). The SELECT runs cover:
  - the mode select's music (track 27) and effects;
  - Option mode's sound test, stereo/mono and volumes;
  - the format's CD reset and the track restarted with it.
- **SW_ON**, from power-on into TIT_DEMO: every `sw_on-*` movie, including `sw_on-unformatted`'s
  four CD resets.
- **From power-on** through SW_ON, TIT_DEMO and TITLE: `title-skip` and `title-carry`.

What can't be compared:

- **At the first tick of a run that starts mid-trace,** the original's reports aren't compared.
  They come from the previous program's drive during the load, and the run starts without it.
- **At power-on (tick 1),** `kon` and `koff` aren't compared. They are the boot program's SPU
  initialisation (48 key-ons and 13 key-off writes), which isn't modelled; SW_ON's own set-up
  matches.
- **The HOW programs** run as stand-ins (`src/flow/stand-ins.ts`). Their music, their effects
  and their effect on the drive are skipped, so a trace can't be followed past them. Everything
  after them is compared from a fresh start (the RANKING runs).
- **At a trace's last tick,** an event the port puts there may be the original's next tick's, so
  it isn't flagged.

### Adding a program

1. The port records its calls in `Program.sound`. `ModeProgram.sePlay`/`bgmRequest` in
   `web/src/programs/title/common.ts` show the pattern, with addresses from the program's
   `Layout`. Add `mix` and `cdReset` fields if it has them.
2. Its entry in `PROGRAM_AUDIO` needs the table addresses (run the finder), and the history
   index, first CD command and exit stop. Measure those with one run:

   ```
   TP_AUDIO_LOG=1 TP_VRAM_AT=<first ticks> bash scripts/emu-slot.sh bash scripts/run-movie.sh <movie> <out>
   ```

   A movie's cards come from its `card` lines or `TP_MEMCARD1/2`. For example,
   `sw_on-unformatted` needs `TP_MEMCARD1=<128 KB of zeros>` and `TP_MEMCARD2=none`, or the run
   isn't the trace's.

The player (`player.ts`) follows the running program by object identity. The shell passes the
console's current program each tick, and the player starts the model with the first program it
sees. `CdMix` is applied anew from the sound setting at each program start, as each set-up does,
and on each `mix` event.
