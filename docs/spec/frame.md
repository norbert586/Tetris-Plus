# One frame of play

Evidence: S (`pazle_main`, `phase1_players`, `scr05_play`, `play_step_dispatch` and the step
functions), E (Phase 2 tick count, Phase 3 timings).

## 1. Order within a frame

`pazle_main` runs one tick per vblank, NTSC 59.826 Hz, no frame skipping
(`docs/re/static-bootstrap.md` §2):

1. `state+0x40 += 1` (the global frame counter; it carries over from earlier programs).
2. Game logic, `phase1_players`:
   1. Player 1 (`player = 0`, sprite offset 0): `screen_dispatch`, then `pause_check`.
   2. Player 2 (`player = 1`, sprite offset 400): the same.
   3. Two-player flag `state+0x4B53C` = 0 if either player is on screen 8, else 1.
   4. Both players on screen 8 → leave for `RANKING.EXE`.
3. Draw, `DrawSync`, `VSync`, flip.
4. `pad_read`: both pads. The logic sees this read in the **next** frame.
5. `rand()` once, result discarded.
6. Start+Select soft-reset check.

So a frame's logic uses the pad state read at the end of the previous frame. The port should
read input, then step.

**Pad words** per player (`0x800F36F2` + 6p): `held`, and `pressed = (previous ^ now) & now`.
Button bits are libetc's (`docs/re/static-bootstrap.md` §3.1).

## 2. Screen 5, gameplay (`scr05_play`)

Every frame, for the current player:

1. `play_step_dispatch` on the step word `state+0x4B510[p]` (§3).
2. `piece_flash_draw`, `lines_popup_dispatch` (3- and 4-line pop-ups). Presentation only.
3. `prof_dispatch` ([professor.md](professor.md)).
4. `ceiling_dispatch` ([ceiling.md](ceiling.md)): state 0 `ceiling_init`, 1 `ceiling_tick`.
5. `ceiling_crush` ([ceiling.md](ceiling.md) §4).
6. `debris_update`: moves the debris sprites. Presentation only.
7. `0x800B58E8`: draws the stage's best time. Presentation only.
8. If `stage_flags & 4`: screen 9 (stage clear), step words cleared.
9. If `lose_flags & 2`: screen 6 (continue), step words cleared.

Both 8 and 9 are tested; if both were set in one frame, screen 6 wins because it is written
last. (They can't both be set: the goal test requires `lose_flags == 0`.)

## 3. The play step machine

| Step | Function | Frames | What it does |
|---|---|---|---|
| 0 | `play_spawn` | 1 | Spawn the next piece ([piece.md](piece.md) §2), advance the queue, step 1 |
| 1 | `play_fall` | while falling | Input, rotation, gravity, lock. On lock: step 2 |
| 2 | `play_line_check` | 1 | No full rows: step 5. Otherwise sound `0x2B + lines`, step 3 |
| 3 | `play_clear_anim` | 17 or 18 | Clear animation ([lines.md](lines.md) §2), then step 4 |
| 4 | `play_collapse` | 1 | Remove rows, score, pushback, sound `0x0D`, step 5 |
| 5 | `play_next` | 1 | `lines_found = 0`, `0x800F35F4 = 10`, step 0 |
| 6, 7 | | | Empty |

Every step function (0–5) ends with `stage_timer_tick` and `stage_timer_draw`, so the stage clock
runs on every frame of screen 5 ([stages.md](stages.md) §4). `play_spawn` ticks it only when the
spawn actually happens; with `spawn_delay` always 0 that is every time.

**Lock to next piece** (measured, E): 3 frames without a clear (lock frame in step 1, then steps
2, 5, 0; the new piece first falls on the frame after step 0), 22 frames with a clear. With a
clear the length depends on the parity of the global frame counter ([lines.md](lines.md) §2):
21 or 22 frames.

## 4. Random numbers

`rand()` is the BIOS LCG: `seed = seed × 1103515245 + 12345; return (seed >> 16) & 0x7FFF`.
Nothing seeds it. Calls during play, in frame order:

1. Player 1's logic:
   - `queue_advance` at spawn: one call, plus one per re-roll ([piece.md](piece.md) §3).
   - `ceiling_crush`: one per crushed block (debris direction, `rand() & 7`).
   - `objects_draw` box fill is not used in play.
2. Player 2's logic: on screen 8 ("PRESS START"), `0x800A6374`, `0x800A6494`, `0x800A66AC` and
   `0x800A66E4` call it now and then for the idle animation (21 calls in 2,400 frames, E).
3. The main loop's call.

The port must make the same calls in the same order, including player 2's idle screen and the
debris directions, or the piece sequence diverges. Phase 5 records the seed at stage start so
traces can be replayed.
