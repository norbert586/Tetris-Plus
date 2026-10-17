# Phase 5: oracle harness (2026-10-17)

The original game can now be driven by an input movie and traced, tick by tick, in a form the
TypeScript core (Phase 6) can be compared against. The exit criterion is met: **every movie in
the corpus gives identical traces, and identical RAM at its last tick, on repeated runs**
(§6): five movies, 34,298 ticks.

- **Movies are per logic tick, not per emulator frame.** Inside Puzzle Mode the harness doesn't
  press the emulated pad. It replaces `PadRead`'s return value at a breakpoint in `pad_read`, so
  the pad word the logic sees on tick *t* is exactly the movie's word for *t*. That's what the
  port's `step(state, pad)` will take.
- **The trace is the decoded game state after every tick:** 79 fields (screens, piece, queue,
  RNG seed, timers, ceiling, professor, flags), the board, and per tick the sounds started, the
  music requested and the number of `rand()` calls.
- **Runs are deterministic from power-on.** Each run gets a fresh emulator home (no memory card
  or settings carried over), and the boot route into Puzzle Mode is fixed.
- **Save states make iteration cheap.** A run can start from a state saved at any tick. The
  replay matches the full run tick for tick (§6), which the corpus planner relies on.
- **The corpus covers** the menus, password entry, both pause sub-menus, input edge cases,
  climbing, a 3-line clear, two stage clears, the ceiling's descent, crushing, losing, continuing,
  game over and quitting to the title (§5). Coverage gaps are listed in §7.
- **A side result:** the planner's piece simulation, written from `docs/spec/piece.md`, predicted
  the lock tick and position of every piece it checked against the original, 113 of them (§4).
  That's a first check of the piece spec ahead of Phase 6.

## 1. Files

| File | What it is |
|---|---|
| `re/lua/movie.lua` | The harness: boot route, input injection, tracer, save states (runs inside PCSX-Redux) |
| `re/lua/trace_fields.lua` | The traced fields: name, address, type |
| `scripts/run-movie.sh` | Plays one movie: `scripts/run-movie.sh MOVIE.tpm OUT_DIR` |
| `scripts/check-determinism.sh` | Plays a movie twice and compares traces and RAM; `SAVE_AT=T` also checks a save-state replay |
| `scripts/record-corpus.sh` | Checks every movie in `re/movies/` and stores its trace in `re/traces/` |
| `re/tools/tptrace.py` | Reads traces: `rows`, `diff` (first divergence with context), `events`, `board` |
| `re/tools/tpplan.py` | Builds movies that place pieces on purpose, in a closed loop with the emulator (§4) |
| `re/movies/*.tpm` | The movie corpus (§5) |
| `re/movies/plans/*.py` | The scenarios the planned movies were made from |
| `re/traces/*.jsonl.gz` | The trace corpus: one trace per movie, from the original |

Run output (traces, logs, RAM dumps, screenshots, save states) goes to the output directory,
under `../tp-private/runs/`. Save states are about 22 MB each and stay out of git.

## 2. Movies (`.tpm`, version 1)

A text file. `#` starts a comment.

```
tpm 1                # format version
boot puzzle          # boot route into Puzzle Mode (the only one so far)
end 5400             # last tick to run (the run also ends if Puzzle Mode exits)
100 4 CROSS          # TICK HOLD BUTTONS: hold Cross on ticks 100-103
+30 1 DOWN+RIGHT     # TICK may be relative to the previous line's tick
200 1 2:START        # 2: = pad 2
poke 400 0x800ee864 15   # write memory right after tick 400 is recorded (added in Phase 6)
```

- **Buttons:** `UP DOWN LEFT RIGHT CROSS CIRCLE SQUARE TRIANGLE L1 L2 R1 R2 START SELECT`, joined
  with `+`. Bits are libetc's `PadRead` layout (`docs/re/static-bootstrap.md` §3.1). Lines that
  overlap are ORed. Each line presses one pad.
- **Ticks.** Tick *t* is the global frame counter `state+0x40` minus its value when `pazle_main`
  starts. Tick 1 is the main loop's first iteration. The movie's word for tick *t* is what
  `pad_read` stores before tick *t*'s logic, so `held` = the word and `pressed` = the bits that
  weren't set on tick *t*−1. The first tick that can have input is 2.
- **Boot route `puzzle`.** Power-on with OpenBIOS fast boot. The emulated pad presses Start every
  90 frames from frame 300 to 3000 (Jaleco logo, startup screens, title), then Right at frame
  3400 and Cross at 3500 and 3700 (mode select: Puzzle). `pazle_main` starts at frame 4323, with
  the frame counter at 1001 and the BIOS seed at `0x4327D505`. From then on the emulated pad is
  released and only the movie drives the game.

- **Pokes** (`poke TICK ADDRESS VALUE [SIZE]`, size 1, 2 or 4, default 4; added in Phase 6) set
  up a scenario: the harness writes memory at the sample point of tick TICK, after its trace
  line, and the TypeScript core's replay does the same. Setting the professor's row
  (`0x800EE864`) to 15 makes him reach the goal at once, so stages can be cleared without
  playing them (`docs/re/core-port.md` §5).

`tpplan.py` writes movies in a canonical form: one line per run of identical pad words, ticks
absolute.

## 3. The tracer

**Where it samples.** One breakpoint at `0x80095668`, the instruction after `pad_read`'s
`jal PadRead`. When it fires on tick *t*, tick *t*'s logic and drawing are done and its pad read
hasn't been stored yet. The harness then:

1. records the trace line for tick *t*;
2. sets `v0` to the movie's word for *t* + 1 (pad 1 in the low half, pad 2 in the high half).

**What it records** (`re/lua/trace_fields.lua`; addresses in `re/symbols/PAZLE.vars.tsv`):

| Group | Fields |
|---|---|
| Frame | `ctr` (frame counter), `seed` (BIOS `rand` seed), `pad`/`padp` and `pad2`/`padp2` (held and pressed as the logic saw them), `phase`, `scr` and `step` for both players |
| Stage | `zone`, `stage`, `zones_cleared`, `hundred`, `score`, `stage_flags`, `lose_flags`, `clear_flags`, `clear_countdown`, `stage_time`, `stage_time_sub`, `intro_countdown`, `retire`, `best_times[100]`, `difficulty` |
| Piece | `piece`, `px`, `py`, `rot`, `next1`, `next2`, `input_dx`, `input_rot`, `gravity_dy`, `das_delay`, `das_repeat`, `gravity_count`, `has_dropped`, `lock_count`, `spawn_delay`, `pieces` |
| Lines | `lock_top_row`, `full_rows[5]`, `lines_found`, `clear_anim_state`, `clear_anim_frame`, `lines_this_clear`, `lines_cleared`, `lines_for_prof`, `popup_state` |
| Ceiling | `ceil_y`, `ceil_timer`, `ceil_drops`, `ceil_pushback`, `ceil_shake`, `ceil_state` |
| Professor | `prof_state`, `prof_sub`, `prof_col`, `prof_row`, `prof_facing`, `prof_action`, `prof_prev_action`, `prof_channel`, `prof_ch_action[4]`, `prof_ch_script[4]`, `prof_wait`, `prof_done`, `prof_sensors[10]`, `prof_turns`, `prof_lifted`, `prof_fall`, `prof_headroom`, `prof_danger`, `prof_hold`, `prof_fast`, `prof_sx`/`prof_sy` (sprite position) |
| Password | `pw_symbols[6]`, `pw_cursor` |
| Added by the harness | `board` (player 1, rows 0–15), `rand` (calls), `se` (sound IDs started), `bgm` (music IDs requested) |

All values are player 1's and raw: 16.16 positions stay 16.16 (`tptrace.py` shows pixels).
`prof_ch_script` holds RAM pointers into the script table, which are the same in the port only if
it keeps the original layout. (It does: Phase 6's core runs the scripts from the program's data
at their original addresses, and compares the pointers as they are.)

**Events per tick.** `rand`, `se` and `bgm` count the calls to `rand` (`0x800C0C48`), `se_play`
(`0x80095778`, argument = sound ID) and `bgm_request` (`0x80095DA8`, argument = music ID) between
two samples. That's tick *t*'s logic plus the end of tick *t*−1's main loop (`bgm_poll` and the
main loop's own `rand()`). So `rand` is normally 1 when nothing random happens.

**Board.** One string of 160 characters, rows 0–15: `.` empty, `1`–`9` the cell value, `#` the
row-0 wall (`0xFFFF`). Any other value stops the run with an error; none has appeared.

**Format.** JSON lines. The first line is a header (`tptrace`, movie name, boot route, field
list). Every other line has `t` and only the fields that changed since the previous line (all of
them on the first); `se` and `bgm` appear only on ticks that have events. `tptrace.py` rebuilds
full rows. A 6,000-tick trace is about 0.5 MB, 100 KB gzipped.

**Save states.** `TP_SAVE_AT=T` writes `state_T.sstate` and a side file with the counter base.
The state is taken at the next vblank, by which time tick *T*+1's logic has run, so it already
holds the input for *T*+1. A run with `TP_LOAD=state_T.sstate` starts there; its trace begins at
*T*+2, because tick *T*+1's events were partly counted before the save. `TP_UNTIL` ends a run at
the first tick where a condition on a trace field holds (`pieces>=5,scr!=5`), and
`TP_SAVE_UNTIL=1` saves a state there.

**Speed.** Redux paces emulation by its audio output, which holds it to real time (60 ticks a
second). The harness raises the SPU speed multiplier (`TP_SPEED`, default 32), which lets a run go
as fast as the CPU allows: about 90 ticks a second with the interpreter and debugger on. Emulated
timing doesn't change; a paced and an unpaced run of `input-edges` gave identical traces and RAM.
(`UseNullSync`, the obvious switch, hangs the emulator.) Booting to Puzzle Mode costs about 50
seconds, which a save state skips. Run at most three emulators at once on this 4-core machine.

**Other options.** `TP_SHOTS` (screenshots at ticks, convert with `re/tools/shot2png.py`),
`TP_RAM_AT` (RAM dumps), `TP_PADLOG` (logs any non-zero `PadRead` value; confirms the emulated pad
is idle in Puzzle Mode).

## 4. The planner (`re/tools/tpplan.py`)

Some corpus movies need pieces placed on purpose. They can't be planned ahead: every frame calls
`rand()`, and player 2's idle screen calls it too, so the third piece from now depends on when the
next one spawns. The planner works one piece at a time, in a loop with the emulator:

1. Start from a save state taken at the current piece's spawn.
2. Read the board, the piece and both previews from the trace.
3. Ask the scenario's chooser where the piece should go.
4. Turn that into inputs:
   - rotate on spawn+9 (and +11), right after the first drop;
   - tap Left or Right every other tick from spawn+12, once every cell is below row 0's wall;
   - hold Down (or let it fall at normal speed, with the taps from spawn+60).
5. Simulate the fall tick by tick with the rules of `docs/spec/piece.md` §4–§6 to predict the
   lock tick and position.
6. Run the emulator until the next spawn (or the end of play), saving a state there.
7. **Check that the original locked the piece on the predicted tick at the predicted position**,
   then go on with the next piece.

Choosers enumerate every placement the input pattern can reach and score them. A scenario file
(`re/movies/plans/`) holds the route, the chooser and the description; run it with
`python3 re/tools/tpplan.py re/movies/plans/NAME.py`. Each placement costs a few seconds of
emulation.

**Simulation against the original.** The simulation predicted every checked lock exactly (tick,
rotation, column, row): the 21 pieces of the corpus scenarios that locked before play ended,
including the scripted edge cases of `input-edges` (§5), and 92 more in an abandoned scenario that
tried to fill Egypt 1's bottom row (§5.1). The one mismatch was a piece stacked into the spawn
rows in that scenario, where the ceiling had crushed blocks the simulation doesn't model.

## 5. The corpus

All movies use the `puzzle` boot route. Tick numbers are the movie's.

| Movie | Ticks | What happens | Covers |
|---|---|---|---|
| `egypt1-idle` | 17,600 | Egypt 1 route (Cross every 120 ticks to 2980: menu, map, story, both rules panels), then no input. Pieces fall and lock untouched in columns 3–6; the ceiling drops 11 times and crushes them; the professor sleeps after 8 turns; danger music at 13963; crushed at 15583; the continue countdown runs out; game over; screen 7 skipped (no rank); save screen 13 | Ledger 1, 3–4, 6, 12–13, 19–20, 22–24, 29, 31–32, 36–37, 40 (countdown only); screens 0–7, 13 |
| `egypt1-climb` | 5,108 | Egypt 1: the first piece (S) dropped into the professor's pocket, into his cells. He climbs out on top of it, walks over the step and drops to row 15: goal at tick 3608, from one piece (the second, falling at normal speed toward column 7, never locks). Goal sequence, stage advance, stage 2 intro and play | 24–25, 27–28, 31, 33, 35, 38–39; screen 9 |
| `knossos2-lines` | 1,832 | Password 1 6 5 7 1 2 (Knossos stage 2, stage 62). Rows 13–15 are full except columns 0 and 9; a vertical I fills each; the second clears 3 lines (pushback −10 px). The professor falls to row 15: goal | Password entry and decode (41), 15–18, 21, 33, 39; a stage reached by password |
| `input-edges` | 4,368 | Egypt 1, nine pieces with scripted inputs: rotation before the first drop (ignored), Cross+Circle on one tick (Circle wins), Right held 40 ticks, Left+Right held together, move and rotate on one tick, taps into the wall, refused rotations at the wall, no input (full lock delay), Down from the spawn, every unused button, Down released after landing, Down tapped, holds with Circle taps | 2, 9–14 |
| `pause-retire` | 5,390 | Egypt 1: pause; Select opens the menu; show password and back; retire (Right on "no" first); the professor loses; Start continues (score +1) and the stage restarts; pause, quit, yes: Puzzle Mode exits to the title | 34, 40; screens 6, 12; the pause menu (§5.1) |
| `egypt20-zoneclear` | 4,000 | Added in Phase 6. Password to Egypt 20; goal by poke; zone clear: Egypt's scene, items, the map, Angkor Wat's story and first stage | 39, 42, 43; screen 10 |
| `atlantis20-ending` | 8,451 | Added in Phase 6. Password with four zones cleared to Atlantis 20; goal by poke; Atlantis's scene, the ending and credits, game over, name entry with a rank, the save screen, quit to `RANKING.EXE` | 42–45; screens 7, 10, 11, 13 |
| `hundred-select` | 6,731 | Added in Phase 6. 100-stage mode: the automatic pause and stage select, stage 13, the stage select cancelled, pokes to stage 100 and the goal, the end of the run, the ending, name entry, quit | 44–46; screens 9 (steps 4–6), 11, 12 (step 4) |

### 5.1 New facts from building the corpus

- **The pause menu is opened with Select.** `docs/spec/stages.md` §6 had it as a two-option menu
  on the pause screen. The pause screen (screen 12, step 0) only waits:
  - Start resumes.
  - Select opens a four-option menu (Up/Down, Cross picks, Circle goes back): 0 resume,
    1 show the password (any of Cross or Circle returns to the menu), 2 retire, 3 quit.
  - Retire and quit each ask yes/no with Left/Right, starting on "no". Retire = yes sets
    `retire = 1` and resumes. Quit = yes puts the player on screen 8, or, with the other
    player already on screen 8, exits Puzzle Mode to the title (program 3, phase 9).
  - **The hidden stage select:** Cross on the pause screen, in 100-stage mode (`zones_cleared ==
    0x1F`), goes to step 4, the stage select (`0x800B43E4`). This answers the ledger's open item.
    (Read in the code, `0x800AB198`; not yet played.)
- **The password menu option** is the third on the main menu: Down, Down, Cross. Symbol entry
  behaved as `docs/spec/password.md` §3 says.
- **Egypt 1's intended solution** is probably the climb: one piece dropped on the professor gets
  him out of his pocket and onto the floor. Filling row 15 instead is hard, since S and Z pieces
  can't touch the floor right of the step without leaving a hole.
- **Game over without a rank** goes from screen 7 straight to screen 13 on the next tick.

## 6. Determinism

`scripts/check-determinism.sh` plays a movie twice from power-on and compares the two traces field
by field and the 2 MB of main RAM at the last tick. `scripts/record-corpus.sh` ran it on all five
movies, three at a time, at the default speed (16 minutes in all):

| Movie | Ticks compared | Traces | RAM at the last tick |
|---|---|---|---|
| `egypt1-idle` | 17,600 | identical | identical |
| `egypt1-climb` | 5,108 | identical | identical |
| `knossos2-lines` | 1,832 | identical | identical |
| `input-edges` | 4,368 | identical | identical |
| `pause-retire` | 5,390 | identical | identical |

**Save-state replays.** With `SAVE_AT=900`, `knossos2-lines` saved a state at tick 900 and a third
run loaded it: its trace was identical to the full run's over ticks 902–1832, and so was main RAM
at the end, kernel area included. An earlier replay of the Egypt 1 route (saved at 3000, played to
6000) matched the same way except for one byte of OpenBIOS's kernel area (`0x80004AB8`, 0 → 1),
which isn't game state; the check compares RAM from `0x80010000` up and reports kernel-area bytes
separately. The planner (§4) replays save states hundreds of times, and its movies then ran from
power-on with the same outcomes: Egypt 1 cleared on tick 3608, Knossos 2's lines on 875 and its
goal on 932.

**Paced and unpaced runs agree.** `input-edges` at real-time pacing and with the raised speed
multiplier gave identical traces and RAM, so traces don't depend on host speed.

**Host hangs.** While four emulators ran at once (with real-time pacing), two of them stopped:
the process sat parked on a lock with no CPU use and never finished. This is the emulator host,
not the game: the same movies completed and matched on the next attempt. `run-movie.sh` now fails
after `TP_TIMEOUT` seconds (default 1800) instead of waiting, and the corpus recorder runs three at
a time; the final corpus run had no hangs.

**What keeps runs identical:**

- A fresh `HOME` per run, so Redux starts with new memory cards and default settings. (A card
  written by an earlier run could change what the game does.)
- Inputs inside Puzzle Mode don't depend on BIOS pad timing (§3).
- The boot route is fixed by emulator frame, and Puzzle Mode always starts at frame 4323 with the
  same counter and seed.

## 7. Not covered yet

| Gap | Why / where it goes |
|---|---|
| 1-, 2- and 4-line clears from real play | The corpus has a 3-line clear. Phase 3's `p3-lines2` forced a 4-line and a 1-line clear by poking RAM. Planned scenarios on stages with suitable rows (stage 6's four rows, or stacking on a later stage) can add them |
| ~~Hidden stage select~~ | Phase 6: `hundred-select` |
| ~~Zone clear (screen 10), ending (11), name entry with a rank (7)~~ | Phase 6: `egypt20-zoneclear`, `atlantis20-ending`, `hundred-select` (stages cleared by poke). The zone-clear scenes of Angkor Wat, Maya and Knossos remain for Phase 10's solver runs |
| Holding a button to speed up the goal/lost sequences (`prof_fast`) | One more movie on Egypt 1 |
| Player 2 joining | Off in the port until two-player mode (`docs/RESEARCH_AND_PLAN.md` §9) |
| Memory-card save on screen 13 | Each run gets a new card from Redux; saving hasn't been tried. Phase 9 |
| A piece locking in the spawn rows (no top-out, ledger 7) | In `egypt1-idle` the ceiling crushes the stack before it gets there; needs a stage with a high stack and a slow ceiling |
| Pixel and audio traces | Phases 7 and 8 add their own layers; screenshots by tick already work (`TP_SHOTS`) |

## 8. How Phase 6 uses this

(Done: `docs/re/core-port.md`.)

1. The port's core starts from the trace's first row of a stage (or from tick 1 once the menus are
   ported), with `ctr` and `seed` taken from the trace.
2. It steps once per tick with the movie's pad word.
3. `tptrace.py diff` (or its TypeScript twin) compares field by field and reports the first
   divergence with the ticks before it.
4. Fields the port doesn't model yet are passed with `--ignore`.
