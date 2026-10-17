# Mechanics ledger

Every gameplay mechanic is an obligation: it has evidence (where the behaviour was read or
seen), the module that will own it in the port, and the verifier that will close it
(`docs/RESEARCH_AND_PLAN.md` §8). Phase 4's exit criterion is that **every row has evidence**.
Verifiers run from Phase 5–6 on; until then every row is "open". Phase 5's trace corpus
(`re/traces/`, `docs/re/oracle-harness.md` §5) lists which movie exercises each row; the T
verifiers close against it in Phase 6.

- **Evidence:** S = decompiled code (function), D = table extracted to `docs/spec/data/`,
  E = measured in the emulator (run name).
- **Owner:** module under `web/src/core/` (Phase 6).
- **Verifier:** U = Unicorn function test against the original routine, T = golden-trace
  equality (Phase 5 corpus), P = pixel comparison, A = audio-event trace.

## Gameplay core

| # | Mechanic | Spec | Evidence | Owner | Verifier |
|---|---|---|---|---|---|
| 1 | Frame order: P1 logic, P2 logic, draw, pad read, `rand()` | frame §1 | S `pazle_main`, `phase1_players`; E p2-screens (8,000 ticks / 8,000 frames) | `core/frame` | T |
| 2 | Input one frame behind; pressed = rising edge | frame §1 | S `pad_read` | `core/input` | T |
| 3 | Play step machine and its frame counts | frame §3 | S step functions; E p3-verify (3 / 22 frames) | `core/play` | T |
| 4 | BIOS LCG and every call site in play | frame §4 | S `rand` stub; E p3-rand (79/79 previews) | `core/rng` | T |
| 5 | Piece shapes and rotation grids | piece §1 | D `pieces.json` (`0x800D5544`) | `core/piece` | U (`piece_collides`) |
| 6 | Spawn position, rotation, counters, +60 ceiling | piece §2 | S `play_spawn`; E p3-verify | `core/piece` | T |
| 7 | No top-out; cells above row 0 dropped | piece §2, §6 | S `play_spawn`, `piece_lock` | `core/piece` | T (edge movie) |
| 8 | Preview table and re-roll rule | piece §3 | S `queue_advance`; D `rules.json`; E p3-rand | `core/queue` | U, T |
| 9 | Auto-repeat 20/4 (effective 24/5), shared Left/Right counters | piece §4 | S `piece_input`; E p3-verify | `core/input` | U, T |
| 10 | Rotation buttons from the settings masks; Circle wins | piece §4 | S `piece_input`; D `settings_default` | `core/input` | T |
| 11 | Move then rotate, each undone on collision; no kicks | piece §5 | S `play_fall` | `core/piece` | U, T |
| 12 | Gravity thresholds 8 / 50 / 3 (Down) | piece §5 | S `piece_gravity`; E p3-verify | `core/piece` | T |
| 13 | Lock after 10 blocked gravity steps | piece §5 | S `play_fall`; D `LEVELS[0].lock` | `core/piece` | T |
| 14 | Collision: walls and floor extend up, open above row 0 | piece §6 | S `piece_collides` | `core/piece` | U |
| 15 | Full-row check: grid rows only, rows 1–15 | lines §1 | S `lines_find_full` | `core/lines` | U |
| 16 | Clear animation length tied to frame-counter parity | lines §2 | S `clear_anim_tick` | `core/lines` | T |
| 17 | Row removal: grid compaction plus shift above | lines §4 | S `lines_collapse`, `lines_remove`; E p3-lines2 | `core/lines` | U, T |
| 18 | Score 100/400/800/1600, cap 9,999,999 | lines §5 | S `score_add_lines`; D `LEVELS`; E p3-lines2 | `core/lines` | T |
| 19 | Ceiling interval table × difficulty, timer +1/frame +60/piece | ceiling §2 | S `ceiling_tick`; D `rules.json`; E p3-verify (drops at 8882, 10182, 11371) | `core/ceiling` | T |
| 20 | Ceiling shake window and warning sound | ceiling §2 | S `ceiling_tick` | `core/ceiling` | T, A |
| 21 | Pushback 0/0/−10/−20 px, top limit 10 px | ceiling §3 | S `play_collapse`, `ceiling_tick`; D; E p3-lines2 | `core/ceiling` | T |
| 22 | Crushing rows 1 to ceiling row + 1, and row 0's opening | ceiling §4 | S `ceiling_crush` | `core/ceiling` | U, T |
| 23 | Debris slots gate `rand()`; 65-frame lifetime | ceiling §4.1 | S `ceiling_crush`, `0x800AF07C`, debris states | `core/ceiling` | T |
| 24 | Professor states 0–5 and the intro | professor §1 | S `prof_dispatch` states; E p3-verify, p4-stage87 | `core/professor` | T |
| 25 | Animation channels and the script interpreter | professor §2 | S `prof_set_action`, `0x800A07F4`, opcodes; D `professor.json`; E p4-stage87 | `core/professor` | U, T |
| 26 | Button speeds up goal/lost sequences | professor §2.3 | S `0x800A164C`, opcode 2 | `core/professor` | T |
| 27 | Sensors and off-board = −1 | professor §3 | S `prof_sense`; D sensors | `core/professor` | U |
| 28 | Fall distance | professor §3 | S `prof_fall_distance`; E p4-stage87 (6-row drop) | `core/professor` | U |
| 29 | Danger (headroom < 5) and its music | professor §4 | S `prof_think` | `core/professor` | T, A |
| 30 | Shift with line clears while climbing | professor §5.1 | S `prof_think` | `core/professor` | T |
| 31 | Decision chain (25 rows) | professor §5.2 | S `prof_think`; E p3-verify (turns, sleep, wake), p4-stage87 (climb, walk, startle, long fall, land, turn) | `core/professor` | U, T |
| 32 | Crushed (headroom < 3) before goal | professor §6 | S `prof_check_crushed`, `prof_walk` | `core/professor` | T |
| 33 | Goal = row 15, not lifted | professor §6 | S `prof_check_goal`; E p3-lines2 | `core/professor` | T |
| 34 | Retire from pause | professor §6.3 | S `prof_walk`, pause step | `core/professor` | T |

## Stages and flow

| # | Mechanic | Spec | Evidence | Owner | Verifier |
|---|---|---|---|---|---|
| 35 | 100 stage records and layouts | stages §1 | D `stages.json`; E p3-verify (Egypt 1 board), p4-stage87 (stage 87 start cell, ladder) | `core/stages` | T (all 100, Phase 10) |
| 36 | Stage intro order; queue filled before play | stages §2 | S intro steps `0x800A2150`–`0x800A2EA0`; E p3-verify, p4-stage87 | `core/flow` | T |
| 37 | Slow stage clock (7 frames per tenth), cap 999.9 | stages §4 | S `stage_timer_tick`; E p3-lines2 | `core/flow` | T |
| 38 | Best time per stage | stages §4 | S goal sequence; E p3-lines2 (88.0) | `core/flow` | T |
| 39 | Stage and zone advance, zone-clear bits, 100-stage mode | stages §5 | S `stage_number_advance`, `0x800A9C2C`, `0x800AA004`, `0x800A8880`; E p3-lines2 (stage 0 → 1) | `core/flow` | T |
| 40 | Continue: countdown, score + 1 per continue, unlimited | stages §6 | S `0x800A3A74`, `0x800A3BD0`; E p2-screens (CONTINUE? seen) | `core/flow` | T |
| 41 | Password codec | password | S encoder/decoder; `tp_password.py selftest` | `core/password` | U |

## Open items (carried to later phases)

| Item | Where it goes |
|---|---|
| Which program changes `difficulty` and the rotation buttons (options screen); Puzzle Mode only reads them | Phase 9 (shell), from `TITLE.EXE` or `SELECT.EXE` |
| Goal sequence substates 1–15 and screen 9's remaining steps (presentation, best-time display) | Phase 5 corpus, Phase 7 |
| Screens 7 (name entry), 10, 11 (ending), 13 (save) in detail | Phase 9; the Phase 5 corpus reaches 7 (no rank: straight to 13) and 13 only |
| ~~How the pause menu reaches the hidden stage select~~ Answered in Phase 5: Cross on the pause screen in 100-stage mode ([stages.md](stages.md) §6); not yet played | Phase 9 |
| Short-fall landing, sleep/wake and "trapped" timings measured in the emulator (read in code, partly seen in Phase 3) | Phase 5 corpus records them (`egypt1-idle`: sleep; `egypt1-climb`: climb, walk off, fall, land); Phase 6 checks them |
| Player 2 joining a game in progress (two-player Puzzle Mode) | Off until two-player mode (`docs/RESEARCH_AND_PLAN.md` §9) |
| Art items in stage records `+0x20`/`+0x24`: which is the background | Phase 7 |
