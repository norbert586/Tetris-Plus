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
