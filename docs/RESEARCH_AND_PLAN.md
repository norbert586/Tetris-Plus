# Tetris Plus (PS1) on the web — Puzzle Mode: research and plan

Status: research only, no code written yet. Date: 2026-10-16.

## TL;DR

- **Goal.** A browser version of Tetris Plus's Puzzle Mode (the professor mode) that looks, sounds
  and plays like the PlayStation original. Reference version: NTSC-U, serial SLUS-00338.
- **Approach.** Reverse-engineer the original disc to get the exact rules, data, art and audio.
  Rebuild the game as a clean TypeScript web app. Then *prove* it matches by running the original
  in an emulator and comparing it with the port frame by frame: game state, pixels and audio events.
- **Where REA fits.** [`morluto/rea`](https://github.com/morluto/rea) ("Reverse Engineer Anything") is
  the static-analysis front end. It drives Ghidra so I can decompile and trace the game's MIPS code,
  and it keeps an evidence trail. It can't load PS1 executables directly, but its source shows a
  supported path (an ELF wrapper plus the `PSX:LE:32:default` language from ghidra_psx_ldr). It never
  runs code, so the PCSX-Redux emulator/debugger covers the dynamic half.
- **Private repo, playable from a private URL.** The repo goes private and the game's extracted art,
  music and stage data are committed to it. The built site is hosted behind a login (Cloudflare
  Pages + Cloudflare Access), so it opens from anywhere with no import step. The raw disc image
  stays out of git (too big) and lives in private storage.
- **What I need from you to start:** make the repo private, upload the disc image and pass me its
  link through an environment variable, and open up network access. See §9.

---

## 1. Scope

**In scope (one player, Puzzle Mode):**

- Boot, title and mode-select screens (other modes visible but disabled, unless you prefer them hidden)
- Puzzle Mode entry: new game and password entry
- Zone selection: Egypt, Angkor Wat, Maya, Knossos, plus Atlantis once those four are cleared
- All 100 stages: intro, play, clear, failure, continues and passwords
- Every Puzzle Mode HUD element, animation, transition, music track and sound effect
- Any cutscenes, endings and credits reachable from Puzzle Mode
- Original behaviours that players know, such as the stage-select password and holding R2 after a
  clear to make the professor walk faster
- Whatever progress the original saves, persisted in the browser
- Playable from a private, login-protected URL in desktop browsers, with keyboard or gamepad

**Out of scope for now:** Classic, Versus and Edit modes. The architecture keeps the stage format and
mechanics reusable so they can be added later. Edit Mode uses the same stage format, and Versus is
Puzzle Mode plus garbage lines.

## 2. What is known about the game, and how far to trust it

| # | Claim | Source(s) | Confidence |
|---|---|---|---|
| 1 | Serials: JP SLPS-00466 (1996-09-06), US SLUS-00338 (1996-11-18; Wikipedia says Oct 18), EU SLES-00442 (JVC Music Europe), JP reissue SLPS-01720 | PSX Data Center, TetrisWiki, Wikipedia | High for serials, medium for dates |
| 2 | Developed by Natsume (Wikipedia says Jaleco), published by Jaleco; composer Iku Mizutani | PSX Data Center, Zophar's Domain, Wikipedia | Medium |
| 3 | Disc layout is 1 data track plus 51 CD audio tracks (JP and PAL listings), so the music is standard CD audio | PSX Data Center | Medium-high; check on the US image |
| 4 | PS1 version ≈ Saturn version. PS1 puzzles differ from the arcade's in type, number and organisation | Wikipedia; RetroAchievements forum | Medium |
| 5 | Sega rotation, except 3-wide pieces spawn "rounded right"; no hold; no hard drop; Classic shows 3 next pieces | TetrisWiki infobox, Hard Drop wiki | Medium; preview count in Puzzle Mode unknown |
| 6 | Professor: enters through a disappearing gate and is 2×2 cells. He walks until he bumps a block, then turns. He drops through gaps wide enough for him. Overlapping blocks make him climb until he reaches empty space (pieces don't crush him). If he can't move he sleeps until a block lands on him or the ceiling reaches him. Being pushed into the spikes is an instant loss | Wikipedia, Tetris fandom wiki, Hard Drop wiki | Medium; each source words the rules differently |
| 7 | Ceiling starts at the top and drops about one row every ~18 s. Clearing 3–4 lines at once pushes it back up. It destroys placed blocks in its path | Wikipedia, fandom wiki, TV Tropes | Medium |
| 8 | Something happens at 125 s: one source says the ceiling speeds up, another says the stage is lost | fandom wiki, TV Tropes | **Low (contradictory)** |
| 9 | 5 zones × 20 stages = 100. Sources disagree on whether the first four zones are played in order or picked freely | Wikipedia, fandom wiki, RetroAchievements | Medium |
| 10 | Coloured-block passwords; a stage-select code entered on the password screen; hold R2 after a clear to speed the professor up | Supercheats | Low-medium (two conflicting code variants) |
| 11 | Story: an unnamed archaeologist ("the Professor") and his assistant (Jo) exploring ruins | TV Tropes, reviews | Low; only matters for cutscenes |
| 12 | RetroAchievements has a PS1 set (game 3145, 31 achievements). Its code notes usually label key RAM addresses | RetroAchievements | Set confirmed; notes not yet seen |
| 13 | No existing decompilation, disassembly project or faithful remake was found | Web searches | Medium |

## 2a. Verified facts from your disc image (2026-10-16)

- **Image:** Redump-style BIN/CUE with 52 tracks. Track 01 is the data track (MODE2/2352,
  52,148,544 bytes). Tracks 02–52 are CD audio, about 58.8 minutes in total, each file including its
  2-second pregap.
- **Version:** Track 01 matches Redump "Tetris Plus (USA)", SLUS-00338 (the Greatest Hits release
  has the same data track):
  - CRC32 `2C9426B6`
  - MD5 `4808ABA3DE7C43EFBC84DF44278040AC`
  - SHA-1 `7A300536E37708B791B72433DCAFAC8D0E5069EB`

  The audio tracks haven't been checked against Redump yet, because the full Redump database
  wasn't reachable.
- **Volume:** `TETRIS_PLUS`, publisher JALECO, mastered 1996-08-22; boots `SLUS_003.38`.
- **Structure:** the game is split into one program per mode, each with its own data file:

| File(s) | Size | Likely role |
|---|---|---|
| `SLUS_003.38` | 116 KB | Boot program; probably loads and chains the mode programs below |
| `EF.VH` / `EF.VB` | 10 KB / 460 KB | Global sound-effect bank (VAB) |
| `JLOGO.EXE` + `J_PS.STR` | 166 KB + 1.2 MB | Jaleco logo video |
| `SW_ON.EXE` + `SW_ONE.BIN` | 138 KB + 25 KB | Startup screen |
| `TIT_DEMO.EXE` + `TDEMOE.BIN` | 138 KB + 82 KB | Title demo |
| `TITLE.EXE` + `TITLEE.BIN` | 132 KB + 386 KB | Title and mode select |
| `SELECT.EXE` + `SELECTE.BIN` | 152 KB + 133 KB | Selection screen (probably Puzzle zone select) |
| **`PAZLE.EXE` + `PAZLEE.BIN`** | **360 KB + 928 KB** | **Puzzle Mode** |
| `HOW_P.EXE` + `HOWPE.BIN` | 256 KB + 197 KB | Puzzle how-to-play |
| `RANKING.EXE` + `RANKINGE.BIN` | 124 KB + 62 KB | Rankings |
| `NOMAL.*`, `VSPUZ.*`, `EDIT.*`, `HOW_N.*`, `HOW_VS.*` | — | Classic, Versus, Edit and their how-to-play screens (out of scope) |
| `DM3M30S.DA` | 35 MB | Filler (exactly 3 min 30 s worth of sectors) |

**What this means for the plan:**

- **The reverse-engineering target is bounded.** Gameplay lives in `PAZLE.EXE`. The boot program's
  hand-off between programs, plus `SELECT` and `TITLE`, cover the flow around it. Each is a
  standalone PS-X EXE, which suits the per-executable REA approach in §5.1.
- **Music:** many tracks come in same-length pairs (for example 2/3, 14/37, 28/48). That suggests
  two versions of each tune, or duplicates. *Resolved in Phase 1:* tracks 2–33 are the console
  arrangement and 34–51 the arcade one, picked by Option mode's music setting
  (`docs/re/disc-inventory.md` §7).
- **Data files:** the `E` suffix (`TITLEE`, `PAZLEE`, …) probably marks English data. *Resolved in
  Phase 1:* they are indexed archives of LZ-compressed TIM images (`docs/re/disc-inventory.md` §3).

## 3. Why community info isn't enough

The wikis describe what a player sees, often vaguely, and they contradict each other on the
125-second rule, zone order, the climb rule and the stage-select code. None of them give the numbers
that make the game *feel* right. These have to come from the game's code and data:

- **Piece timing:** gravity per stage, lock delay, entry delay, line-clear delay, auto-repeat timing, soft-drop speed
- **Randomness:** the RNG algorithm and where it is seeded, and whether stages use fixed piece sequences
- **Preview:** how many next pieces Puzzle Mode shows
- **Professor:** walk speed in pixels per frame, plus the exact climb, fall, sleep and wake rules and
  their edge cases (rotation into him, being boxed in)
- **Ceiling:** its timer, how far line clears push it back, the 125 s rule, how it destroys blocks
- **Stages:** all 100 layouts, plus professor start, gate position and any per-stage parameters
- **Meta-game:** scoring, the timer display, continues, losing conditions, the password algorithm
- **Presentation:** screen layouts, animation frame timings, palettes and transitions
- **Audio:** which music plays on which screen and how it loops, sound-effect triggers, mix levels

So the binary is the spec. The wikis are only hints to check against it.

## 4. Approach

```
          your disc image (BIN/CUE, private)
                    │
   ┌────────────────┼──────────────────────────┐
   │                │                          │
 data track      CD audio tracks          same image booted
 (files + EXE)   (music)                  in PCSX-Redux (the "oracle")
   │                │                     debugger · memory scanner ·
 dumpsxiso +     rip → FLAC/Opus          GPU logger · Lua · HTTP API
 format decoders    │                          │
   │                │            dynamic RE: where state lives,
 art, fonts, SFX,   │            which code writes it, what gets drawn
 stage data         │                          │
   │                │                          ▼
 EXE + overlays ─► Ghidra + ghidra_psx_ldr ─► REA (MCP tools for the agent)
                   (names PsyQ library code)   decompile · xrefs · value flow
                                               │
                              behaviour specs + evidence ledger
                                               │
                     TypeScript web app (core · renderer · audio · input)
                                               │
        verified against the oracle: function / frame / pixel / audio-event diffs
```

**Loop for every mechanic:**

1. Observe it in the emulator and form a hypothesis.
2. Find where its state lives in RAM (memory scanner, RetroAchievements notes), then set a
   watchpoint to find the code that writes it.
3. Decompile that code through REA. Follow callers, callees and data flow. Name things.
4. Write the behaviour spec with evidence (addresses, Evidence IDs). Extract constants and tables.
5. Implement it in the TypeScript core.
6. Verify it against the original (§8), then close it in the ledger.

**Alternatives considered:**

| Option | Verdict |
|---|---|
| Run the disc in a browser emulator (EmulatorJS / PCSX-ReARMed in WASM) | That's the whole game in an emulator, not a web app. No control over menus or UX, heavier, BIOS issues, can't be trimmed to Puzzle Mode. Used only as a desktop **test oracle** |
| Full matching decompilation (splat + maspsx + PsyQ-era GCC) | Months of work on parts we don't need, and the output is PS1 C, not a web app. Kept as an option for individual functions where byte-matching is the cheapest proof |
| "Feel-alike" remake from videos and wikis | Rejected. Community facts are thin and contradictory. You'd get "Tetris with a professor", not Tetris Plus |
| **Spec from reverse engineering + clean reimplementation + differential verification** | **Chosen** |

## 5. Tooling research

### 5.1 REA (`morluto/rea`)

**What it is:** an MCP server and CLI (`rea-agents` 6.5.0 on npm, MIT licence). It lets an agent
inspect binaries through Ghidra, IDA or Hopper. Results come back as Evidence records that separate
observations, inferences and unknowns. Native analysis needs Ghidra 12.1.x (verified with 12.1.4)
and JDK 21.

**Tools we'll use:**

| Tool(s) | Purpose |
|---|---|
| `open_binary`, `list_procedures`, `search_procedures` | Open the target and find functions |
| `search_strings`, `read_bytes`, `search_bytes` | Find text, data tables and stage layouts |
| `procedure_pseudo_code`, `procedure_assembly` | Decompiled C and raw assembly |
| `procedure_callers`, `procedure_callees`, `procedure_references` | Cross-references |
| `analyze_function` (p-code value-flow dossier), `trace_native_values` | How values move through and across functions |
| `set_address_name` | Session-local naming |
| `export_evidence_bundle` | Save evidence for the ledger |
| `build_reconstruction_obligation_ledger` | Tracks each mechanic until a passing verifier closes it |

**Gaps for PS1 (checked against REA's docs and source):**

1. **No PS-X EXE loader.** REA's raw-binary mode supports x86, x86-64, ARM, AArch64 and 6502, but
   not MIPS.
2. **The MIPS ELF path works for us.** REA admits ELF32 executables flagged `EF_MIPS_ARCH_32`
   (`0x50000000`) with no ABI field and no ABI-flags record as a "recordless legacy" image. An
   explicit `REA_GHIDRA_LANGUAGE_ID` overrides its default MIPS choice (`src/ghidra/GhidraMipsProfile.ts`).
3. **The PS1 language passes REA's check.** REA validates that override against the `.ldefs` files
   under `Ghidra/Processors` and `Ghidra/Extensions` (`src/ghidra/GhidraLanguageCatalog.ts`).
   Installing ghidra_psx_ldr into the Ghidra install makes `PSX:LE:32:default` a legal choice.
4. **PsyQ library naming needs a bootstrap pass.** ghidra_psx_ldr's analyzers switch on for any
   program in the PSX language (`PsxAnalyzer.isPsxLoaderOrPsxLanguage`). However, its PsyQ
   library-signature pass needs the SDK version, and only its own loader detects that. Plan: one
   bootstrap run in plain Ghidra with the real PSX loader, then export the identified names into
   REA's seed file (`REA_GHIDRA_SEED_FILE`, one `address<TAB>function<TAB>name` per line).
5. **Names don't persist.** REA's Ghidra database lasts one session, so renames vanish. The canonical
   names will live in `re/symbols/seeds.tsv` in git (addresses and names only).
6. **Static only.** REA never runs code. PCSX-Redux covers dynamic analysis (§5.3).

**Bridge:**

- `psxexe2elf`, a small converter:
  - Reads the PS-X EXE header fields `t_addr`, `t_size`, `pc0`, `gp0`, `b_addr` and `b_size`.
  - Writes an ELF32 LE MIPS `ET_EXEC` with `e_flags=0x50000000`.
  - Maps the code bytes at `t_addr` (plus a BSS segment) and sets the entry point to `pc0`.
- Overlays get one wrapper each at their runtime address. Alternatively, a "Puzzle Mode memory
  image" built from a RAM snapshot covers compressed or relocated code automatically.
- Environment: `GHIDRA_INSTALL_DIR`, `REA_GHIDRA_LANGUAGE_ID=PSX:LE:32:default`,
  `REA_GHIDRA_SEED_FILE`, `GHIDRA_HEADLESS_MAXMEM=4G`.
- Registration: a project `.mcp.json` running `npx -y rea-agents@6.5.0 mcp`.

**Tested in Phase 0 (2026-10-16):** REA 6.5.0 refuses `REA_GHIDRA_LANGUAGE_ID=PSX:LE:32:default`
for MIPS targets, because an override must equal its pinned `MIPS:LE:32:default`. Fallback 1 is in
use, and the PsyQ library names come in through the seed file. See `docs/re/phase0.md`.
The fallbacks, in order:

1. Use Ghidra's built-in `MIPS:LE:32:default`. Game logic is integer code; only GTE (3D maths)
   instructions would lose readability.
2. Add an ELF "opinion" entry for PSX to our local ghidra_psx_ldr build.
3. Drive Ghidra headless directly (pyghidra scripts) for whatever REA can't serve.

### 5.2 Ghidra + ghidra_psx_ldr

[ghidra_psx_ldr](https://github.com/lab313ru/ghidra_psx_ldr) adds PS1 support to Ghidra:

- PS-X EXE loader and memory map (RAM mirrors, scratchpad, I/O registers)
- GTE instructions and macros
- PsyQ data types and an overlay workflow
- **PsyQ library signatures across SDK versions.** These auto-name the Sony library functions
  (`libgpu`, `libgte`, `libspu`, `libsnd`, `libcd`, `libetc`, `libapi`), so we only read Natsume's
  game code.

It is actively maintained: the last commit is 2026-10-04 ("CI: Ghidra 12.1.4"), the same Ghidra
version REA is verified with. It builds with Gradle, which is already installed here.

### 5.3 PCSX-Redux (oracle and dynamic analysis)

[PCSX-Redux](https://github.com/grumpycoders/pcsx-redux) is an open-source PS1 emulator built for
development and reverse engineering. Verified from its source:

- **Debugger:** breakpoints, read/write watchpoints, call stacks, CPU trace, typed debugger.
- **Memory observer:** scans RAM to find where the game keeps a value.
- **GPU logger:** the per-frame list of draw commands, with exact sprite positions, texture pages,
  palettes and blend modes. Also a VRAM viewer.
- **CD-ROM viewer and ISO browser.**
- **Lua scripting:** memory access and breakpoint callbacks. It can override individual controller
  buttons (`PCSX.SIO0.slots[n].pads[1].setOverride`) and hook each VSync. Together these give
  scripted input playback plus per-frame state dumps.
- **HTTP API:** RAM and VRAM dumps, screenshots, save states, Lua execution and pause/resume.
- **Automation and accuracy modes:** GDB server, headless `-cli` / `-testmode`, interpreter mode
  (deterministic and debuggable), a software GPU for reference pixels.
- **OpenBIOS:** boots games without a Sony BIOS.

A second emulator (DuckStation or Beetle PSX, both needing a real BIOS) is used only to cross-check
anything suspicious.

### 5.4 Disc and assets

- **dumpsxiso** ([mkpsxiso](https://github.com/Lameguy64/mkpsxiso) v2.30) reads a `.cue`, extracts
  every file and records the exact on-disc layout, including XA attributes. It also extracts CD audio
  tracks as WAV or FLAC.
- **Format decoders, written in TypeScript** so the build pipeline and any future in-browser
  importer share them:
  - TIM images (4/8/16/24-bit with palettes)
  - VAB/VAG sound banks (SPU ADPCM)
  - SEQ/SEP sequences if present
  - whatever custom archive or compression the game uses, identified from its code in Phase 1
- **jPSXdec** if any video (STR) or streamed (XA) audio exists.
- **ffmpeg** (already installed) for FLAC/Opus encoding.

### 5.5 Decompilation helpers and function-level testing

- [m2c](https://github.com/matt-kempster/m2c) (`mipsel-gcc-c` target) gives a second decompiler
  opinion on tricky functions.
- [splat](https://github.com/ethteck/splat), [maspsx](https://github.com/mkst/maspsx) and old GCC
  allow optional byte-for-byte matching of individual functions.
- **Unicorn** (from PyPI) runs an original MIPS function on its own with thousands of generated
  inputs and compares the results with the TypeScript port. This is the technique behind REA's
  DX-Ball showcase (3,205 original-x86 cases).

### 5.6 Hardware reference

[psx-spx](https://github.com/psx-spx/psx-spx.github.io) documents the PS1 in detail. Its source is
reachable from here even though the website isn't. Relevant parts:

- **GPU:** VRAM, texture pages, palettes, the four semi-transparency modes (B/2+F/2, B+F, B−F,
  B+F/4) and the dithering rules.
- **Video timing:** NTSC refreshes at **59.826 Hz progressive** and 59.940 Hz interlaced.
- **SPU:** ADPCM, ADSR envelopes, reverb.
- **CD-ROM and controllers.**

### 5.7 This environment

- **Container:** Ubuntu 24.04, 4 vCPU, 15 GB RAM, ~30 GB free disk.
- **Already installed:**
  - Node 22.22 (REA needs ≥ 22.19) and OpenJDK 21 (Ghidra 12.1 needs it)
  - Gradle 8.14, GCC, Clang, CMake, Ninja
  - ffmpeg, Xvfb, Docker, Playwright Chromium
- **Reachable:** GitHub (git, raw files, release downloads), npm, PyPI, Ubuntu apt.
- **Blocked by the network policy:** tetris.wiki, Wikipedia, GameFAQs, TCRF, Hard Drop,
  RetroAchievements, Redump, the psx-spx website, distrib.app (PCSX-Redux builds), YouTube.
- **Containers are thrown away after each session.** All tooling therefore installs through a setup
  script with pinned versions, and private data is re-fetched each session.

## 6. What "faithful" means here

**Logic and timing**

- One logic tick per original frame, at the original rate. NTSC progressive is 59.826 Hz; Phase 2
  confirms the game's video mode and whether its logic runs every vblank.
- The same state machine and the same integer arithmetic, including overflow and truncation.
- The same RNG algorithm and seeding point.
- Input sampled once per frame, with the same auto-repeat.
- The same gravity, lock, entry-delay and line-clear timings, and the same rotation rules.
- The same professor and ceiling rules, and the same stage data.
- The same scoring, timer, continues and passwords.
- **Quirks and bugs are part of the spec.** We keep them and document them.

**Visuals**

- Native resolution on every screen (this can change per screen).
- The original sprites, backgrounds, fonts and palettes, at identical positions with identical
  animation timing.
- PS1 GPU rules: 15-bit colour, palettised textures, black as transparent, per-texel
  semi-transparency with the four blend modes, and dithering only where the hardware applies it.
- Presentation: sharp integer scaling and a correct 4:3 aspect by default. A CRT filter is optional,
  and there is no smoothing unless you choose it.

**Audio**

- The original CD audio tracks (FLAC or high-bitrate Opus), with the same loop behaviour.
- Sound effects from the original SPU samples with the original pitch, volume and ADSR envelopes
  (and reverb, if the game uses it).
- The same trigger frames, and a mix ratio taken from the SPU and CD volume registers the game sets.

**Feel**

- No added input lag: input is sampled immediately before each tick.
- Keyboard and gamepad. Pauses when the tab loses focus.

**Choices to confirm:**

- Reproduce original slowdown frames? Default: only if they affect gameplay.
- Reproduce CD loading pauses? Default: no; transitions stay instant, with the original fades kept.

## 7. Web app architecture

| Module | Responsibility |
|---|---|
| `core/` | Deterministic Puzzle Mode simulation in pure TypeScript, no DOM: `step(state, padMask) → state + events`. State is serialisable, which gives save states, replays and test fixtures for free. Its structure mirrors the original's subsystems so specs map 1:1 to code |
| `render/` | PS1-faithful software compositor at native resolution. It implements only the GPU primitives the game actually uses, found with the GPU logger. A 15-bit framebuffer goes to a WebGL2 presenter for integer/aspect scaling and an optional CRT shader. Software rendering is what makes pixel-exact matching realistic; at 320×240 it costs about a millisecond per frame |
| `audio/` | Web Audio. A CD-audio track player with sample-accurate loops. An AudioWorklet "mini-SPU" handles SFX: ADPCM-decoded samples, pitch, ADSR, volume and reverb if used |
| `input/` | Keyboard and Gamepad API mapped to the PS1 digital pad bitmask; remappable |
| `assets/` + `tools/extract/` | Build-time asset pipeline. A Node script reads the disc image and checks its hash to confirm the right version. It converts only Puzzle Mode assets into web-ready files (sprite sheets, compressed music, stage data as JSON) under `web/public/assets/`, which are committed to the private repo. The decoders are written so an in-browser importer could reuse them if an asset-free public version is ever wanted |
| `ui/` | A thin shell around the game: settings (controls, volume, display) and fullscreen, drawn with the game's own font so it doesn't clash |

- **Main loop:** `requestAnimationFrame` plus a fixed-step accumulator at the original rate. The
  game runs at the same speed on 60, 120 and 144 Hz displays.
- **Persistence:** progress, passwords and settings in localStorage/IndexedDB, mirroring what the
  original keeps.
- **Stack:** Vite, strict TypeScript, Vitest and Playwright. The output is a static site (PWA-capable).
- **Hosting:** Cloudflare Pages, auto-deployed from the private repo, with Cloudflare Access in
  front so only invited emails can open it (free for up to 50 people).
- **Why not GitHub Pages:** its sites are public even when the repo is private.
- **Size limits:** 100 MB per file in git, 25 MiB per file on Cloudflare Pages. Music is split
  per track, so neither limit is a problem.

## 8. Verification

1. **Function level.** Unicorn runs original routines with generated inputs, and they must equal the
   TypeScript versions. Covered routines: rotation/collision, RNG, line clear, the professor step,
   ceiling update and the password codec.
2. **Frame level (golden traces).** PCSX-Redux plays an input movie while Lua dumps the decoded game
   state every frame:
   - board and active piece
   - next queue and RNG state
   - timers
   - professor position, direction, state and animation frame
   - ceiling, score and mode state

   The TypeScript core replays the same inputs from the same start state and must match on every
   frame. The first divergence is reported with context.
3. **Pixel level.** Our native-resolution framebuffer is compared with PCSX-Redux software-GPU frames
   for the same movie. The target is an exact match, or a documented deviation you've approved.
4. **Audio-event level.** Which track or SFX starts or stops on which frame, at which pitch and
   volume, must match. Decoded samples are spot-checked against an SPU capture.
5. **Whole game.**
   - A solver built on the TypeScript core finds a clearing input sequence for each of the 100 stages.
   - Each sequence is replayed on the original in PCSX-Redux, and the outcome and per-frame state
     must match.
   - Any stage the solver can't crack gets a human-played recording instead.
   - Done means 100/100.

**Ledger.** Every mechanic is an obligation with evidence (addresses, REA Evidence IDs), an owner
module, fixtures and a verifier. It closes only when its verifier passes. This uses REA's
`build_reconstruction_obligation_ledger`, or a Markdown ledger if that tool proves too rigid.

**Where test data lives.** Because the repo is private, game-derived fixtures can be committed:
traces with real stage layouts, reference frames and audio-event logs. Every verification layer
can therefore run in CI and in any session. Bulky raw material (RAM/VRAM dumps, save states)
stays out of git unless it's small and compressed.

## 9. What I need from you

**Status (2026-10-16):** steps 1–4 are done. The repo is private, network access is set to full,
and the image is uploaded and verified (§2a). `TETRIS_DISC_URL` isn't needed: sessions find the
file by name through your connected Google Drive.

**Now, before any reverse-engineering work**

1. **Make the repo private.** GitHub → `norbert586/Tetris-Plus` → Settings → General → Danger
   Zone → Change repository visibility → Make private. If my GitHub access breaks afterwards,
   reconnect at https://claude.ai/connect-github and check that the Claude GitHub App is installed
   on the repo.
2. **Check the disc image** (reference version: Tetris Plus (USA), SLUS-00338). Send me the file
   names and sizes.
   - Complete: a `.cue` with `.bin` track files, or an `.iso` plus audio files.
   - Probably missing the 51 music tracks: a lone `.iso` much smaller than several hundred MB.
3. **Upload it.** Zip the image folder, upload it to Google Drive and set sharing to "Anyone with
   the link". Don't commit it (GitHub rejects files over 100 MB) and don't paste the link in chat.
4. **Configure this environment** (environment menu in the session title bar → Edit):
   - **Environment variable:** `TETRIS_DISC_URL` = the Drive link.
   - **Network access, simplest option:** switch to the broadest access level.
   - **Network access, if you keep it limited:** keep "Allow package managers" ticked and add
     these Allowed domains:
     - disc download: `drive.google.com`, `drive.usercontent.google.com`
     - prebuilt PCSX-Redux: `distrib.app` (without it I compile it every session)
     - research: `tetris.wiki`, `harddrop.com`, `gamefaqs.gamespot.com`, `tcrf.net`,
       `retroachievements.org`, `redump.org`, `en.wikipedia.org`

**Later (I'll say when a playable build exists)**

5. **Hosting.** Create a free Cloudflare account. When it's time, connect the repo under Workers &
   Pages and put Cloudflare Access in front of the site. Access lets in only the emails you allow,
   via a one-time code. I'll give the exact build settings then.

**Optional**

6. Your console's BIOS dump (for example SCPH-1001), for a second-emulator cross-check.
7. The Japanese disc (SLPS-00466), only if you want a Japanese option later.

**Not needed from you: tool installation.** I'll commit a setup script that installs Ghidra 12.1.4,
ghidra_psx_ldr, REA 6.5.0, PCSX-Redux, mkpsxiso, Unicorn and m2c, with pinned versions, at the
start of each session. If a later session asks you to approve a tool server called `rea`, approve it.

**Decisions (my recommendation in bold)**

- Reference version: **NTSC-U SLUS-00338**.
- Asset strategy: **decided: private repo with extracted assets committed, site behind a login**.
- Menus: **original title and mode-select screens, with non-Puzzle modes visible but disabled**
  (or hidden).
- Display defaults: **pixel-perfect integer scaling, 4:3, CRT filter off but available**.
- Loading pauses and slowdown: **don't reproduce loading pauses; reproduce gameplay timing exactly**.
- Platforms: **decided: desktop web browsers only, with keyboard and gamepad. No touch controls.**

## 10. Phased plan

**Status:** Phases 0 and 1 are complete (Phase 0 on 2026-10-16, see `docs/re/phase0.md`; Phase 1
on 2026-10-17, see `docs/re/disc-inventory.md`). Phase 2 is next.

| Phase | Work | Deliverable | Exit criteria | Size |
|---|---|---|---|---|
| 0. Setup and spike | Toolchain via setup script. Disc fetched and hash-checked. `psxexe2elf` built; REA opens the main EXE in the PSX language. PsyQ names bootstrapped. PCSX-Redux boots headless and Lua can dump RAM and inject inputs | Setup script, `.mcp.json`, `seeds.tsv` v0, oracle smoke test | All four tools work end to end on the real disc; REA fallback decided | S–M |
| 1. Disc inventory | dumpsxiso; classify every file; find overlays and compression; list CD tracks with durations; identify the Puzzle Mode working set | `docs/re/disc-inventory.md` | Every file has a format/role or an explicit "unknown" | S |
| 2. Static bootstrap | Main loop, VSync, pad reading, mode dispatcher, Puzzle Mode entry; library calls named | `seeds.tsv` v1, call-graph notes | Puzzle Mode code region bounded | M |
| 3. Dynamic map | Memory scanner and watchpoints find board, piece, queue, RNG, timers, professor, ceiling, score and state machine, each linked to the code that writes it | `docs/re/ram-map.md` | Every gameplay variable has address, type and writer | M |
| 4. Spec extraction | Decompile and document each subsystem. Extract tables: pieces, rotations, gravity, timings, the 100 stage layouts, animation and layout tables, password codec | `docs/spec/*.md` + extracted data files | Every ledger mechanic has evidence | **L (critical path)** |
| 5. Oracle harness | Input-movie format, Lua tracer, deterministic replays, edge-case movie corpus | `re/lua/*`, trace corpus | Same movie gives identical traces on repeated runs | M |
| 6. Core port | TypeScript core, Unicorn function tests, golden-trace equality | `web/src/core` | 100% trace equality on the corpus | M |
| 7. Renderer and assets | Asset pipeline and decoders, committed web assets, PS1 compositor, every Puzzle Mode screen | `web/src/render`, `tools/extract`, `web/public/assets` | Pixel-identical to reference frames | L |
| 8. Audio | CD-audio player and loops, mini-SPU SFX, mix levels | `web/src/audio` | Audio-event traces match; mix measured | M |
| 9. Flow and shell | Title → zones → 100 stages → endings; passwords; persistence; settings; gamepad; fullscreen | Playable build | A complete run on the port | M |
| 10. Proof, polish and deploy | 100-stage solver replays on the original; performance in Chrome, Firefox and Safari; PWA build; deploy to Cloudflare Pages behind Cloudflare Access | Live private URL + verification report | 100/100 stage equivalence; steady frame rate; uninvited visitors are refused | M |

**Parallel work:** Phase 5 can start once Phase 3 is done; Phase 7's decoders once Phase 1 is done;
Phase 8 once Phases 1 and 4 are done.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ghidra's ELF loader rejects the PSX language for the wrapper | Fallbacks in §5.1, decided in the Phase 0 spike |
| Code is compressed or loaded as overlays | Analyse RAM-snapshot images; use ghidra_psx_ldr's overlay workflow |
| RNG seeded from hardware timers | The harness reads RNG state from RAM and injects it; the port keeps the same algorithm and seeding point |
| Emulator inaccuracy | Logic traces don't depend on timing; cross-check anything odd on a second emulator (and real hardware, if available) |
| Data tables in odd encodings | Known-plaintext search (take the RAM board at stage start, search the disc files for it) plus cross-references from the loading code |
| SPU detail (ADSR, reverb) slightly off | Implement psx-spx's documented algorithms; compare against emulator SPU captures |
| Browser audio unlock and latency | Unlock audio on "Press Start"; schedule sound through AudioWorklet |
| Network policy and throwaway containers | Pinned setup script; allowlist |
| Intellectual property | Private repo, invite-only collaborators, site behind Cloudflare Access; never make the repo or site public while the assets are in it |
| Site reachable without login (for example through preview deployments) | The Access policy covers the production domain and preview deployments; checked in Phase 10 |

## 12. Ground rules (IP and repo hygiene)

- **The repo is private and stays private.** Collaborators are invite-only, and the site is only
  reachable through Cloudflare Access.
- **Commit:** code, docs and specs, `seeds.tsv`, extracted web-ready assets (sprites, compressed
  music, stage data), trace fixtures and reference frames.
- **Don't commit:** the disc image (over GitHub's 100 MB limit; it stays in private storage), or
  bulky raw dumps (RAM/VRAM dumps, save states) unless they're small and compressed.
- **IP.** "Tetris" is a trademark of The Tetris Company, and the game's art, music and levels belong
  to their rights holders. A private, invite-only repo and site keeps the risk low, but everyone
  with access gets copies of that content. Don't make either public while the assets are in the
  repo. The asset pipeline stays separate from the code, so an asset-free public version (players
  import their own disc) remains possible.

## 13. Sources

- REA: https://github.com/morluto/rea (README; `docs/ghidra-mips.md`, `docs/raw-binary.md`,
  `docs/ghidra-provider.md`, `docs/installation.md`, `docs/reconstruction-obligation-ledgers.md`;
  `src/ghidra/GhidraMipsProfile.ts`, `src/ghidra/GhidraLanguageCatalog.ts`)
- ghidra_psx_ldr: https://github.com/lab313ru/ghidra_psx_ldr ·
  PsyQ signatures: https://github.com/lab313ru/psx_psyq_signatures
- PCSX-Redux: https://github.com/grumpycoders/pcsx-redux
- psx-spx: https://github.com/psx-spx/psx-spx.github.io
- mkpsxiso / dumpsxiso: https://github.com/Lameguy64/mkpsxiso
- m2c: https://github.com/matt-kempster/m2c · splat: https://github.com/ethteck/splat ·
  maspsx: https://github.com/mkst/maspsx
- Wikipedia: https://en.wikipedia.org/wiki/Tetris_Plus
- TetrisWiki: https://tetris.wiki/Tetris_Plus · Hard Drop: https://harddrop.com/wiki/Tetris_Plus
- Tetris fandom wiki: https://tetris.fandom.com/wiki/Tetris_Plus
- Giant Bomb: https://www.giantbomb.com/tetris-plus/3030-17808/
- PSX Data Center: https://psxdatacenter.com/games/U/T/SLUS-00338.html ·
  https://psxdatacenter.com/games/J/T/SLPS-00466.html ·
  https://psxdatacenter.com/games/P/T/SLES-00442.html
- RetroAchievements: https://retroachievements.org/game/3145 ·
  https://retroachievements.org/forums/topic/11004
- Zophar's Domain: https://www.zophar.net/music/playstation-psf/tetris-plus
- Supercheats: https://www.supercheats.com/playstation/tetrisplus.htm
- TV Tropes: https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/TetrisPlus
- GameSpot review: https://www.gamespot.com/reviews/tetris-plus-review/1900-2534128/
