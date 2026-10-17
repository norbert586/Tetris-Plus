# Falling piece

Evidence: S (`play_spawn`, `play_fall`, `piece_input`, `piece_gravity`, `piece_collides`,
`piece_lock`, `queue_advance`), D (`pieces.json`, `rules.json`), E (Phase 3 run `p3-verify`).

## 1. Shapes

`pieces.json`, from `0x800D5544`: `int[8 kind][4 rot][5][5]`, 1 = solid. Kinds: 0 none, 1 I,
2 O, 3 T, 4 J, 5 L, 6 Z, 7 S. A piece's cells are its kind's value on the board, which is also
its colour (`block_image_by_board_value`).

```
     rot 0  rot 1  rot 2  rot 3        rot 0  rot 1  rot 2  rot 3
I    .....  .....  .....  .....   J    .....  .....  .....  .....
     .....  ..#..  .....  ..#..        .....  ..##.  .....  ..#..
     ####.  ..#..  ####.  ..#..        .###.  ..#..  .#...  ..#..
     .....  ..#..  .....  ..#..        ...#.  ..#..  .###.  .##..
     .....  ..#..  .....  ..#..        .....  .....  .....  .....
T    .....  .....  .....  .....   L    .....  .....  .....  .....
     .....  ..#..  .....  ..#..        .....  ..#..  .....  .##..
     .###.  ..##.  ..#..  .##..        .###.  ..#..  ...#.  ..#..
     ..#..  ..#..  .###.  ..#..        .#...  ..##.  .###.  ..#..
     .....  .....  .....  .....        .....  .....  .....  .....
O    .##.. in rows 2-3, every rotation
Z    .....  ...#.   S  .....  .#...    (rot 2 = rot 0, rot 3 = rot 1)
     .##..  ..##.      ..##.  .##..
     ..##.  ..#..      .##..  ..#..
```

Rotation index +1 is a quarter turn counter-clockwise. There is no rotation system beyond these
grids: no wall kicks, no floor kicks.

## 2. Spawn (`play_spawn`, step 0)

`spawn_delay` is decremented first; the spawn happens when it drops below 1. It is always 0 in
Puzzle Mode (`intro_setup` clears it), so the spawn happens on the first frame of step 0.

1. `piece_kind = next1`, `piece_x = next1_x` (30 px), `piece_y = next1_y + 20 px`
   (−40 + 20 = −20 px), `piece_rot = spawn_rot` (0).
2. `ceiling_timer += 60` ([ceiling.md](ceiling.md)).
3. `piece_has_dropped = 0`, `gravity_count = 0`, `lock_count = 0`.
4. `queue_advance` (§3), then `pieces_spawned += 1`, step 1.

The grid's top-left is then column 3, row −2, so every piece's cells start in rows 0–1 within
columns 3–6, the opening in row 0's wall.

**Quirk: no top-out.** The spawn never tests for overlap. A piece that spawns inside blocks
simply can't move down; it locks in place after 10 gravity attempts (§6), cells above row 0 are
discarded and cells in row 0's opening are crushed the same frame
([ceiling.md](ceiling.md) §4). Losing comes only from the professor.

## 3. Preview queue (`queue_init`, `queue_advance`)

Two previews, `next1` (spawns next) and `next2`.

`queue_advance`, at each spawn, after `piece_kind` has been set:

```
next1 = next2
do  next2 = TABLE[rand() & 15]
while next2 == next1 or next2 == piece_kind
```

`TABLE` (`0x80094720`) = `{1,2,3,4,5,6,7,7,6,5,4,3,2,1,1,4}`: I and J 3/16, the others 2/16
before re-rolls. The falling piece and both previews are therefore always three different
kinds. (E: predicted 79/79 previews from the logged seed.)

`queue_init` fills both previews at stage start; it runs during the stage intro
([stages.md](stages.md) §2). Preview positions (`rules.json` `next_positions_px`): `next1` at
(30, −40) for both players, `next2` at (−10, −32) for player 1 and (60, −32) for player 2.

## 4. Input (`piece_input`)

Runs only once the piece has dropped at least one row (`piece_has_dropped`). Every frame it
starts with `input_dx = 0`, `gravity_dy = 0`, `input_rot = 0`.

**Right**, if Right is pressed or held:

```
if pressed:  input_dx = +10 px; das_delay = 20; das_repeat = 4
if held:
    if das_delay != 0:       das_delay -= 1
    elif das_repeat != 0:    das_repeat -= 1
    else:                    input_dx = +10 px; das_repeat = 4
```

**Left**, then the same with −10 px. Left runs after Right, so with both held Left's
`input_dx` wins on frames where Left moves.

**Quirk: shared counters.** Left and Right share `das_delay` and `das_repeat`, and both blocks
run on the same frame when both are held, so holding both counts down twice as fast.

**Timing.** On the press frame the counters are set and then immediately decremented by the
held branch (the press also counts as held). So the first repeat is 24 frames after the press
and later repeats every 5 frames. (E: Right held 40 frames moved at frames 7881, 7905, 7910,
7915.)

**Rotation.** If the newly pressed buttons include either rotation mask:
`input_rot = +1` if they include the clockwise mask (`state+0x4B4F4[p]`), else −1. Both on the
same frame → +1. Default masks (`rules.json` `settings_default`): counter-clockwise = Cross
(`0x40`), clockwise = Circle (`0x20`), for both players. Rotation never repeats; it needs a new
press.

Down is read by gravity (§5), not here. Up, Square, Triangle and the shoulder buttons do nothing
in play.

## 5. One frame of `play_fall` (step 1)

```
if piece_has_dropped:
    piece_input()
    x += input_dx;          if collides: x -= input_dx
    rot = (rot - input_rot) & 3
    if collides:            rot = (rot + input_rot) & 3
    elif input_rot != 0:    sound 0x0E
piece_gravity()
if gravity_dy != 0:
    y += gravity_dy
    if collides:
        y -= gravity_dy
        lock_count += 1
        if lock_count >= LEVELS[level].lock (10): lock (§6), return
    else:
        piece_has_dropped = 1; gravity_count = 0; lock_count = 0
draw the piece; stage clock tick
```

Movement and rotation are each tried once and undone on collision. Both can happen in one frame,
move first. Note `rot - input_rot`: Circle (+1) lowers the index, which turns clockwise.

**Gravity** (`piece_gravity`): `gravity_count += 1`; the threshold is

| Condition | Threshold |
|---|---|
| Not yet dropped | 8 |
| Dropped, Down held | 3 |
| Dropped | 50 |

When `gravity_count >= threshold`, `gravity_dy = 10 px`. Down does nothing before the first drop.
The 50 is a constant in `piece_gravity`; it equals `LEVELS[0].gravity` but is not read from the
table.

**Lock delay.** A blocked gravity step doesn't reset `gravity_count`, so once past the threshold
gravity fires every frame. The 10th blocked step locks, 9 frames after the first. A piece that
lands therefore locks 50 + 9 = 59 frames after its last successful drop, or 3 + 9 = 12 with Down
held (Down can be pressed or released in between; the threshold is re-read every frame).
`lock_count` resets only when a gravity step succeeds; sliding or rotating does not reset it,
but sliding off an edge lets the next gravity step succeed.

`LEVELS` (`0x800D61C4`, `rules.json`): 31 entries `{gravity, lock, score×4}`. `level` is always 0
in Puzzle Mode, so `lock` = 10. Score always reads entry 0 ([lines.md](lines.md) §5).

## 6. Collision and lock

**`piece_collides`** walks the 25 grid cells. For a grid cell at board (col, row):

- col outside 0–9, or row ≥ 16: collides if the grid cell is solid.
- row < 0 with col in range: free.
- otherwise: collides if the grid cell is solid and the board cell is non-zero.

So the walls and floor extend upward forever, and the space above row 0 is open. Row 0's wall
cells (`0xFFFF`, columns 0–2 and 7–9) block like any other block.

**`piece_lock`**: `lock_top_row = piece_y / 10`. Every solid grid cell with col 0–9 and row
0–15 is written to the board as `piece_kind`; the rest are dropped. Then `piece_kind = 0`,
`lines_found = lines_find_full()` ([lines.md](lines.md) §1), sound `0x0C`, step 2.
