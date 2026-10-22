# The whole game (Phase 9): programs, flow and verification

Phase 9 runs the whole game from power-on, not just Puzzle Mode. The browser's shell is described
in `docs/re/shell.md`. The program ports are documented in `docs/re/sw_on.md`, `title.md`
(TIT_DEMO and TITLE), `select.md`, `ranking.md` and `memcard.md`. Sound across programs is in
`docs/re/audio.md` §11.

## 1. How the original chains programs

`SLUS_003.38` is the boot program (`docs/re/static-bootstrap.md` §5). It loads one mode program at
`0x80094000` and runs it until the program sets the exit flag (`state+0x1FCF4`). It then loads
the program named in `state+0x48`, with param `+0x4C`, phase `+0x50` and subphase `+0x54`.
Between programs, `boot_settle` clears both players' screen, step and substep words
(`state+0x4B508..0x4B537`).

All programs share:
- the state block (`state = 0x8003E668`): the frame counter `+0x40` (the trace's tick; only
  mode programs' main loops count it), settings, records and rankings, and the CD's TOC;
- the sprite-object table at `+0x5C`;
- the BIOS `rand()`.

| # | Program | Role | Port |
|---|---|---|---|
| 0 | JLOGO | Jaleco logo (MDEC video) | Video in the shell (`shell.md`) |
| 1 | SW_ON | Copyright and memory-card check | `web/src/programs/sw_on/` |
| 2 | TIT_DEMO | Story intro | `web/src/programs/tit_demo/` |
| 3 | TITLE | Title, PRESS START, the menu | `web/src/programs/title/` |
| 4, 5, 6 | HOW_N, HOW_P, HOW_VS | Attract demos (Classic, Puzzle, VS) | Stand-ins (§3) |
| 7 | RANKING | Classic and Puzzle rankings | `web/src/programs/ranking/` |
| 8 | SELECT | Mode select and Option mode | `web/src/programs/select/` |
| 9, 11, 12 | NOMAL, VSPUZ, EDIT | Classic, VS, Edit | Out of scope; SELECT refuses them (§4) |
| 10 | PAZLE | Puzzle Mode | `web/src/core/` (Phases 6-8) |

**The flow with no input.** SW_ON (ticks 1-370), TIT_DEMO, TITLE, then:
- the first timeout runs HOW_N, then HOW_P, then RANKING, then back to TIT_DEMO;
- the next timeout runs HOW_VS, then RANKING;
- TITLE alternates between the two on bit 0 of `state+0x4B540`, so a full cycle is 19,200
  ticks (`title.md` §4).

**With input:**
- START in TIT_DEMO or a demo goes to TITLE with PRESS START showing (phase 9).
- START there goes to SELECT. Puzzle there starts PAZLE.
- When both players are on screen 8, PAZLE names RANKING, as it does after the 100-stage
  ending.
- Start + Select held for more than 120 ticks soft-resets to TITLE from any program that
  checks it.

## 2. The port

- `web/src/flow/console.ts` (`Console`) holds one `Mem` and one `Rng` and runs the current
  program's `step(pad)`. When a program exits, the console starts the one it named, with the
  screen words cleared as `boot_settle` does.
- Power-on state: the state block as the boot program leaves it before SW_ON
  (`web/src/flow/power-state.ts`, from a RAM dump at SW_ON's main by
  `re/tools/extract_power_state.py`).
- Each port (`web/src/flow/program.ts`, `Program`) keeps its state at the original's addresses
  and loads its own data and BSS. It reports the same presentation outputs as Puzzle Mode's core:
  image uploads, sound calls and its own renderer (`ProgramModule`, `web/src/flow/registry.ts`).
- Loading is not reproduced: the next program starts on the next tick (as decided,
  `RESEARCH_AND_PLAN.md` §6). The original's loading frames call `rand()` in the boot program, so
  live play draws different random numbers than the console after the first program change.
  Replays inject each program's `mainseed` from the trace, which makes them exact.
- First row: on its first traced tick, each port counts the previous program's last `rand()`,
  made after the tracer's last sample of it and already included in the seed main finds.
- Memory card: `web/src/flow/memcard.ts`, at the BIOS file level, with the original's per-call
  waits. In the browser, slot 1 is stored in `localStorage`; slot 2 is empty (`memcard.md`).

## 3. Deviations

| What | Why | Where |
|---|---|---|
| HOW_N, HOW_P and HOW_VS don't run. Each stand-in advances the frame counter by the demo's length (2,426, 4,409 and 2,980 ticks), leaves its numbers in `state+0x18/+0x20/+0x24` (HOW_VS also sets `+0x4B53C`) and names the demo's next program, so the attract loop goes straight from the title's timeout to the ranking screen | The demos belong to out-of-scope modes; HOW_P could be ported later | `web/src/flow/stand-ins.ts` |
| SELECT doesn't start Classic, VS or Edit: Cross on their confirmation does nothing, with no sound (SELECT has no error sound). In the browser their tiles are hidden: Puzzle and Option are shown side by side, centred | Decided 2026-10-22: hide what can't be played | `Select.modeAvailable`, `Shared.playableModesOnly`, `select.md` §7 |
| JLOGO plays as a video | It is an MDEC stream; the decoded frames and audio are the same | `shell.md` |
| No loading pauses; the old music stops at the program change instead of during the load | As decided | `audio.md` §11 |
| Player 2's side of Puzzle Mode is hidden; pad 2 is released | Decided 2026-10-17 | Phase 7 |

## 4. Verification

Every program is verified the same way as Puzzle Mode: the port replays an input movie and must
match the original's trace on every tick. That covers the fields, the `rand()` count, image
uploads, sound calls, the program running and the program named next. The `ot` and `fb` hashes
of every frame must match too, and so must the sound fields (`audio.md` §11).

Movies run from power-on (`boot power`, trace v4, `docs/re/oracle-harness.md`). Each program's
tests also run its program from its own first tick, using the RAM state the original's program
found.

| Test | Movies | Covers |
|---|---|---|
| `test/sw_on.test.ts` | `power/sw_on-*` (6) | Every card state at power-on |
| `test/title.test.ts` | `attract-cycle`, `title-*` | TIT_DEMO, TITLE, the attract loop, every way out |
| `test/select.test.ts` | `power/select-{tour,card,format}` | Every mode-select path and Option row, every card screen, the refused modes; the card left behind is byte-identical to the emulator's |
| `test/ranking.test.ts` | `attract-cycle`, `ranking-records` | Both attract entries, PAZLE's exit, edge-case records, soft reset |
| `test/memcard.test.ts`, `traces.test.ts` | `card-{save,full,continue}` | Puzzle Mode's save screen and Continue; cards byte-identical |
| `test/game-audio.test.ts` | the power movies | Sound and CD events across program changes |
| **`test/full-run.test.ts`** | **`power/full-run`** | **A complete run: power-on → SW_ON → TIT_DEMO → TITLE → SELECT → Puzzle Mode (password, hidden stage select, a stage, the end of the 100-stage run, credits, name entry) → RANKING → TIT_DEMO. Identical on all 10,277 ticks and frames.** |

Two recordings of the 26,000-tick attract movie made by different agents were identical, which
confirms that power-on runs are deterministic.
