# Ceiling

Evidence: S (`ceiling_dispatch`, `ceiling_init`, `ceiling_tick`, `ceiling_crush`,
`debris_update` and its states `0x800AFCAC`/`0x800AFD4C`, slot finder `0x800AF07C`),
D (`rules.json`), E (Phase 3: drops at frames 8882, 10182, 11371; 4-line pushback 30 → 10 px).

## 1. State

| Variable | Meaning |
|---|---|
| `ceiling_y` | 16.16 px. Starts at 10 px. Its row is `ceil_row = (ceiling_y >> 16) / 10` |
| `ceiling_timer` | Frames towards the next drop; +1 per frame, **+60 per spawned piece** |
| `ceiling_drops` | Drops so far, the index into the interval table; stops at 49 |
| `ceiling_pushback` | 16.16 px to apply on the next tick (negative = up) |
| `ceiling_shake` | Toggles 0/1 while shaking |
| `difficulty` | `state+0x4B4FE` (byte), the interval table's row, 0–3. Default 1 (`rules.json`) |

`ceiling_init` (ceiling state 0, run once during the stage intro, [stages.md](stages.md) §2):
`ceiling_y = 10 px`, `timer = drops = shake = 0`, ceiling state 1. From then on
`ceiling_dispatch` calls `ceiling_tick` every frame of screen 5.

Puzzle Mode never writes `difficulty`; it comes from the settings block (`state+0x4B4EC`, 24
bytes), which is reset to the defaults at `0x800E361C` or loaded from the memory card.

## 2. `ceiling_tick` (every frame of play)

```
interval = INTERVALS[difficulty][drops]          # rules.json ceiling_intervals
if interval - timer < 100:                       # last 100 frames before a drop
    if (frame_counter & 63) == 0: sound 0x15
    sprite_y += SHAKE[shake]                     # SHAKE = {-1 px, +1 px}
    shake ^= 1
sprite_y  += pushback
ceiling_y += pushback
if sprite_y < 10 px: sprite_y = ceiling_y = 10 px
pushback = 0
timer += 1
if timer >= INTERVALS[difficulty][drops]:
    ceiling_y += 10 px; sprite_y = ceiling_y
    timer = 0; shake = 0; sound 0x09
    if drops < 49: drops += 1
redraw the chain sprites (ceil_row + 2 links)
```

- `frame_counter` is the global `state+0x40`, so the warning sound's phase depends on it.
- The clamp tests the **sprite's** y, which includes the shake offset (0 or −1 px net). Since
  `ceiling_y` is a multiple of 10 px, the effect is `ceiling_y >= 10 px`.
- The spawn's +60 happens in the step function, before the tick, in the same frame. A spawn can
  push the timer past the interval; the drop then happens on that frame's tick (`>=`).
- **The ceiling's pace depends on pieces used**, not just time: effective time to a drop is
  `interval − 60 × pieces spawned since the last drop`.
- E: the first drop at difficulty 1 came after 1,239 frames and 6 pieces: 1,239 + 360 ≥ 1,600.

**Intervals** (frames, `rules.json`; four rows of 50):

| Difficulty | Drops 1–10 | Then |
|---|---|---|
| 0 | 2400 2400 2400 1800 1800 1600 1200 1200 900 900 | down to 100 from drop 26 |
| 1 | 1600 1600 1600 1600 1600 1200 1200 1200 1200 900 | down to 100 from drop 26 |
| 2 | 1200 1200 1200 1000 1000 900 700 700 700 500 | down to 100 from drop 26 |
| 3 | 900 900 900 800 800 800 600 600 600 500 | down to 100 from drop 26 |

## 3. Pushback

`play_collapse` sets `pushback = PUSHBACK[lines_cleared]` (`0x8009438C`): 1 line 0, 2 lines 0,
3 lines −10 px, 4 lines −20 px. The next `ceiling_tick` applies it (the same frame: the step runs
before the tick). The timer is not reset by a pushback.

## 4. Crushing (`ceiling_crush`, every frame of play, after `ceiling_tick`)

```
crushed = false
for i from ceil_row * 10 + 19 down to 10:        # rows 1 .. ceil_row + 1, right to left
    if board[i] != 0: make_debris(i, DEBRIS_ITEM[board[i]]); board[i] = 0; crushed = true
for i from 6 down to 3:                          # row 0, the spawn opening
    if board[i] != 0: make_debris(i, cell's sprite image + 10); board[i] = 0; crushed = true
if crushed: sound 0x0F
```

So with the ceiling at its highest (10 px, row 1), **rows 1 and 2 are always emptied**: the
playable area is rows 3–15 until the ceiling drops. Each drop takes one more row. Blocks in row 0's
opening (from a piece locking there) are removed too.

The professor's danger and loss tests use the same `ceil_row` ([professor.md](professor.md) §6).

### 4.1 Debris and `rand()`

`make_debris` looks for a free debris sprite among 20 slots (`0x11D`–`0x130` + player offset),
lowest index first. A slot is free when the low halfword of its image field is 0.

- **Only if a slot is free** does it call `rand()`: the debris direction is
  `DEBRIS_VEL[rand() & 7]` (`rules.json`). With no free slot the block is removed silently and
  `rand()` is **not** called.
- So the port has to model the 20 slots and their lifetimes to keep the random sequence right.

**Debris lifetime** (`debris_update`, every frame of screen 5, after `ceiling_crush`, so a new
debris is updated on its creation frame):

- State 0: scale fields −= `0x80` per frame, move by (vx, vy), vy += 1 px. When the y scale
  reaches −`0x800` (16 updates): state 1, timer 48.
- State 1: move, vy += 1 px, blink with `frame_counter & 4`; timer −= 1; when it goes below 0 the
  slot is cleared.
- Total: **65 updates** from creation to free (16 + 49).

All debris slots are cleared when the stage ends (`0x800B1974`: on loss, and at screen 9's
first step), so each stage starts with 20 free slots. Debris doesn't update outside screen 5.
