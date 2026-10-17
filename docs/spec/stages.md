# Stages, stage flow and timer

Evidence: S (`prof_place`, `stage_load_layout`, `intro_setup` and the stage-intro steps
`0x800A2430`–`0x800A2EA0`, `stage_timer_*`, `stage_number_advance`, the continue steps
`0x800A3A74`/`0x800A3BD0`, the zone-clear step `0x800A9C2C`), D (`stages.json`), E (Phase 3:
Egypt 1's layout equals the board read from RAM; stage clock 51 tenths after 358 frames; best
time 88.0; stage 0 → 1 after the clear).

## 1. Stage data

100 stages: 5 zones × 20. Stage `n` (0-based, `zone * 20 + stage`) reads:

- `0x800D780C[n]`, the record index. **It is the identity**: stage n uses record n.
- Record `0x800D79EC + 0x28 * n`:

| Offset | Type | Field | Read by |
|---|---|---|---|
| `+0x00` | s32 | professor column, 16.16 (×10 for the sprite x) | `prof_place` |
| `+0x02` | s16 | professor column (the high half of `+0x00`) | `prof_place` |
| `+0x04` | s32 | professor row, 16.16 | `prof_place` |
| `+0x06` | s16 | professor row | `prof_place` |
| `+0x08` | s32 | facing: 0 right, 1 left | `prof_place` |
| `+0x0C` | s32 | always 0, never read | |
| `+0x10` | s32 | layout index (= n for every stage) | `stage_load_layout` |
| `+0x14`–`+0x1C` | | always 0, never read | |
| `+0x20` | s32 | data-file item for sprite slot 30 (285–299, one per 7 stages) | `0x800B091C` |
| `+0x24` | s32 | data-file item for sprite slot 31 (38–87, one per 2 stages), drawn at (−4, 2) | `0x800B0824` |

  The two art items are presumably the frame art and the background. Phase 7 confirms which.
- Layout `0x800D898C + 150 * index`: 15 rows × 10 bytes, board rows 1–15. `stage_load_layout`
  copies it into the board from row 1, one byte per cell, each zero-extended to an int.
  Values: 0 empty, 1–8 block colours. A stage block behaves exactly like a piece block.

All of it is in `stages.json`, layouts as strings (`'.'` empty, digits = value). Example, Egypt 1
(the professor starts at column 0, row 14, facing right, on the floor of the left pocket):

```
row 14  ..5.......
row 15  555.......
```

Start rows range from 4 to 14; none is on row 15 (that would be an instant win). Most stages
start him standing on something with his cells empty, but not all, and the rules handle it:

- Stages 5, 90 and 98 start him in mid-air; he falls at once ([professor.md](professor.md) §5.2).
- Stages 84 and 87 start him with blocks in his upper half. He climbs out on top
  of them as soon as the look-around animation ends, and keeps climbing: both stages are
  "ladders" of 2-wide slabs one row apart.

**Rows 0 and 1.** Row 0 is never stored: `board_reset` fills it (`0xFFFF` in columns 0–2 and
7–9, the spawn opening 3–6 empty). Row 1 is loaded but the ceiling crushes rows 1–2 as soon as
play starts ([ceiling.md](ceiling.md) §4). No layout has blocks in rows 1–2.

## 2. Starting a stage

Screen 3 (`scr03_stage_setup`, 20 frames) then screen 4, the stage intro (table `0x80094340`):

| Step | Function | What it does |
|---|---|---|
| 0 | `intro_setup` | Clear the board and sprites, reset pieces/lines/pop-up counters, `stage_flags = 0`, `spawn_delay = 0`, HUD sprites, music `stage / 10 + 0x23` |
| 1 | `0x800A2430` | Unless this is the very first stage of a new game: draw score and stage number, `stage_timer_reset`, `queue_init`. Then always: `stage_load_layout`, block sprites, intro countdown `0x800EEAE4 = 64`, `ceiling_init` ([ceiling.md](ceiling.md) §1) |
| 2 | `0x800A2878` | Wait for the stage banner. Then step 4, or step 3 on the first stage of a new game |
| 3 | `0x800A2948` | First stage only: the rules panel. When it closes: score, stage number, `stage_timer_reset`, `queue_init` |
| 4 | `0x800A2C6C` | `prof_dispatch` (states 0–2: place, gate animation). Count down the 64 frames, then step 6; on the first stage, step 5 with `prof_hold = 1` |
| 5 | `0x800A2D60` | First stage only: second rules panel; then `prof_hold = 0` |
| 6 | `0x800A2DD4` | `prof_dispatch` until `stage_flags & 1` (the gate animation has ended) |
| 7 | | One frame |
| 8 | | Screen 5, step 0: play starts with a spawn |

"First stage of a new game" is `stage == 0`, `zones_cleared == 0`, `score == 0` and
`0x800EE8F4 == 1`.

The queue is filled (two `rand()` draws plus re-rolls) in step 1 or 3, so the RNG calls made
during the intro's banner and gate animation (only the main loop's one per frame, and player 2's
idle screen) come after it.

## 3. During play

Screen 5 ([frame.md](frame.md)). The stage ends when the professor reaches row 15 (screen 9) or
is crushed or retired (screen 6) ([professor.md](professor.md) §6).

## 4. Stage clock and best times

`stage_time` (tenths, shown as `ddd.d`) and `stage_time_sub`:

- `stage_timer_reset`: `stage_time = 0`, `stage_time_sub = 6`.
- `stage_timer_tick`, every frame of screen 5 ([frame.md](frame.md) §3):

```
stage_time_sub -= 1
if stage_time_sub < 0:
    if stage_time < 9999: stage_time += 1
    stage_time_sub = 6
```

**Quirk: the clock runs slow.** A tenth is 7 frames, so a displayed second is 70 frames, 1.17 s.
It stops at 999.9.

**Best times**: `state+0x4AD84 + 2 * n` (u16 per stage, 9999 = none, reset by
`best_times_reset`). At the end of the goal sequence: if `stage_time < best`, `best =
stage_time`. The HUD shows the stage's best time throughout play (`0x800B58E8`).

## 5. After a clear (screen 9)

The goal sequence plays, then `stage_number_advance`:

```
stage += 1
if stage == 20:
    if zones_cleared != 0x1F: screen 10 (zone clear); return
    if zone == 4: screen 9 step 4 (the end of the 100-stage run); return
    zone += 1; stage = 0
next step (on to screen 3 for the next stage)
```

**Zone clear** (screen 10, first step): `zones_cleared |= 1 << zone`.
`zones_cleared` is an **s32 per player** at `0x800F35C8` (stride 4; Phase 3 listed it as u8).
Then:

- all five bits (`0x1F`): screen 11 (the ending);
- zones 0–3 cleared (`0x0F`): screen 2, the story scene for the last zone;
- otherwise back to the map.

**100-stage mode.** When a game starts with `zones_cleared == 0x1F` (from a password,
[password.md](password.md), or the menu after finishing), zone and stage start at 0, the stage
number is shown as `zone * 20 + stage + 1`, and stages run on through all five zones without the
map (the `zone += 1` branch above).

## 6. Losing, continuing and retiring

**Continue** (screen 6): a 9 → 0 countdown, 90 frames per digit; Cross skips to the next digit.

- Start: continue. **Quirk: the continue count is kept in the score's last two digits:**
  `if score % 100 < 99: score += 1`. Then screen 4: the same stage restarts from its intro
  (the board, professor, ceiling and stage clock are all reset; the score is kept). Continues
  are unlimited.
- Countdown expires: game over, music `0x2D`, then name entry if the score ranks
  (screen 7) and the save/password screen (screen 13).

**Pause** (screen 12, Start during play): a two-option menu. Option 0 ("retire") sets
`retire = 1` and resumes; the professor then loses on the next frame ([professor.md](professor.md)
§6.3), which leads to screen 6 like any loss.

**Hidden stage select.** Pause step 4 (`0x800ABB58` → `0x800B43E4`) contains a stage select
that sets `zone`/`stage` from a 1–100 number (`0x800F2CF8`), reloads the layout and redraws
(`0x800B4780`). How the pause menu reaches step 4 is not yet known (ledger open item).
