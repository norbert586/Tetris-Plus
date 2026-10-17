# Phase 3: dynamic RAM map (2026-10-17)

Every gameplay variable now has an address, a type and the code that writes it: board, falling
piece, preview queue, randomness, timers, professor, ceiling, score and the stage state machine.
The exit criterion is met. The machine-readable list is `re/symbols/PAZLE.vars.tsv` (69 entries);
this page explains it and records the mechanics each variable revealed.

- **Method.** The static pass read the gameplay screen's call tree in the decompiled code and
  listed every global it writes (`re/tools/global_xrefs.py`). The emulator then confirmed each
  one with write watchpoints, which log the writing PC, and value watches. Every writer found
  statically was hit in the emulator, and the emulator found the ones the static pass can't
  see: writes through pointers (the score) and the stage loaders.
- **The board is `int[21][10]` per player** at `0x800EDCA0`. Positions are 16.16 fixed-point
  pixels, and a cell is 10 px. The playable well is 10 × 16 (rows 0–15). Rows 16–20 are never
  used.
- **Pieces come from a weighted table, not uniformly.** I and J come up 3/16 of the time, the
  others 2/16. Re-rolls stop the new piece matching the next or the current one. A replay from
  the BIOS seed predicted all 79 previews in a test run.
- **The RNG is shared with player 2's idle screen.** Player 2's "PRESS START" animation calls
  `rand()` now and then, so the piece sequence depends on it. The port has to keep those calls.
- **Several timings differ from the obvious reading** and were confirmed in the emulator:
  - Auto-repeat is 24 frames then 5, although the counters are 20 and 4.
  - The stage clock adds a tenth of a second every 7 frames, so it runs about 14% slow. Best
    times are stored from that slow clock.
  - Each new piece adds 60 frames to the ceiling's timer.
- **The professor's moves are animation scripts.** A script opcode moves him a cell at a time.
  His decisions read 10 board cells around him.

Runs (all from Phase 0's route into Egypt stage 1, play from frame 7642):

| Run | Inputs | Used for |
|---|---|---|
| `p3-verify` | Left, Cross, Circle, Right held 40 frames, Down held 200 frames, then nothing to frame 13000 | Piece, input, preview and ceiling variables; 18 write watchpoints |
| `p3-lines2` | `re/lua/p3_lines.lua` sets up a 4-line clear, then a 1-line clear under the professor | Score, line count, pushback, professor drop, stage clear, best time, next stage |
| `p3-rand` | Down held 2,400 frames | Every `rand()` call with its caller and seed; preview prediction |

## 1. Conventions

- **Per player.** Almost every gameplay variable is an array indexed by the current player
  (`0x800EEAD0`, 0 or 1), 4 bytes per player. The table gives player 1's address; player 2's is
  4 bytes later, unless a stride is given.
- **Positions.** 16.16 fixed point, in pixels from the playfield's top-left. A cell is 10 px,
  so a position's cell is `(value >> 16) / 10`.
- **`state`.** The boot program's shared block at `0x8003E668` (Phase 2 §1).
- **Evidence.** S = decompiled code. E = seen in the emulator. Function names are in
  `re/symbols/PAZLE.game.tsv` (53 added in this phase).

## 2. The play step machine

Screen 5 (`scr05_play`) runs one step function per frame (`play_step_dispatch` on
`state+0x4B510`), then eight updaters. Steps for each piece:

| Step | Function | What it does |
|---|---|---|
| 0 | `play_spawn` | Counts `spawn_delay` down (always 0 here), then: piece = `next1`, position = preview position + 20 px down, rotation 0, ceiling timer +60, new preview (`queue_advance`), `pieces_spawned` +1 |
| 1 | `play_fall` | Movement and rotation (only once the piece has fallen a row), gravity, then lock (below) |
| 2 | `play_line_check` | No full rows: step 5. Otherwise counts them, plays sound `0x2B + n` and starts the clear animation |
| 3 | `play_clear_anim` | 8 animation steps, one every other frame |
| 4 | `play_collapse` | Removes the rows, adds the score, sets the ceiling pushback, sound `0x0D` |
| 5 | `play_next` | Back to step 0 |

Measured: a piece appears **3 frames after the previous one locks** (steps 2, 5, 0), or 22 frames when
lines clear (E: lock at 10960, next piece at 10982).

After the step, `scr05_play` calls in order: `piece_flash_draw`, `lines_popup_dispatch`,
`prof_dispatch`, `ceiling_dispatch`, `ceiling_crush`, `debris_update`, and `0x800B58E8`. Then it
checks the stage flags: `stage_flags & 4` → screen 9 (clear), `lose_flags & 2` → screen 6
(continue).

## 3. Board and stage

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EDCA0` | `s32[2][21][10]` | `board` | `piece_lock`, `lines_*`, `ceiling_crush`, `board_reset`, `board_clear_rows`, `stage_load_layout` | Index `row*10 + col`, player stride `0x348`. 0 empty, 1–7 piece kind (its colour), stage blocks their own value (5 on Egypt 1). Row 0 holds `0xFFFF` in columns 0–2 and 7–9: walls either side of the four spawn columns |
| `0x800EEBB0` | `s32[2]` | `zone` | menu and map screens | 0 = Egypt |
| `0x800EEB04` | `s32[2]` | `stage` | `stage_number_advance`, menu, map, password | 0–19 within the zone. E: 0 → 1 after the clear |
| `0x800F35C8` | `s32[2]` | `zones_cleared` | zone-clear step | Bit mask. After a zone's 20th stage: zone-clear screen unless all five bits are set. (Phase 4: an s32 per player, not u8; `docs/spec/stages.md` §5) |
| `0x800EE394` | `s32[2]` | `level` | menu screens | Always 0 in Puzzle Mode (§4) |

**Stage data, found while tracing the loaders (Phase 4 extracts it):**

- `0x800D780C`: `int[zone*20 + stage]` → stage record index.
- `0x800D79EC`: stage records, `0x28` bytes. Offsets seen so far:
  - `+0x00` professor column as 16.16 (column in the s16 at `+0x02`)
  - `+0x04` professor row as 16.16 (row in the s16 at `+0x06`)
  - `+0x08` facing
  - `+0x10` layout index
  - `+0x20`, `+0x24` unknown (285, 38 for Egypt 1)
- `0x800D898C`: layouts, 150 bytes each (rows 1–15 × 10 columns, one byte per cell).
  `stage_load_layout` copies one into the board at row 1. Egypt 1's layout matches the board
  read from RAM exactly.

## 4. Falling piece

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE384` | `s32[2]` | `piece_kind` | `play_spawn`, `play_fall` | 0 none, 1 I, 2 O, 3 T, 4 J, 5 L, 6 Z, 7 S |
| `0x800EE3C8` | fx | `piece_x` | `play_spawn`, `play_fall` | Left edge of the 5×5 grid. Spawn 30 px (column 3) |
| `0x800EE3D8` | fx | `piece_y` | `play_spawn`, `play_fall` | Top edge of the grid. Spawn −20 px (row −2) |
| `0x800F35DC` | `s32[2]` | `piece_rot` | `play_spawn`, `play_fall` | 0–3 |
| `0x800EE374` | fx | `input_dx` | `piece_input` | ±10 px or 0 this frame |
| `0x800EDC98` | `s32[2]` | `input_rot` | `piece_input` | −1 (Cross), +1 (Circle), 0 |
| `0x800EE37C` | fx | `gravity_dy` | `piece_input`, `piece_gravity` | 10 px when gravity fires |
| `0x800EE478` | `s32[2]` | `das_delay` | `piece_input` | 20 on a new press |
| `0x800EE418` | `s32[2]` | `das_repeat` | `piece_input` | 4 after each move |
| `0x800F2CEC` | `s32[2]` | `gravity_count` | `play_spawn`, `play_fall`, `piece_gravity` | Frames since the last drop |
| `0x800EE3F0` | `s32[2]` | `piece_has_dropped` | `play_spawn`, `play_fall` | Gates movement and rotation |
| `0x800F3644` | `s32[2]` | `lock_count` | `play_spawn`, `play_fall` | Frames spent resting |
| `0x800F364C` | `s32[2]` | `spawn_delay` | `intro_setup` | Stays 0 |
| `0x800F2AD0` | `s32[2]` | `pieces_spawned` | `play_spawn` | |

**Mechanics:**

- **Shapes.** 5×5 int grids at `0x800D5544 + kind*400 + rot*100`. T, J and L spawn flat side
  up. Kind 0 is empty.
- **One frame of `play_fall`:**
  1. If the piece has dropped once: move by `input_dx` (undone on collision), then rotate
     (`rot -= input_rot`, undone on collision; sound `0x0E` when it turns).
  2. Gravity: the counter rises every frame. The threshold is **8 frames until the first drop,
     then 50, or 3 while Down is held**.
  3. When gravity fires, move down 10 px. If that collides, undo it and add 1 to `lock_count`.
     At 10 the piece locks (sound `0x0C`). A successful drop resets both counters.

  There are no wall kicks. Collision tests the grid against the board, and against the edges of
  a 10 × 16 well. Cells above row 0 are free.
- **Level table.** `0x800D61C4`: 31 entries of `{gravity, lock, score for 1, 2, 3, 4 lines}`.
  Puzzle Mode only uses entry 0 = `{50, 10, 100, 400, 800, 1600}`. Gravity 50 is also written
  into `piece_gravity` as a constant. The other entries are presumably Classic mode's.
- **Auto-repeat.** A new press moves at once and sets the counters to 20 and 4. Holding counts
  the delay down, then the repeat, and moves when the repeat reaches 0. Because the counters
  are decremented in the same frame as the press and reloaded after a move, the effective
  timing is **first repeat 24 frames after the press, then every 5**.
  - E: Right pressed for 40 frames moved at frames 7881, 7905, 7910, 7915, then hit the wall.
- **Buttons.** Left/Right move, Down soft-drops, rotation uses the masks at `state+0x4B4EC`
  (Cross, `0x40`) and `state+0x4B4F4` (Circle, `0x20`). These are probably the button-config
  option.
- **Move before rotate.** Both can happen in the same frame, in that order.

## 5. Preview queue and randomness

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE4C4` | `s32[2]` | `next1` | `queue_init`, `queue_advance` | Spawns next |
| `0x800EE4DC` | `s32[2]` | `next2` | `queue_init`, `queue_advance` | Shown second, at half size |
| `0x800EE500`, `0x800EE510` | fx | `next1_x`, `next1_y` | `queue_init` | From `0x80094760`: P1 (30, −40) and (−10, −32); P2 (30, −40) and (60, −32) |
| `0x800EE350` | `s32[2]` | `spawn_rot` | `queue_init` | Always 0 |
| `0x800083A4` | `u32` | BIOS `rand` seed | BIOS | OpenBIOS's location; the Sony BIOS's is still unknown |

- **New piece.** `queue_advance` moves `next2` to `next1`. It then draws
  `table[rand() & 15]` from `0x80094720` = `{1,2,3,4,5,6,7,7,6,5,4,3,2,1,1,4}`, drawing again
  while the result equals the new `next1` or the piece now falling.
  - I and J: 3/16 each. O, T, L, Z, S: 2/16 each.
  - So the falling piece and the two previews are always three different pieces.
- **Verified.** `p3-rand` logged the seed before every call. Applying the algorithm to it
  predicted all **79 of 79** new previews.
- **Who calls `rand()` in play** (`p3-rand`, 2,400 frames):

  | Caller | Calls | What |
  |---|---|---|
  | `pazle_main` | 2,600 | One per frame (Phase 2) |
  | `ceiling_crush` (`0x800AF9C4`) | 292 | Debris direction, one per crushed block |
  | `queue_advance` | 79 + 39 | New preview, plus re-rolls |
  | Player 2's idle screen (`0x800A6374`, `0x800A6494`, `0x800A66AC`, `0x800A66E4`) | 21 | "PRESS START" screen animation |

  Also possible: `objects_draw`'s box-fill path (`0x800987AC`, three calls per box), not seen in
  play.
- **Order within a frame.** Player 1's logic, then player 2's, then the main loop's call. The
  port has to reproduce player 2's idle-screen calls, or the pieces diverge.

## 6. Line clears and score

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE97C` | `s32[2]` | `lock_top_row` | `piece_lock` | Board row of the locked grid's top |
| `0x800EEAA4` | `s32[2][5]` | `full_rows` | `lines_find_full` | Per grid row; player stride `0x14` |
| `0x800EEA40` | `s32[2]` | `lines_found` | `play_fall`, `play_next` | |
| `0x800EE3D0`, `0x800EE91C` | `s32[2]` | clear animation state and frame | `play_line_check`, `clear_anim_*` | |
| `0x800F35E4` | `s32[2]` | `lines_this_clear` | `play_line_check` | Drives the 3/4-line pop-up |
| `0x800EE924` | `s32[2]` | `lines_cleared` | `lines_collapse` | E: 4, then 1 |
| `0x800F35D0` | `s32[2]` | `lines_for_professor` | `lines_collapse`, `prof_think` | |
| `0x800EE3B4` | `s32[2]` | `score` | `score_add_lines` (through a pointer, PC `0x800AC6F4`) | E: 0 → 1600 → 1700 |
| `0x800EE6C8` | `s32[2]` | `popup_state` | pop-up states | |

- **Which rows can clear.** Only the five rows of the locked piece's grid are checked, and only
  rows 1–15. Row 0 never clears.
- **Score.** `score += {100, 400, 800, 1600}[lines]`, capped at 9,999,999. There's no other
  scoring during play.

## 7. Ceiling

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE914` | fx | `ceiling_y` | `ceiling_init`, `ceiling_tick` | 10 px at the start, +10 px per drop, never above 10 px |
| `0x800EE3E0` | `s32[2]` | `ceiling_timer` | `play_spawn`, `ceiling_init`, `ceiling_tick` | +1 per frame, **+60 per new piece** |
| `0x800EE39C` | `s32[2]` | `ceiling_drops` | `ceiling_init`, `ceiling_tick` | Index into the interval table, up to 49 |
| `0x800EE7B0` | fx | `ceiling_pushback` | `play_collapse`, `ceiling_tick` | Applied on the next tick |
| `0x800EE358` | `s32[2]` | `ceiling_shake` | `ceiling_init`, `ceiling_tick` | |
| `0x800F2D00` | `s32[2]` | `ceiling_state` | `ceiling_init` | 0 init, 1 running |
| `state+0x4B4FE` | `u8` | `difficulty` | option screens | Row of the interval table; 1 here |

- **Drops.** When the timer reaches `0x800D74EC[difficulty*50 + drops]`, the ceiling drops
  10 px (sound `0x09`), the timer resets and `drops` goes up by one.
  - In the last 100 frames before a drop, the ceiling sprite shakes ±1 px. Sound `0x15` plays
    when `frame & 63` is 0.
  - E: drops at frames 8882, 10182, 11371. The first was at 1,239 frames of play + 6 pieces ×
    60 = 1,599, against difficulty 1's first interval of 1,600.
- **Interval table** (frames; four difficulties; the 50 entries are shortened here):

  | Difficulty | Drops 1–10 | Then |
  |---|---|---|
  | 0 | 2400 2400 2400 1800 1800 1600 1200 1200 900 900 | 800 … 100 from drop 26 |
  | 1 | 1600 1600 1600 1600 1600 1200 1200 1200 1200 900 | 900 … 100 from drop 26 |
  | 2 | 1200 1200 1200 1000 1000 900 700 700 700 500 | 500 … 100 from drop 26 |
  | 3 | 900 900 900 800 800 800 600 600 600 500 | 500 … 100 from drop 26 |

  So the ceiling's pace depends on how many pieces you use. The wikis' "about 18 s" is
  roughly the first drop on difficulty 1 with a piece every 2 s.
- **Pushback.** Clearing 3 lines moves the ceiling up 10 px, 4 lines 20 px. One or two lines
  don't move it (table `0x8009438C` = `{0, 0, −10, −20}` for 1–4 lines).
  - E: a 4-line clear took the ceiling from 30 px to 10 px. It would have been 10 px, but
    10 px is the limit.
- **Crushing** (`ceiling_crush`, every frame). Every block from row 1 to the row just below the
  ceiling's row is turned into debris and removed (sound `0x0F`). So are blocks in row 0
  columns 3–6, the spawn opening.

## 8. Professor

The professor is 2×2 cells. His position is the cell of his **bottom-left** quarter.

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE6D8` | `s32[2]` | `prof_state` | `prof_dispatch` states, checks | 0 init, 1–2 entering through the gate, 3 walking, 4 lost, 5 goal |
| `0x800F0BE0` | `s32[2]` | `prof_substate` | states 4 and 5 | Steps of the lost and goal sequences |
| `0x800EE85C` | `s32[2]` | `prof_col` | `prof_reset`, `prof_place`, `prof_move_op` | |
| `0x800EE864` | `s32[2]` | `prof_row` | the same, plus `prof_think` | **Row 15 is the goal.** E: 14 → 15 |
| `0x800EE854` | `s32[2]` | `prof_facing` | `prof_place`, `prof_think` | 0 right, 1 left |
| `0x800EE844` | `s32[2]` | `prof_action` | `prof_think` | Current action (script index) |
| `0x800EE7E4`, `0x800EE8AC`, `0x800EE88C` | | animation channel, action and script pointer per channel | `prof_set_action` | Four channels, stride `0x10` |
| `0x800EE7DC` | `s32[2]` | `prof_anim_wait` | `prof_anim_tick` | |
| `0x800EE83C` | `s32[2]` | `prof_action_done` | `prof_anim_tick` | |
| `0x800EE7EC` | `s32[2][10]` | `prof_sensors` | `prof_sense` | Stride `0x28` |
| `0x800EE7CC` | `s32[2]` | `prof_turns` | `prof_think` | Turns in a row |
| `0x800EE7BC` | `s32[2]` | `prof_lifted` | `prof_think` | Blocks overlap him |
| `0x800EE7C4` | `s32[2]` | `prof_fall_state` | `prof_think` | |
| `0x800EE87C` | `s32[2]` | `prof_headroom` | `prof_think` | Rows between him and the ceiling |
| `0x800EE884` | `s32[2]` | `prof_danger` | `prof_think` | Headroom < 5 |
| `0x800EE490` | `s32[2]` | `prof_hold` | stage intro | Frozen during the rules panel |
| `0x800EE3F8` | `s32[2]` | `retire` | pause menu | Pause option 0 makes him lose |

His on-screen position is sprite object 40 (+400 for player 2): `state+0x5C+40×0x7C`, so
`0x8003FA24` (x) and `0x8003FA28` (y).

- **How he moves.** `prof_think` picks an action. Actions are scripts of 12-byte opcodes
  (pointers at `0x800E0738`). One opcode, `prof_move_op` (`0x800A0CCC`), adds (dx, dy) to his
  cell, so walking, falling and climbing advance a cell per script step.
  - E: walking off after the clear, his column rose every 49 frames.
- **Sensors.** Each frame `prof_sense` reads 10 board cells around him, at offsets from
  `0x800E27F0` (mirrored when he faces left):
  - 0–1: under his feet
  - 2–3: ahead (foot, head)
  - 4–7: his own four cells
  - 8–9: behind

  Off-board reads give −1.
- **Decisions** (`prof_think`, read but not yet fully decoded):
  - Blocks ahead: turn round (actions 6/7), `prof_turns` + 1.
  - Nothing under his feet: fall (8/9). A drop of 3+ rows is a different action (`0x0A`).
  - Blocks overlapping him: actions `0x0C`/`0x0D`.
  - After 8 turns in a row outside danger: action `0x15`, probably the sleep the wikis
    describe.
  - In danger, after 7+ turns, with blocks ahead and behind: action `0x1F`.
  - E: on Egypt 1 he paced between the left wall and the step at column 2, turning every
    52 frames. After the 8th turn (frame 8133) his action became `0x15` and stayed so for
    5,000 frames, until the line clear under him started a fall (action 8).
- **Losing.** `prof_headroom` = his row − the ceiling's row. Below 5, the music switches to the
  danger tune (`0x25`). Below 3, he's crushed: `lose_flags = 1`, then the lost sequence sets
  bit 2 and the game moves to screen 6. Retiring from the pause menu also loses.
- **Winning** (`prof_check_goal`). Reaching row 15 while not being pushed up by blocks:
  - music `0x2C`
  - `clear_flags = 1`
  - state 5, whose first step sets `stage_flags |= 4` (screen 9)
  - E: frame 13815
- **After a line clear below him** he falls like after any loss of support. While blocks
  overlap him (actions `0x0C`/`0x0D`), `prof_think` also moves his row down by the number of
  cleared rows at or below him (`lines_for_professor`).
  - E: clearing row 15 under him on Egypt 1 woke him (action `0x15` → 8), and he reached row
    15, the goal, 7 frames after the clear.

## 9. Stage flow, timer and records

| Address | Type | Name | Writers | Notes |
|---|---|---|---|---|
| `0x800EE3A4` | `s32[2]` | `stage_flags` | `prof_reset`, `prof_entered`, `prof_goal_start` | `|1` professor in, `|4` cleared (→ screen 9). E: 1 → 5 |
| `0x800EE348` | `s32[2]` | `lose_flags` | `prof_reset`, `prof_walk`, `prof_lost_start`, `prof_check_crushed` | `1` lost, `|2` → screen 6 |
| `0x800EE5BC` | `s32[2]` | `clear_flags` | goal sequence | E: 0 → 1 → 9 → 11 during the clear |
| `0x800EDC80` | `s32[2]` | `clear_countdown` | goal and lost sequences | 180 frames after the goal |
| `0x800EE580` | `s32[2]` | `stage_time` | `stage_timer_reset`, `stage_timer_tick` | Tenths, capped at 9999 |
| `0x800EE6C0` | `s32[2]` | `stage_time_sub` | `stage_timer_reset`, `stage_timer_tick` | |
| `state+0x4AD84` | `u16[100]` | `best_times` | `best_times_reset`, `prof_goal_record_time` | 9999 = none |

- **The stage clock runs slow.** `stage_timer_tick` runs every frame of play and adds a tenth
  when its sub-counter passes 0. That's every **7 frames** (6, 5, …, 0, −1, then reload), so a
  displayed second is 70 frames, 1.17 real seconds.
  - E: 51 tenths after 358 frames; 880 after 6,160.
  - The best time is stored from this clock: Egypt 1 recorded 88.0 for 103 real seconds.
- **After a clear** the goal sequence plays (the professor walks out), then:
  1. `stage_number_advance` adds 1 to `stage`.
  2. After stage 20, it goes to screen 10 (zone clear) unless `zones_cleared` is `0x1F`.
  3. Otherwise the player goes to screen 3, the next stage's setup.

  E: stage 0 → 1 and screen 9 → 3 at frame 14490.

## 10. Phase 2 questions answered

- **Q1 (gameplay variables):** this page.
- **Q3 (flags that end a stage):** confirmed. `0x800EE3A4 & 4` is the goal and `0x800EE348 & 2`
  the loss.
- **Q5 (BIOS seed):** OpenBIOS keeps it at `0x800083A4`. Sony's location and starting value are
  still open; they only matter for a real-console comparison.
- **Q2 (unseen screens):** screen 9 has now been seen (forced clear). Screens 7, 10, 11 and 13
  remain for Phase 5's movie corpus.

## 11. Tools added in this phase

| Tool | What it does |
|---|---|
| `re/lua/smoke.lua` `TP_WRITERS` | Write watchpoints; logs each distinct writing PC once, with `ra` and the address, and a count at the end |
| `re/lua/smoke.lua` `TP_SNAPS` | Dumps main RAM at chosen frames |
| `re/lua/smoke.lua` `TP_EXTRA` | Runs a scenario script every frame (RAM pokes, extra breakpoints) |
| `re/lua/p3_lines.lua` | Scenario: a 4-line clear, then a 1-line clear that drops the professor to the goal |
| `re/lua/rand_trace.lua` | Scenario: logs every `rand()` call with its caller and the seed |
| `re/tools/ramscan.py` | Memory scanner over snapshots (changed, same, increasing, equal to, sequence) |
| `re/tools/global_xrefs.py` | Static writers and readers of every global in a decompiled EXE |
| `re/symbols/PAZLE.vars.tsv` | The RAM map, machine-readable |

Writer PCs below `0x80094000`, or reported in `pad_read` and `start`, before frame ~4330 come
from the previous program, which occupied the same addresses, and from `PAZLE.EXE` clearing its
BSS. They're not gameplay writers.

## 12. Open questions for Phase 4

1. **`prof_think`'s full decision table**, and every action's script (`0x800E0738`): walk speed,
   climb rules, the sleep and wake rules, and what wakes him.
2. **The stage records' remaining fields** (`+0x00`, `+0x04`, `+0x0C`–`+0x24`) and the zone →
   record table for all five zones.
3. **`lines_remove`'s second pass**, which shifts rows above the cleared ones. When rows
   outside the piece's grid move, and how the professor moves with them.
4. **What `0x800B58E8`** (the eighth updater) does.
5. **Option settings**: which option screen writes `difficulty` (`state+0x4B4FE`) and the
   rotation-button masks.
