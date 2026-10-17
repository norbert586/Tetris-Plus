# Line clears and score

Evidence: S (`lines_find_full`, `play_line_check`, `clear_anim_*`, `play_collapse`,
`lines_clear_cells`, `lines_collapse`, `lines_remove`, `score_add_lines`), E (Phase 3 run
`p3-lines2`: 4-line clear, then 1-line clear; score 0 → 1600 → 1700).

## 1. Finding full rows (`lines_find_full`, at lock)

Only the five rows of the locked piece's grid are checked. Let `top = lock_top_row`.
`full_rows[i]`, i = 0–4, is row `top + 4 − i`: **index 0 is the grid's bottom row**.

```
for i in 0..4:
    row = top + 4 - i
    full_rows[i] = 1 <= row <= 15 and every board cell in row != 0
lines_found = OR of full_rows
```

Row 0 never counts. Any non-zero value is a block: piece cells, stage blocks (1–8) and, in
theory, the wall value `0xFFFF` (which only exists in row 0).

`lines_find_full` runs in the lock frame, before `ceiling_crush`. A row that is full at that
moment is cleared even if the ceiling crushes some of its blocks the same frame (rows 1 and 2
are always crushed, [ceiling.md](ceiling.md) §4).

## 2. Clear animation (steps 2–3)

**Step 2** (`play_line_check`): if `lines_found == 0`, step 5. Otherwise
`lines_this_clear = Σ full_rows` (1–4), sound `0x2B + lines_this_clear`, clear-animation state
0, step 3.

**Step 3** (`play_clear_anim`):

- First frame (`clear_anim_start`): one flash sprite per full row (image `0x1000C`),
  `clear_anim_frame = 0`. Returns "not done".
- Each later frame (`clear_anim_tick`): while `clear_anim_frame < 8`, **only on frames where the
  global frame counter `state+0x40` is even**, set the flash sprites' scale from the table at
  `0x800946E0` and `clear_anim_frame += 1`. Once it is 8: remove the sprites, return "done".
- On "done", step 4.

**`lines_this_clear` after one or two lines** (Phase 6): the pop-up dispatcher
(`lines_popup_dispatch`, every frame after the step) indexes its table with it, and entries 0-2
reset it to 0 at once. So it reads 1 or 2 only within step 2's frame; 3 and 4 keep it while
their pop-up shows (about 60 frames).

**Quirk: the length depends on the global frame counter.** Step 3 lasts 17 frames if its first
frame has an odd counter, 18 if even. The counter carries over from earlier programs, so the port
needs the original's value at Puzzle Mode entry (Phase 2 §2) to match frame-exactly.

The board isn't changed during the animation.

## 3. Collapse (step 4, `play_collapse`)

In order:

1. `lines_clear_cells`: zero every full row (§1's rows).
2. `lines_remove` (§4).
3. `score_add_lines` (§5), redraw the score.
4. `ceiling_pushback = PUSHBACK[lines_cleared]` ([ceiling.md](ceiling.md) §3).
5. Step 5, sound `0x0D`.

## 4. Row removal (`lines_remove` = `lines_collapse` + a shift)

**First pass, inside the grid** (`lines_collapse`). It compacts the five grid rows downward:

```
lines_cleared = 0
dst = top + 4
for i in 0..4:                    # bottom grid row first
    if full_rows[i] == 1: lines_cleared += 1; continue
    src = top + 4 - i
    if src * 10 < 11:  board row dst = all 0        # src row ≤ 1 (or negative): not copied
    else:              board row dst = board row src
    dst -= 1
lines_for_professor = lines_cleared
```

After it, rows `top … top + lines_cleared − 1` still hold stale copies.

**Second pass, above the grid** (in `lines_remove`), only if `lines_cleared > 0` and `top > 0`.
It walks cell by cell, `d` and `s` being flat board indices (`row * 10 + col`):

```
d = (top + lines_cleared) * 10 - 1        # last cell of the highest stale row
s = top * 10 - 1                          # last cell of the row above the grid
while d > 29:                             # destination stays in rows 3 and below
    if s < 10:  board[d] = 0              # never copy from row 0
    else:       board[d] = board[s]; board[s] = 0
    d -= 1; s -= 1
```

So everything above the grid falls by `lines_cleared` rows, overwriting the stale rows. Rows 0–2
are never written as destinations, and row 0 is never a source.

**Edge cases, all invisible in play.** The guards around rows 0–2 (`src ≤ 1` copied as zero, the
`d > 29` stop, `top > 0`) only differ from a plain "shift everything down" for rows 1 and 2, and
those rows are empty whenever this runs: `ceiling_crush` empties rows 1 to the ceiling's row + 1
every frame, and the ceiling is never above row 1 ([ceiling.md](ceiling.md) §4). The port should
still implement the passes literally.

The board's sprite objects (`state+0x5C + (0x32 + cell) * 0x7C`) are moved with the cells.
That's presentation; the renderer can redraw from the board.

**The professor isn't on the board.** Row removal doesn't move him. He reacts in his own update
the same frame: he falls if the blocks under him went, or, while he is climbing out from under
blocks, he is moved down by the cleared rows ([professor.md](professor.md) §5.1).

## 5. Score (`score_add_lines`)

```
score += word at 0x800D61C8 + 4 * lines_cleared
if score > 9999999: score = 9999999
```

`0x800D61C8 + 4n` is `LEVELS[0].score[n − 1]` = 100, 400, 800, 1600 for 1–4 lines. The level is
never consulted (and is 0 anyway). Nothing else in play scores.

**Stage-clear bonuses** (found in Phase 6, `docs/re/core-port.md` §8; checked by the traces).
The goal sequence adds two more:

- **Time bonus** (`0x80099128`): with the stage clock at t tenths, 20,000 if t < 100, else
  `((600 − t) × 40 + 90) / 100 × 100` (C division) if t < 600, else nothing.
- **Piece bonus** (goal substate 4, `0x8009E858`): only on stages that show the bonus marker
  (`(stage + 1) % 3 == 0` within the zone, and the zone's last stage outside Atlantis; never in
  100-stage mode). The score gets `0x800E2920[group][(pieces − 1) / 10]` (pieces capped at 31,
  `group = 0x800E28E0[stage % 20]`), and an item (`0x800E2970`) is added to the game's
  collection, shown at game over and on the zone-clear screen.
