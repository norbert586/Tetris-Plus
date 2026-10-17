# The professor

Evidence: S (`prof_dispatch` and its states, `prof_think`, `prof_set_action`, `prof_anim_tick`,
the interpreter `0x800A07F4`/`0x800A0900` and its eight opcodes, `prof_sense`,
`prof_fall_distance`, `prof_check_crushed`, `prof_check_goal`), D (`professor.json`), E (Phase 3:
walk step every 49 frames, turn every 52 frames, sleep after the 8th turn, wake and fall on a
line clear under him, goal at row 15; Phase 4 run `p4-stage87`, §7).

The professor is not on the board. He is 2 × 2 cells; `prof_col`, `prof_row` is the cell of his
**bottom-left** quarter, so he covers columns `col`, `col + 1` and rows `row − 1`, `row`. Blocks
can lock into his cells (a piece dropped on him); that is what makes him climb.

## 1. States (`prof_dispatch` on `prof_state`)

| State | Function | What it does |
|---|---|---|
| 0 | `0x8009DDDC` → `prof_place` | Reset (`prof_reset`), place him from the stage record ([stages.md](stages.md) §1): column, row, facing. State 1 |
| 1 | `0x8009DE24` | Action `0x17` (coming in through the gate) on channel 1. State 2 |
| 2 | `prof_entered` | Run the animation until the action ends; then `stage_flags |= 1`, action `0x18` (facing right) or `0x19` (left) on channel 1, state 3 |
| 3 | `prof_walk` | Play (§4–§6) |
| 4 | `0x8009E010` | Lost sequence (§6.2) |
| 5 | `0x8009E204` | Goal sequence (§6.1) |

States 0–2 run during the stage intro ([stages.md](stages.md) §2); play starts once
`stage_flags & 1` is set.

**`prof_walk`**, every frame of play:

```
if prof_hold: return                       # only set while the first stage's rules panel is up
prof_anim_tick()                           # §2
prof_think()                               # §5
prof_check_crushed()                       # §6
if retire == 1 and lose_flags == 0: lose_flags = 1; prof_state += 1   # pause-menu "retire"
else: prof_check_goal()                    # §6
```

## 2. Animation scripts

Everything the professor does is an **action**: a script of opcodes at
`professor.json actions[n]` (pointer table `0x800E0738`, 39 entries). Scripts move his sprite,
change its image, play sounds and, through `move_cell`, change his cell. His position in cells
only changes inside scripts (and in the line-clear shift of §5.1).

### 2.1 Channels

There are four channels (0–3) per player: `prof_channel_action[ch]`, `prof_channel_script[ch]`
(a pointer into the script), and a current channel `prof_anim_channel`.

- `prof_set_action(action, ch)`: remembers the current channel's action as `prof_prev_action`
  (`0x800EE8D0`), makes `ch` current, sets its action and points its script at the action's
  start, `prof_anim_wait = 0`. It doesn't touch other channels.
- When a script reaches `end`: `prof_action_done = 1`, and the channel is popped
  (`0x800A10C8`): repeatedly, record `prof_prev_action = prof_action`, clear the current
  channel's script and action, and step down one channel, until channel 0 or a channel that
  still has a script.

Use: 0 walking, 1 turns, climbs, sleep and the entry animations, 2 falls and landings,
3 the goal and lost sequences.

### 2.2 The interpreter

`prof_anim_tick`, once per frame:

```
prof_action_done = 0
if prof_anim_wait >= 1: prof_anim_wait -= 1; return
run opcodes on the current channel until one sets prof_anim_wait,
    sets prof_action_done, or the channel's script pointer is null
```

| Op | Size | Name | Effect |
|---|---|---|---|
| 0 | 4 | `end` | `prof_action_done = 1`, pop the channel (§2.1) |
| 1 | 24 | `image` | Set the sprite's image (`image + 0x10000`) and flip. If `second_sprite`, use sprite `0x100` instead of 40, placed at sprite 40's position. Words +8 and +0xC are never read |
| 2 | 8 | `wait n` | `prof_anim_wait = n` (but **1 if `prof_fast` is set**, §2.3) |
| 3 | 12 | `move_cell dcol drow` | `prof_col += dcol`, `prof_row += drow` |
| 4 | 8 | `jump n` | `n == 0`: restart the action's script; else move the pointer by `n` words (always backwards) |
| 5 | 8 | `sound id` | `se_play(id)` |
| 6 | 12 | `nudge_px dx dy` | Move sprite 40 by (dx, dy) px |
| 7 | 12 | `hide keep` | Clear sprite `0x100`'s image, and sprite 40's too if `keep == 0` |

A `wait n` holds the script for **n + 1 frames**: it is set in one frame, counted down over the
next n, and the script resumes on the frame after. An action's first opcodes run on the frame
after `prof_set_action` (the tick runs before the think).

So the **walk** (action 2, eight steps of `wait 5`) takes 48 frames, and since a new walk is
chosen on the frame its predecessor ends, he advances one cell every **49 frames** (E). A turn
(actions 6/7, 51 frames) repeats every 52 (E), and a fall row (action 8, 9 or `0x0B`, 8 frames)
every 9 (E, run `p4-stage87`).

### 2.3 Holding a button speeds up the goal and lost sequences

`prof_fast` (`0x800EE570`) is set by `0x800A164C` when the low byte of the held pad word is
non-zero (any of L1, L2, R1, R2, Triangle, Circle, Cross, Square), else cleared. Only the goal
and lost sequences call it (§6). While it's set, every `wait` lasts 2 frames. `prof_reset`
clears it at stage start.

### 2.4 Actions

Lengths are frames from the first opcode to `end` (sum of `wait n + 1`). "Move at" is the frame
offset of the `move_cell`.

| Action | Use | Channel | Length | Cell moves | Sound |
|---|---|---|---|---|---|
| `0x02` / `0x04` | Walk right / left | 0 | 48 | ±1 col at 30 | |
| `0x03` / `0x05` | Run right / left (danger) | 0 | 16 | ±1 col at 10 | |
| `0x06` / `0x07` | Turn (from facing right / left) | 1 | 51 | | |
| `0x22` / `0x23` | Quick turn (danger) | 1 | 12 | | |
| `0x08` / `0x09` | Fall one row (facing right / left) | 2 | 8 | +1 row at 6 | |
| `0x0A` | Startled before a long fall | 2 | 30 | | `0x2B` at 9 |
| `0x0B` | Long fall, one row | 2 | 8 | +1 row at 6 | |
| `0x0E` / `0x0F` | Land after a short fall | 2 | 23 | | |
| `0x10` | Land after a long fall | 2 | 77 | | `0x2A` at 39 |
| `0x0C` | Climb out, 1 row (blocks in his lower half) | 1 | 81 | −1 row at 76 | `0x1A` at 18 |
| `0x0D` | Climb out, 2 rows (blocks in his upper half) | 1 | 137 | −1 row at 47 and 132 | `0x1B` at 47 |
| `0x15` | Sleep (loops from op 13 forever) | 1 | 112, then 88 per loop | | |
| `0x21` | Wake up | 1 | 79 | | `0x1E` at 0 |
| `0x1F` | Trapped in danger | 1 | 20 | | |
| `0x17` | Entering through the gate | 1 | 138 | | `0x07` at 106 |
| `0x18` / `0x19` | Looking around after entering | 1 | 124 | | |
| `0x14` | Lost (crushed) | 3 | 178 | | `0x1E`, `0x16`, `0x14` |
| `0x20` | Goal celebration (loops) | 3 | 70 | | `0x1F` at 31 |
| `0x1A` | Goal sequence step (walks off) | 3 | 216 | +1 row at 31 | `0x27` at 139 |
| others | `0x01`, `0x1B`–`0x1E`, `0x25`, `0x26`: goal/zone-clear presentation | | | | |
| `0x00`, `0x11`–`0x13`, `0x16`, `0x24` | Empty (`end` only) | | 0 | | |

Every opcode is in `professor.json`.

## 3. Sensors (`prof_sense`)

Ten board cells around him, at offsets (dcol, drow) from `prof_col`, `prof_row`
(`professor.json sensors`, `0x800E27F0`):

| Sensor | Facing right | Facing left | Meaning |
|---|---|---|---|
| S0, S1 | (0, +1), (1, +1) | (0, +1), (1, +1) | Under his feet |
| S2 | (2, 0) | (−1, 0) | Ahead, foot level |
| S3 | (2, −1) | (−1, −1) | Ahead, head level |
| S4, S5 | (0, 0), (1, 0) | the same | His lower half |
| S6, S7 | (0, −1), (1, −1) | the same | His upper half |
| S8 | (−1, 0) | (2, 0) | Behind, foot level |
| S9 | (−1, −1) | (2, −1) | Behind, head level |

Each sensor is the board value there, or **−1 when off the board** (column outside 0–9, or row
outside 0–15). Any non-zero value counts as solid, so the walls and the floor below row 15 are
solid.

(S0 and S1 would read 8 if `0x800EE7D4` were set; nothing ever sets it.)

Shorthands below: **ground** = S0 ∨ S1, **ahead** = S2 ∨ S3, **behind** = S8 ∨ S9,
**low** = S4 ∨ S5, **high** = S6 ∨ S7, **inside** = low ∨ high.

`prof_fall_distance`: 0 if ground; otherwise the number of rows below `row` that are empty in
both his columns, counting down from `row + 1` until a non-empty row or row 16.

## 4. Headroom, danger and music

Computed at the start of every think (§5):

```
headroom = prof_row - ceil_row          # ceil_row from ceiling.md §1
danger = headroom < 5
if danger changed: bgm_request(danger ? 0x25 : stage / 10 + 0x23)
```

`stage` is the stage within the zone (0–19), so the normal tune is `0x23` for stages 1–10 and
`0x24` for 11–20 in every zone.

## 5. Decisions (`prof_think`)

### 5.1 Before deciding: line clears under a climbing professor

```
if prof_action in {0x0C, 0x0D} and lines_for_professor > 0:
    n = number of i in 0..4 with full_rows[i] and (lock_top_row + 4 - i) >= prof_row - 1
    prof_row += n; sprite y += 10 px * n
lines_for_professor = 0
```

That is, while he is climbing out from under blocks, cleared rows at or below his head level
carry him down with the blocks. (`lines_for_professor` is set by every clear, but is consumed
here every frame, so only a clear that happens during a climb has this effect.)

Then `prof_sense`, then §4.

### 5.2 The decision chain

`A` is the current channel's action (also stored in `prof_action`), `prev` is `prof_prev_action`,
`ch` the current channel. "Reset" means `lifted = fall_state = turns = 0`. The first matching row
wins; "keep" means return without changing anything.

| # | Condition | Result |
|---|---|---|
| 1 | `ch > 2` (goal/lost sequence) | keep |
| 2 | `A` ∈ {8, 9, `0x0B`, `0x10`} | keep (falling, or landing after a long fall) |
| 3 | `fall_state == 3`, `prev == 0x0B`, ground, not inside | Reset; `0x10` on ch 2 (land after long fall) |
| 4 | `A` ∈ {`0x0E`, `0x0F`} | keep |
| 5 | `fall_state == 2`, `prev` ∈ {8, 9}, ground, not inside | Reset; `0x0F` facing right / `0x0E` facing left, ch 2 |
| 6 | `A` ∈ {`0x0A`, `0x0B`} | keep |
| 7 | `fall_state == 3`, no ground | `lifted = 0`; `0x0B` on ch 2 (next row of a long fall) |
| 8 | `A` ∈ {`0x0A`, 8, 9} | keep |
| 9 | not `lifted`, `prof_fall_distance() > 2` | `lifted = turns = 0`, `fall_state = 3`; `0x0A` on ch 2 (startled) |
| 10 | not `lifted`, no ground | `turns = 0`, `fall_state = 2`; 8 facing right / 9 facing left, ch 2 |
| 11 | `ch > 1` | keep |
| 12 | `A == 0x21` | keep (waking up) |
| 13 | `A == 0x15` and (no ground, or not ahead, or inside, or not behind) | Reset; `0x21` on ch 1 (wake) |
| 14 | `A == 0x15` and danger | `lifted = fall_state = 0`; `0x21` on ch 1 (wake) |
| 15 | `A == 0x15` | keep (sleeping) |
| 16 | `turns >= 8` and not danger | `lifted = fall_state = 0`; `0x15` on ch 1 (sleep) |
| 17 | not `prof_action_done`, or the current channel still has a script | keep |
| 18 | danger, `turns > 6`, ahead, not inside, behind | `lifted = fall_state = 0`; `0x1F` on ch 1 (trapped). Otherwise, if danger and `turns > 6`: `turns = 0` and go on |
| 19 | high and `lines_found == 0` | `fall_state = turns = 0`, `lifted = 1`; `0x0D` on ch 1 (climb 2) |
| 20 | low and `lines_found == 0` | `fall_state = turns = 0`, `lifted = 1`; `0x0C` on ch 1 (climb 1) |
| 21 | danger and ahead | `lifted = fall_state = 0`, `turns += 1`; `0x22` facing right / `0x23` left, ch 1; **flip facing** |
| 22 | ahead | `lifted = fall_state = 0`, `turns += 1`; 6 facing right / 7 left, ch 1; **flip facing** |
| 23 | `A` ∈ {3, 5} | keep |
| 24 | not danger | if `A` ∈ {2, 4}: keep. Else reset; walk, 2 facing right / 4 left, ch 0 |
| 25 | danger | Reset; run, 3 facing right / 5 left, ch 0 |

Rows 1–16 run every frame and can interrupt the current action; rows 17–25 run only when the
current action has just ended (`prof_action_done` is set by `end` in this frame's tick) and no
lower channel still has a script.

**Interrupted actions resume.** A fall or landing goes on channel 2 without touching channel 0,
so if he falls in the middle of a walk, the walk's script carries on from where it stopped once
the fall and landing have popped (row 17 keeps it running).

**What this means in play:**

- He walks one cell per 49 frames (one per 17 in danger), and turns at **any** block or wall
  in front of him at foot or head level. He never steps up.
- If both cells under his feet are empty, he falls: one row per 9 frames (the 8-frame fall
  action, plus the frame on which the next one is chosen).
  One block under either foot holds him. A drop of 3 or more rows
  (both columns clear) makes him startled first, then fall row by row; the landing animation
  then takes 77 frames instead of 23.
- Blocks locked into his cells make him climb out on top of them: 1 row if they are in his lower
  half only, 2 rows if any are in his upper half. Not while a line clear is pending
  (`lines_found`).
- `turns` counts turns with no walk in between (a walk resets it). After 8 he falls asleep
  (row 16), which is what happens when he's boxed into a 2-cell pocket. He wakes when the floor
  or either side opens, a block lands in him, or danger starts.
- In danger, after 7 turns in a row, he plays the "trapped" animation if he's boxed in on both
  sides; otherwise the count restarts.
- **`lifted`** is set by a climb and cleared by everything else; while it's set, rows 9 and 10
  (falls) are skipped, so he doesn't fall in the middle of a climb.

## 6. Winning and losing

**`prof_check_crushed`** (after each think): if `danger == 1` and `headroom < 3`:
`lose_flags = 1`, `prof_state += 1` (4), `prof_substate = 0`, `clear_countdown = 0`.

`headroom < 3` means his head row (`row − 1`) is at or above `ceil_row + 1`, a row the ceiling
crushes.

**`prof_check_goal`** (only if not retired this frame): if `prof_row == 15`, not `lifted`, and
`lose_flags == 0`: music `0x2C`, `clear_flags = 1`, `prof_state += 2` (5), `prof_substate = 0`,
`clear_countdown = 0`. Row 15 is the bottom row, so **the goal is reaching the floor**.

Crushing is tested first, so a professor who reaches row 15 and is crushed in the same frame
loses.

### 6.1 Goal sequence (state 5)

16 substates (table `0x80094270`). The first, `prof_goal_start`: action `0x20` on channel 3,
`clear_countdown = 180`, **`stage_flags |= 4`**, which moves the player to screen 9 at the end of
that frame ([frame.md](frame.md) §2). The rest is presentation on screen 9 (walking off, the
time display, the best-time record, [stages.md](stages.md) §5); these substates call
`0x800A164C`, so holding a button speeds them up.

### 6.2 Lost sequence (state 4)

`prof_lost_start`: music stop (`0x34`), action `0x14` on channel 3, debris and pop-ups cleared,
**`lose_flags |= 2`**, which moves the player to screen 6 (continue) at the end of that frame.

### 6.3 Retiring

The pause menu's first option sets `retire = 1` ([stages.md](stages.md) §6); the next
`prof_walk` makes him lose as above.

## 7. Emulator check: stage 87 (run `p4-stage87`)

`re/lua/p4_stage.lua` pokes zone 4, stage 6 during screen 3, so Phase 0's route plays stage 87
(a ladder of 2-wide slabs on the left; he starts at column 0, row 14, with a slab in his upper
half). No input after play starts. Watched `prof_action`, `prof_col`, `prof_row` (frame: event):

| Frame | Event | Predicted by |
|---|---|---|
| 6925 | action `0x18` (look around), 124 frames | §1 state 2 |
| 7050 | action `0x0D` (climb 2): row 14 → 13 at 7097, → 12 at 7182, ends 7187 | §5.2 row 19; moves at +47 and +132, length 137 |
| 7188, 7326 | `0x0D` twice more: rows 12 → 10 → 8 | the next two rungs |
| 7464 | walk: column 0 → 1 at 7494, ends 7512; next walk 7513 | row 24; move at +30, 49-frame period |
| 7543 | column 1 → 2: both cells under him empty, drop of 6 rows | |
| 7544 | action `0x0A` (startled), 30 frames | row 9 |
| 7575 | action `0x0B`; row 8 → 9 at 7581; then a row every 9 frames to row 14 at 7626 | row 7; the walk shows for one frame between falls (it resumes on channel 0) |
| 7629 | action `0x10` (land after a long fall), 77 frames; then the rest of the interrupted walk until 7719 | row 3; §5.2 "interrupted actions resume" |
| 7867 | turn (action 6) at column 5, blocked by the block at column 7; 51 frames | row 22 |

Every event, its frame and its length matched the spec.
