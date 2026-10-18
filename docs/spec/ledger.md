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
- **Closed by (Phase 6):** the check that passed (`docs/re/core-port.md`): U = the named
  routine's Unicorn fixtures (`web/test/unicorn.test.ts`), T = golden-trace equality
  (`web/test/traces.test.ts`; "all" = every movie of the corpus). Every T and U verifier is
  closed. A closed in Phase 8 (below).
- **P (Phase 7):** closed for every row at once: every frame of the corpus, drawn by the port,
  equals the original's, GPU packets and pixels (`web/test/render.test.ts`,
  `docs/re/renderer.md` §5). Each mechanic that shows on screen is drawn the original's way
  wherever the corpus reaches it.
- **A (Phase 8):** closed for every row at once: every key-on (voice, volume, pitch, sample,
  envelope), key-off, mix and reverb register write, CD command and CD report of the corpus,
  made by the port, equals the original's (`web/test/traces.test.ts`, `docs/re/audio.md` §9;
  CD events within one tick, §6). Rows 20 and 29's sounds are among them (`egypt1-idle`).
- **Owner modules as built:** `core/frame` is `web/src/core/game.ts`; `core/input`, `core/piece`
  and `core/queue` are `play/piece.ts`; `core/lines` is `play/lines.ts`; `core/ceiling` is
  `play/ceiling.ts`; `core/professor` is `professor.ts`; `core/stages` is `play/stage.ts`;
  `core/flow` is `screens/*.ts` and `play/hud.ts`; `core/password` is `screens/password.ts`;
  `core/rng` is `rng.ts`.

## Gameplay core

| # | Mechanic | Spec | Evidence | Owner | Verifier | Closed by (Phase 6) |
|---|---|---|---|---|---|---|
| 1 | Frame order: P1 logic, P2 logic, draw, pad read, `rand()` | frame §1 | S `pazle_main`, `phase1_players`; E p2-screens (8,000 ticks / 8,000 frames) | `core/frame` | T | ✓ T all |
| 2 | Input one frame behind; pressed = rising edge | frame §1 | S `pad_read` | `core/input` | T | ✓ T all |
| 3 | Play step machine and its frame counts | frame §3 | S step functions; E p3-verify (3 / 22 frames) | `core/play` | T | ✓ T all |
| 4 | BIOS LCG and every call site in play | frame §4 | S `rand` stub; E p3-rand (79/79 previews) | `core/rng` | T | ✓ T all |
| 5 | Piece shapes and rotation grids | piece §1 | D `pieces.json` (`0x800D5544`) | `core/piece` | U (`piece_collides`) | ✓ U `piece_collides`, T |
| 6 | Spawn position, rotation, counters, +60 ceiling | piece §2 | S `play_spawn`; E p3-verify | `core/piece` | T | ✓ T all |
| 7 | No top-out; cells above row 0 dropped | piece §2, §6 | S `play_spawn`, `piece_lock` | `core/piece` | T (edge movie) | ✓ T (U `play_fall`: locks in the spawn rows) |
| 8 | Preview table and re-roll rule | piece §3 | S `queue_advance`; D `rules.json`; E p3-rand | `core/queue` | U, T | ✓ U `queue_advance`, T |
| 9 | Auto-repeat 20/4 (effective 24/5), shared Left/Right counters | piece §4 | S `piece_input`; E p3-verify | `core/input` | U, T | ✓ U `piece_input`, T `input-edges` |
| 10 | Rotation buttons from the settings masks; Circle wins | piece §4 | S `piece_input`; D `settings_default` | `core/input` | T | ✓ T `input-edges` |
| 11 | Move then rotate, each undone on collision; no kicks | piece §5 | S `play_fall` | `core/piece` | U, T | ✓ U `play_fall`, T `input-edges` |
| 12 | Gravity thresholds 8 / 50 / 3 (Down) | piece §5 | S `piece_gravity`; E p3-verify | `core/piece` | T | ✓ U `play_fall`, T |
| 13 | Lock after 10 blocked gravity steps | piece §5 | S `play_fall`; D `LEVELS[0].lock` | `core/piece` | T | ✓ U `play_fall`, T |
| 14 | Collision: walls and floor extend up, open above row 0 | piece §6 | S `piece_collides` | `core/piece` | U | ✓ U `piece_collides` |
| 15 | Full-row check: grid rows only, rows 1–15 | lines §1 | S `lines_find_full` | `core/lines` | U | ✓ U `lines_find_full` |
| 16 | Clear animation length tied to frame-counter parity | lines §2 | S `clear_anim_tick` | `core/lines` | T | ✓ T `knossos2-lines` |
| 17 | Row removal: grid compaction plus shift above | lines §4 | S `lines_collapse`, `lines_remove`; E p3-lines2 | `core/lines` | U, T | ✓ U `lines_remove`, T `knossos2-lines` |
| 18 | Score 100/400/800/1600, cap 9,999,999 | lines §5 | S `score_add_lines`; D `LEVELS`; E p3-lines2 | `core/lines` | T | ✓ U `score_add_lines`, T |
| 19 | Ceiling interval table × difficulty, timer +1/frame +60/piece | ceiling §2 | S `ceiling_tick`; D `rules.json`; E p3-verify (drops at 8882, 10182, 11371) | `core/ceiling` | T | ✓ U `ceiling_tick`, T `egypt1-idle`, A `egypt1-idle` |
| 20 | Ceiling shake window and warning sound | ceiling §2 | S `ceiling_tick` | `core/ceiling` | T, A | ✓ U `ceiling_tick`, T `egypt1-idle`, A `egypt1-idle` |
| 21 | Pushback 0/0/−10/−20 px, top limit 10 px | ceiling §3 | S `play_collapse`, `ceiling_tick`; D; E p3-lines2 | `core/ceiling` | T | ✓ U `ceiling_tick`, T `knossos2-lines` |
| 22 | Crushing rows 1 to ceiling row + 1, and row 0's opening | ceiling §4 | S `ceiling_crush` | `core/ceiling` | U, T | ✓ U `ceiling_crush`, T `egypt1-idle` |
| 23 | Debris slots gate `rand()`; 65-frame lifetime | ceiling §4.1 | S `ceiling_crush`, `0x800AF07C`, debris states | `core/ceiling` | T | ✓ U `ceiling_crush`, `debris_update`, T `egypt1-idle` |
| 24 | Professor states 0–5 and the intro | professor §1 | S `prof_dispatch` states; E p3-verify, p4-stage87 | `core/professor` | T | ✓ T all |
| 25 | Animation channels and the script interpreter | professor §2 | S `prof_set_action`, `0x800A07F4`, opcodes; D `professor.json`; E p4-stage87 | `core/professor` | U, T | ✓ U `prof_anim_tick`, T |
| 26 | Button speeds up goal/lost sequences | professor §2.3 | S `0x800A164C`, opcode 2 | `core/professor` | T | ✓ T (the goal sequences) |
| 27 | Sensors and off-board = −1 | professor §3 | S `prof_sense`; D sensors | `core/professor` | U | ✓ U `prof_sense` |
| 28 | Fall distance | professor §3 | S `prof_fall_distance`; E p4-stage87 (6-row drop) | `core/professor` | U | ✓ U `prof_fall_distance` |
| 29 | Danger (headroom < 5) and its music | professor §4 | S `prof_think` | `core/professor` | T, A | ✓ U `prof_think`, T `egypt1-idle`, A `egypt1-idle` |
| 30 | Shift with line clears while climbing | professor §5.1 | S `prof_think` | `core/professor` | T | ✓ U `prof_think` |
| 31 | Decision chain (25 rows) | professor §5.2 | S `prof_think`; E p3-verify (turns, sleep, wake), p4-stage87 (climb, walk, startle, long fall, land, turn) | `core/professor` | U, T | ✓ U `prof_think`, T |
| 32 | Crushed (headroom < 3) before goal | professor §6 | S `prof_check_crushed`, `prof_walk` | `core/professor` | T | ✓ T `egypt1-idle` |
| 33 | Goal = row 15, not lifted | professor §6 | S `prof_check_goal`; E p3-lines2 | `core/professor` | T | ✓ T `egypt1-climb`, `knossos2-lines` |
| 34 | Retire from pause | professor §6.3 | S `prof_walk`, pause step | `core/professor` | T | ✓ T `pause-retire` |

## Stages and flow

| # | Mechanic | Spec | Evidence | Owner | Verifier | Closed by (Phase 6) |
|---|---|---|---|---|---|---|
| 35 | 100 stage records and layouts | stages §1 | D `stages.json`; E p3-verify (Egypt 1 board), p4-stage87 (stage 87 start cell, ladder) | `core/stages` | T (all 100, Phase 10) | ✓ T (stages 1, 2, 13, 20, 21, 62, 100); all 100 in Phase 10 |
| 36 | Stage intro order; queue filled before play | stages §2 | S intro steps `0x800A2150`–`0x800A2EA0`; E p3-verify, p4-stage87 | `core/flow` | T | ✓ T all |
| 37 | Slow stage clock (7 frames per tenth), cap 999.9 | stages §4 | S `stage_timer_tick`; E p3-lines2 | `core/flow` | T | ✓ U `stage_timer_tick`, T |
| 38 | Best time per stage | stages §4 | S goal sequence; E p3-lines2 (88.0) | `core/flow` | T | ✓ T `egypt1-climb`, `atlantis20-ending` |
| 39 | Stage and zone advance, zone-clear bits, 100-stage mode | stages §5 | S `stage_number_advance`, `0x800A9C2C`, `0x800AA004`, `0x800A8880`; E p3-lines2 (stage 0 → 1) | `core/flow` | T | ✓ T `egypt1-climb`, scenario movies |
| 40 | Continue: countdown, score + 1 per continue, unlimited | stages §6 | S `0x800A3A74`, `0x800A3BD0`; E p2-screens (CONTINUE? seen) | `core/flow` | T | ✓ T `egypt1-idle`, `pause-retire` |
| 41 | Password codec | password | S encoder/decoder; `tp_password.py selftest` | `core/password` | U | ✓ U `password_decode`, `password_encode`, T `knossos2-lines`, scenario movies |
| 42 | Stage-clear bonuses: time bonus, piece bonus and items | lines §5 | S `0x80099128`, `0x8009E858`, `0x8009ECC8` | `core/flow` | T | ✓ T `egypt1-climb`, scenario movies |
| 43 | Zone clear: mark, scene, items, next zone or Atlantis | stages §5 | S `0x800A9C2C`-`0x800AA004`, scenes `0x800BDFE4` | `core/flow` | T | ✓ T `egypt20-zoneclear`, `atlantis20-ending` |
| 44 | Ending and credits; 100-stage mode unlocked | core-port §5 | S screen 11 `0x800AA1C8`, `0x800AAEA8`, text box `0x800BFF24` | `core/flow` | T | ✓ T `atlantis20-ending`, `hundred-select` |
| 45 | Name entry and the ranking table | core-port §5 | S screen 7 `0x800A483C`-`0x800A5504` | `core/flow` | T | ✓ T `atlantis20-ending`, `hundred-select` |
| 46 | Hidden stage select; 100-stage mode's automatic pause | stages §6 | S `0x800B43E4` states, `pause_check` | `core/flow` | T | ✓ T `hundred-select` |
| 47 | Player 2's idle screen and its `rand()` calls | frame §4 | S screen 8 `0x800A5928` | `core/flow` | T | ✓ T all |

## Open items (carried to later phases)

| Item | Where it goes |
|---|---|
| Which program changes `difficulty` and the rotation buttons (options screen); Puzzle Mode only reads them | Phase 9 (shell), from `TITLE.EXE` or `SELECT.EXE` |
| ~~Goal sequence substates 1–15 and screen 9's remaining steps~~ Ported and traced in Phase 6 (rows 42, 38–39); drawn in Phase 7 | |
| ~~Screens 7 (name entry), 10, 11 (ending), 13 (save) in detail~~ Ported and traced in Phase 6 (rows 43–45), except the memory card (screen 13's save options, the menu's Continue) | Phase 9: browser storage instead of the card |
| ~~How the pause menu reaches the hidden stage select~~ Answered in Phase 5; played and traced in Phase 6 (row 46) | |
| ~~Short-fall landing, sleep/wake and "trapped" timings~~ Checked in Phase 6: the corpus traces and `prof_think`'s Unicorn cases (rows 25, 31) | |
| Zone-clear scenes of Angkor Wat, Maya and Knossos: ported, not yet traced | Phase 10 (solver runs) |
| Player 2 joining a game in progress (two-player Puzzle Mode) | Off until two-player mode (`docs/RESEARCH_AND_PLAN.md` §9) |
| ~~Art items in stage records `+0x20`/`+0x24`: which is the background~~ Answered in Phase 7: `+0x20` the 112×160 well background, `+0x24` a 112×56 strip; the zone backdrop comes from `FUN_800B0FAC` (`docs/re/renderer.md` §3.6) | |
